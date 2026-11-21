/**
 * The data layer. Every read and write of the database goes through here, with the secret key.
 *
 * Each function takes a principal the server verified (`production.ts`) or the vendor's raw link
 * token, and every query carries the filter `$lib/pure/access` gives for it. A vendor function
 * resolves the token on every call: an invitation revoked a second ago is refused now.
 *
 * Writes that must land whole are SQL functions (`supabase/migrations/`); the freezes are
 * triggers there too, so a bug here cannot thaw a submitted bid or an issued request.
 *
 * A vendor invited to some packages reads the rows and packages of those alone: the token's
 * principal carries the invitation's packages and `scope` filters every read of rows by them. A
 * line or a figure outside them is refused here, and by the database's guards behind it.
 *
 * A draft request owns its bids: each a production bid with its rows, one package of the request
 * per bid. It reads as its bids make it (`request-bids.composeDraft`); the page saves its bids, rows
 * and vendors in one write (`sg_save_draft`), and the issue copies the rows into the request in one
 * write (`sg_issue_request`), with the links of the vendors added to the draft, answered once.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { scope, stamp, type Action, type Principal, type ProductionPrincipal, type Table, type VendorPrincipal } from '$lib/pure/access';
import type { AwardScenario, BidRequest, Id, InvitedVendor, RequestAsset, RequestHeader, RequestPackage, RequestShot, ScenarioPick, VendorBid } from '$lib/pure/model';
import { ANSWER_ONE, packageProblems, resolvePackages } from '$lib/pure/packages';
import { countOf, countProblems } from '$lib/pure/count';
import { composeDraft } from '$lib/pure/request-bids';
import { bidKey, type SavedBid } from '$lib/pure/request-draft';
import { targetKey } from '$lib/pure/model';
import { comparePercent, sumPercents } from '$lib/pure/percent';
import { rangeProblems, submitProblems } from '$lib/pure/bid-limits';
import { isCurrency } from '$lib/pure/currencies';
import {
	bidFromRows,
	bidToRows,
	bidItemsToRows,
	headerToColumns,
	packagesFromRows,
	requestFromRows,
	scenarioFromRows,
	scenarioToRows,
	vendorFromRow,
	vendorToColumns,
	type BidDraft,
	type BidLineRow,
	type BidRow,
	type InvitationRow,
	type RequestItemRow,
	type RequestPackageRow,
	type RequestRow,
	type ScenarioItemRow,
	type ScenarioRow
} from '$lib/pure/rows';
import { encodeToken, hashToken, parseToken, sameHash, TOKEN_BYTES } from '$lib/pure/token';
import type { ItemKey } from '$lib/pure/vendor-keys';
import type { ItemLink } from '$lib/pure/wire';
import type { VendorBidRecord } from '$lib/pure/vendor-view';
import { nameMatches, requestName, type Deleted } from '$lib/pure/request-delete';
import { fromDatabase, StoreError } from './errors';
import { createProductionBids } from './production-bids';

/** An invitation lives this long unless production says otherwise. */
export const DEFAULT_INVITATION_DAYS = 60;

/** The invitation columns anyone reads back. The token hash is never among them. */
const INVITATION_COLUMNS = 'id, request_id, site_host, project_id, vendor_name, vendor_group_id, contact_email, details, package_keys, expires_at, revoked_at, last_opened_at, created_at';

/**
 * Rows for a new draft, as a request made before this page held them: each package becomes a bid
 * with its rows; with no package, one bid, Bid 1, holds them all. The seed and the tests use it.
 */
export interface DraftItems {
	readonly shots: readonly RequestShot[];
	readonly assets: readonly RequestAsset[];
	readonly packages?: readonly RequestPackage[];
}

/** A vendor of a draft as its page saves it: kept as typed, its link made at the issue. */
export interface DraftVendor {
	readonly id: Id;
	readonly name: string;
	readonly email: string;
	readonly group: { readonly id: number; readonly name: string } | null;
	/** The bids it answers, by key. Null: every bid. */
	readonly bids: readonly Id[] | null;
}

/** What one save of a draft's page writes. Absent: left as it is. */
export interface DraftSave {
	readonly header?: RequestHeader;
	readonly bids?: readonly SavedBid[];
	readonly vendors?: readonly DraftVendor[];
}

type InvitationView = Omit<InvitationRow, 'token_hash'>;

export interface RequestSummary {
	readonly id: string;
	readonly code: string;
	readonly status: RequestRow['status'];
	readonly issuedAt: string | null;
	readonly header: RequestHeader;
}

export interface Invited {
	readonly invitation: InvitedVendor;
	/** Shown once. Only its hash is stored. */
	readonly token: string;
	readonly expiresAt: string;
}

export interface VendorView {
	readonly invitation: InvitedVendor;
	readonly code: string;
	readonly status: 'issued' | 'closed';
	readonly issuedAt: string | null;
	/** When the link stops working. */
	readonly expiresAt: string;
	/** The frozen request. Its vendors list holds this vendor alone. */
	readonly request: BidRequest;
	/** This vendor's bids, oldest version first. */
	readonly bids: readonly VendorBid[];
	/** Each item's stored key and row id: the vendor sees the row id (`vendor-keys.ts`). */
	readonly itemKeys: readonly ItemKey[];
}

export interface BidWithVendor {
	readonly vendor: InvitedVendor;
	readonly bid: VendorBid;
}

export interface StoreOptions {
	/** The clock, for the expiry check. */
	readonly now?: () => Date;
	/** Random bytes for a token. */
	readonly random?: (length: number) => Uint8Array;
}

// Supabase's builder types need generated database types; this layer types rows itself.
type Query = any;

interface Result<T> {
	data: T | null;
	error: { code?: string; message: string } | null;
}

async function run<T>(query: PromiseLike<Result<T>>): Promise<T> {
	const { data, error } = await query;
	if (error) throw fromDatabase(error);
	return data as T;
}

export function createStore(db: SupabaseClient, options: StoreOptions = {}) {
	const now = options.now ?? (() => new Date());
	const random = options.random ?? ((length: number) => crypto.getRandomValues(new Uint8Array(length)));
	const productionBids = createProductionBids(db);

	/** A query on `table` that carries the principal's filter for `action`. */
	function from(principal: Principal, table: Table, action: Action, columns = '*'): Query {
		const given = scope(principal, table, action);
		let query: Query = db.from(table);
		query = action === 'read' ? query.select(columns) : query;
		return filtered(query, given);
	}

	function filtered(query: Query, given: ReturnType<typeof scope>): Query {
		let next = query.match(given.eq);
		for (const [column, values] of Object.entries(given.in ?? {})) next = next.in(column, [...values]);
		return next;
	}

	function update(principal: Principal, table: Table, values: Record<string, unknown>): Query {
		return filtered(db.from(table).update(values), scope(principal, table, 'update'));
	}

	function insert(principal: Principal, table: Table, row: Record<string, unknown>): Query {
		return db.from(table).insert(stamp(row, scope(principal, table, 'insert')));
	}

	// Shared reads.

	async function requestRow(principal: Principal, requestId: string): Promise<RequestRow> {
		const row = await run<RequestRow | null>(from(principal, 'bid_requests', 'read').eq('id', requestId).maybeSingle());
		if (!row) throw new StoreError(404, 'No such request.');
		return row;
	}

	async function itemRows(principal: Principal, requestId: string): Promise<RequestItemRow[]> {
		return run<RequestItemRow[]>(from(principal, 'request_items', 'read').eq('request_id', requestId).order('position'));
	}

	async function packageRows(principal: Principal, requestId: string): Promise<RequestPackageRow[]> {
		return run<RequestPackageRow[]>(from(principal, 'request_packages', 'read').eq('request_id', requestId).order('position'));
	}

	async function bidsWithLines(principal: Principal, bids: BidRow[], request: RequestRow): Promise<VendorBid[]> {
		if (bids.length === 0) return [];
		const lines = await run<BidLineRow[]>(
			from(principal, 'bid_lines', 'read')
				.in(
					'bid_id',
					bids.map((b) => b.id)
				)
				.order('item_kind')
				.order('item_key')
		);
		return bids.map((row) =>
			bidFromRows(
				row,
				lines.filter((line) => line.bid_id === row.id),
				{ round: request.round, baseCurrency: request.base_currency }
			)
		);
	}

	// Production.

	/** The request. A draft reads as its bids make it: each bid's rows under its package, named as the bid. */
	async function getRequest(principal: ProductionPrincipal, requestId: string): Promise<BidRequest> {
		const row = await requestRow(principal, requestId);
		const [items, packages] = await Promise.all([itemRows(principal, requestId), packageRows(principal, requestId)]);
		const invitations = await run<InvitationView[]>(
			from(principal, 'invitations', 'read', INVITATION_COLUMNS).eq('request_id', requestId).order('created_at')
		);
		const vendors = invitations.map(vendorFromRow);
		const linked = packages.flatMap((p) => (p.bid_id ? [p.bid_id] : []));
		if (row.status !== 'draft' || linked.length === 0) return requestFromRows(row, items, vendors, packages);
		const composed = composeDraft(packagesFromRows(packages), await productionBids.rowsOf(principal, linked));
		const request = requestFromRows(row, [], vendors, []);
		return { ...request, shots: composed.shots, assets: composed.assets, packages: composed.packages };
	}

	/** The bids a draft is made with from rows held as a request before this page held them. */
	function bidsFromItems(items: DraftItems | undefined): SavedBid[] {
		const shots = items?.shots ?? [];
		const assets = items?.assets ?? [];
		const packages = items?.packages ?? [];
		if (packages.length === 0) return [{ key: bidKey(crypto.randomUUID()), name: 'Bid 1', shots, assets }];
		const known = new Set(packages.map((p) => p.id));
		const first = packages[0].id;
		const of = (pkg: Id | undefined) => (pkg && known.has(pkg) ? pkg : first);
		return packages.map((p) => ({ key: p.id, name: p.name, shots: shots.filter((x) => of(x.package) === p.id), assets: assets.filter((x) => of(x.package) === p.id) }));
	}

	function vendorColumns(vendor: DraftVendor, expires: string) {
		return {
			id: vendor.id,
			vendor_name: vendor.name,
			contact_email: vendor.email,
			vendor_group_id: vendor.group?.id ?? null,
			details: vendor.group ? { ndaExecuted: false, groupName: vendor.group.name } : { ndaExecuted: false },
			package_keys: vendor.bids ? [...vendor.bids] : null,
			// A placeholder: no token is answered until the issue, so nothing here opens anything.
			token_hash: hashToken(encodeToken(random(TOKEN_BYTES))),
			expires_at: expires
		};
	}

	/**
	 * Saves a draft's page in one write (`sg_save_draft`): the header, then its bids with their rows,
	 * and its vendors. A bid left out goes with its rows; a vendor added to the draft and left out
	 * goes. A row sits in one bid of the request.
	 */
	async function saveDraft(principal: ProductionPrincipal, requestId: string, input: DraftSave): Promise<void> {
		if (input.header !== undefined) {
			const row = await run<{ id: string } | null>(update(principal, 'bid_requests', headerToColumns(input.header)).eq('id', requestId).eq('status', 'draft').select('id').maybeSingle());
			if (!row) throw new StoreError(404, 'No such draft request.');
		}
		if (input.bids === undefined && input.vendors === undefined) return;
		let bids = input.bids;
		if (bids === undefined) {
			const current = await getRequest(principal, requestId);
			bids = bidsFromItems({ shots: current.shots, assets: current.assets, packages: current.packages });
		}
		let rows: { key: string; name: string; items: ReturnType<typeof bidItemsToRows> }[];
		try {
			const seen = new Map<string, string>();
			rows = bids.map((b) => {
				for (const [kind, id, code] of [...b.shots.map((x) => ['shot', x.id, x.code]), ...b.assets.map((x) => ['asset', x.id, x.name])]) {
					const before = seen.get(`${kind}:${id}`);
					if (before !== undefined) throw new Error(`A row sits in one bid. ${code} is in ${before} and in ${b.name}.`);
					seen.set(`${kind}:${id}`, b.name);
				}
				return { key: b.key, name: b.name.trim(), items: bidItemsToRows(b.shots, b.assets) };
			});
		} catch (error) {
			throw new StoreError(422, error instanceof Error ? error.message : String(error));
		}
		const expires = new Date(now().getTime() + DEFAULT_INVITATION_DAYS * 86_400_000).toISOString();
		const tenant = scope(principal, 'request_packages', 'update').eq;
		await run(
			db.rpc('sg_save_draft', {
				p_request_id: requestId,
				p_site_host: tenant.site_host,
				p_project_id: tenant.project_id,
				p_bids: rows,
				p_vendors: input.vendors ? input.vendors.map((v) => vendorColumns(v, expires)) : null
			})
		);
	}

	/**
	 * A new draft with its bids: `bids` as given, or made from `items` (rows as a request held them
	 * before this page), or one empty bid, Bid 1. Its vendors as given.
	 */
	async function createDraftRequest(
		principal: ProductionPrincipal,
		input: { code: string; header: RequestHeader; items?: DraftItems; bids?: readonly SavedBid[]; vendors?: readonly DraftVendor[] }
	): Promise<BidRequest> {
		const row = await run<RequestRow>(
			insert(principal, 'bid_requests', { code: input.code, status: 'draft', ...headerToColumns(input.header) })
				.select()
				.single()
		);
		await saveDraft(principal, row.id, { bids: input.bids ?? bidsFromItems(input.items), vendors: input.vendors ?? [] });
		return getRequest(principal, row.id);
	}

	/** A draft's header, and its bids when rows are given, as `createDraftRequest` takes them. */
	async function updateDraftRequest(principal: ProductionPrincipal, requestId: string, input: { header?: RequestHeader; items?: DraftItems }): Promise<BidRequest> {
		await saveDraft(principal, requestId, { header: input.header, ...(input.items ? { bids: bidsFromItems(input.items) } : {}) });
		return getRequest(principal, requestId);
	}

	/** The codes the tenant's requests hold in a round: a new code is made free of them. */
	async function codesInRound(principal: ProductionPrincipal, round: number): Promise<string[]> {
		const rows = await run<{ code: string }[]>(from(principal, 'bid_requests', 'read', 'code').eq('round', round));
		return rows.map((r) => r.code);
	}

	/**
	 * Give breakdown rows their Flow PT row, all or none: on a draft, and on an issued request, where
	 * it is the one change the freeze allows (`sg_link_request_items`). Answers the request.
	 */
	async function linkItems(principal: ProductionPrincipal, requestId: string, links: readonly ItemLink[]): Promise<BidRequest> {
		const tenant = scope(principal, 'request_items', 'update').eq;
		await run(
			db.rpc('sg_link_request_items', {
				p_request_id: requestId,
				p_site_host: tenant.site_host,
				p_project_id: tenant.project_id,
				p_links: links.map((l) => ({ kind: l.kind, key: l.key, fpt_type: l.fpt.type, fpt_id: l.fpt.id }))
			})
		);
		return getRequest(principal, requestId);
	}

	/**
	 * Issues the draft in one write (`sg_issue_request`): each bid's rows copied as they are now, the
	 * links of the vendors added to the draft made, the request frozen. The trigger stamps `issued_at`
	 * and refuses an empty request. Each new link is answered here, once; only its hash is stored.
	 */
	async function issue(principal: ProductionPrincipal, requestId: string): Promise<{ request: BidRequest; links: Invited[] }> {
		const row = await requestRow(principal, requestId);
		if (row.status !== 'draft') throw new StoreError(404, 'No such draft request.');
		const pending = await run<InvitationView[]>(
			from(principal, 'invitations', 'read', INVITATION_COLUMNS).eq('request_id', requestId).eq('link_pending', true).order('created_at')
		);
		const expires = new Date(now().getTime() + DEFAULT_INVITATION_DAYS * 86_400_000).toISOString();
		const minted = pending.map((invitation) => ({ invitation, token: encodeToken(random(TOKEN_BYTES)) }));
		const tenant = scope(principal, 'bid_requests', 'update').eq;
		await run(
			db.rpc('sg_issue_request', {
				p_request_id: requestId,
				p_site_host: tenant.site_host,
				p_project_id: tenant.project_id,
				p_links: minted.map((m) => ({ invitation_id: m.invitation.id, token_hash: hashToken(m.token), expires_at: expires }))
			})
		);
		return { request: await getRequest(principal, requestId), links: minted.map((m) => ({ invitation: vendorFromRow(m.invitation), token: m.token, expiresAt: expires })) };
	}

	async function issueRequest(principal: ProductionPrincipal, requestId: string): Promise<BidRequest> {
		return (await issue(principal, requestId)).request;
	}

	/**
	 * Deletes the request and everything under it, in one transaction (`sg_delete_request`): the one
	 * way past the freezes. `typedName` must be the request's name (its code when it has none).
	 * Refused while an award is in Flow PT. Another tenant's request and a missing one answer the same
	 * 404. Writes nothing to Flow PT.
	 */
	async function deleteRequest(principal: ProductionPrincipal, requestId: string, typedName: string): Promise<Deleted> {
		const row = await requestRow(principal, requestId);
		const title = (row.header as { title?: unknown }).title;
		const name = requestName({ code: row.code, title: typeof title === 'string' ? title : null });
		if (!nameMatches(typedName, name)) throw new StoreError(422, `Type ${name} to delete the request.`);
		const tenant = scope(principal, 'bid_requests', 'delete').eq;
		const gone = await run<Deleted>(db.rpc('sg_delete_request', { p_request_id: requestId, p_site_host: tenant.site_host, p_project_id: tenant.project_id }));
		return { ...gone, round: Number(gone.round) };
	}

	async function listRequests(principal: ProductionPrincipal): Promise<RequestSummary[]> {
		const rows = await run<RequestRow[]>(from(principal, 'bid_requests', 'read').order('created_at', { ascending: false }));
		return rows.map((row) => ({ id: row.id, code: row.code, status: row.status, issuedAt: row.issued_at, header: requestFromRows(row, [], []).header }));
	}

	async function inviteVendor(
		principal: ProductionPrincipal,
		requestId: string,
		vendor: Omit<InvitedVendor, 'id'>,
		expiresAt?: Date
	): Promise<Invited> {
		const request = await requestRow(principal, requestId);
		if (request.status === 'closed') throw new StoreError(409, 'The request is closed.');
		if (request.status === 'awarded') throw new StoreError(409, 'The request is awarded. Undo the award to invite another vendor.');
		if (vendor.packages) await checkPackageKeys(principal, requestId, vendor.packages);
		const token = encodeToken(random(TOKEN_BYTES));
		const expires = (expiresAt ?? new Date(now().getTime() + DEFAULT_INVITATION_DAYS * 86_400_000)).toISOString();
		const row = await run<InvitationView>(
			insert(principal, 'invitations', { request_id: requestId, ...vendorToColumns(vendor), token_hash: hashToken(token), expires_at: expires })
				.select(INVITATION_COLUMNS)
				.single()
		);
		return { invitation: vendorFromRow(row), token, expiresAt: row.expires_at };
	}

	/** Every key a package of the request. A request from before packages takes no list: it has one. */
	async function checkPackageKeys(principal: ProductionPrincipal, requestId: string, keys: readonly Id[]): Promise<void> {
		const known = new Set((await packageRows(principal, requestId)).map((p) => p.key));
		if (known.size === 0) throw new StoreError(422, 'This request has one bid. Invite the vendor to all of it.');
		if (keys.length === 0) throw new StoreError(422, 'Pick at least one bid, or every bid.');
		if (keys.some((k) => !known.has(k))) throw new StoreError(422, 'A bid is not in the request. Reload the page.');
	}

	/**
	 * The packages a vendor is invited to, or null for every one. Allowed while the request takes bids
	 * and the vendor has submitted no bid, withdrawn or not: a bid answers the packages it was made for.
	 */
	async function setInvitationPackages(principal: ProductionPrincipal, invitationId: string, packages: readonly Id[] | null): Promise<InvitedVendor> {
		const invitation = await run<InvitationView | null>(from(principal, 'invitations', 'read', INVITATION_COLUMNS).eq('id', invitationId).maybeSingle());
		if (!invitation) throw new StoreError(404, 'No such invitation.');
		const request = await requestRow(principal, invitation.request_id);
		if (request.status !== 'draft' && request.status !== 'issued') throw new StoreError(409, 'The request no longer takes answers. Its vendors keep their bids.', { reason: 'closed' });
		const bids = await run<{ status: string }[]>(from(principal, 'bids', 'read', 'status').eq('invitation_id', invitationId));
		if (bids.length > 0) {
			throw new StoreError(409, `${invitation.vendor_name} has submitted an answer. Its bids are fixed: an answer is for the bids it was made for.`, { reason: 'submitted' });
		}
		if (packages) await checkPackageKeys(principal, invitation.request_id, packages);
		const row = await run<InvitationView | null>(
			update(principal, 'invitations', { package_keys: packages ? [...packages] : null }).eq('id', invitationId).select(INVITATION_COLUMNS).maybeSingle()
		);
		if (!row) throw new StoreError(404, 'No such invitation.');
		return vendorFromRow(row);
	}

	async function revokeInvitation(principal: ProductionPrincipal, invitationId: string): Promise<void> {
		const row = await run<{ id: string } | null>(
			update(principal, 'invitations', { revoked_at: now().toISOString() }).eq('id', invitationId).is('revoked_at', null).select('id').maybeSingle()
		);
		if (!row) throw new StoreError(404, 'No such invitation.');
	}

	/** Submitted and withdrawn bids on a request, with their vendors. Drafts stay the vendor's. */
	async function listBids(principal: ProductionPrincipal, requestId: string): Promise<BidWithVendor[]> {
		const request = await requestRow(principal, requestId);
		const invitations = await run<InvitationView[]>(from(principal, 'invitations', 'read', INVITATION_COLUMNS).eq('request_id', requestId));
		const rows = await run<BidRow[]>(from(principal, 'bids', 'read').eq('request_id', requestId).order('created_at'));
		const bids = await bidsWithLines(principal, rows, request);
		const vendors = new Map(invitations.map((row) => [row.id, vendorFromRow(row)]));
		return bids.map((bid) => ({ vendor: vendors.get(bid.vendorId)!, bid }));
	}

	async function saveScenario(
		principal: ProductionPrincipal,
		requestId: string,
		scenario: { id?: string; name: string; picks: readonly ScenarioPick[] }
	): Promise<AwardScenario> {
		const seen = new Set<string>();
		for (const pick of scenario.picks) {
			const key = targetKey(pick.target);
			if (seen.has(key)) throw new StoreError(422, `The scenario picks ${pick.target.kind} ${pick.target.id} twice.`);
			seen.add(key);
			const shares = pick.shares.map((share) => share.percent);
			let total: string;
			try {
				total = sumPercents(shares);
			} catch (error) {
				throw new StoreError(422, error instanceof Error ? error.message : String(error));
			}
			if (comparePercent(total, '100') !== 0) {
				throw new StoreError(422, `The shares of ${pick.target.kind} ${pick.target.id} sum to ${total}%, not 100%.`);
			}
		}
		const tenant = scope(principal, 'award_scenarios', scenario.id ? 'update' : 'insert').eq;
		const id = await run<string>(
			db.rpc('sg_save_scenario', {
				p_request_id: requestId,
				p_site_host: tenant.site_host,
				p_project_id: tenant.project_id,
				p_scenario_id: scenario.id ?? null,
				p_name: scenario.name,
				p_items: scenarioToRows(scenario.picks)
			})
		);
		const row = await run<ScenarioRow>(from(principal, 'award_scenarios', 'read').eq('id', id).single());
		const items = await run<ScenarioItemRow[]>(from(principal, 'award_scenario_items', 'read').eq('scenario_id', id));
		return scenarioFromRows(row, items);
	}

	// Vendor.

	function itemKey(row: RequestItemRow): ItemKey {
		return { kind: row.kind, key: row.key, id: row.id };
	}

	/** The vendor principal behind a link token. One refusal for every bad token. */
	async function resolveToken(token: unknown): Promise<{ principal: VendorPrincipal; row: InvitationRow }> {
		const parsed = parseToken(token);
		if (!parsed) throw new StoreError(401, 'This link is not valid.');
		const hash = hashToken(parsed);
		const row = await run<InvitationRow | null>(db.from('invitations').select('*').eq('token_hash', hash).maybeSingle());
		if (!row || !sameHash(row.token_hash, hash)) throw new StoreError(401, 'This link is not valid.');
		if (row.revoked_at !== null || new Date(row.expires_at).getTime() <= now().getTime()) {
			throw new StoreError(403, 'This link has expired or was withdrawn.');
		}
		return { principal: { kind: 'vendor', invitationId: row.id, requestId: row.request_id, packages: row.package_keys ?? null }, row };
	}

	/**
	 * The invitation a link token names, whatever its state, or null for a token no invitation
	 * holds: its id, the vendor's name, and whether it opens a bid now. The link page reads it to
	 * ask before one vendor's link replaces another's in the same browser.
	 */
	async function linkInvitation(token: unknown): Promise<{ id: string; vendorName: string; live: boolean } | null> {
		const parsed = parseToken(token);
		if (!parsed) return null;
		const hash = hashToken(parsed);
		const row = await run<Pick<InvitationRow, 'id' | 'vendor_name' | 'token_hash' | 'revoked_at' | 'expires_at'> | null>(
			db.from('invitations').select('id, vendor_name, token_hash, revoked_at, expires_at').eq('token_hash', hash).maybeSingle()
		);
		if (!row || !sameHash(row.token_hash, hash)) return null;
		return { id: row.id, vendorName: row.vendor_name, live: row.revoked_at === null && new Date(row.expires_at).getTime() > now().getTime() };
	}

	/**
	 * Whether this token once opened this invitation and production has since replaced it. Only
	 * then is the answer "replaced": a cookie naming an invitation with any other token learns
	 * nothing of it, not even that it exists.
	 */
	async function wasReplaced(invitationId: string, token: unknown): Promise<boolean> {
		const parsed = parseToken(token);
		if (!parsed || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invitationId)) return false;
		const row = await run<{ id: string } | null>(
			db.from('invitations').select('id').eq('id', invitationId).contains('replaced_token_hashes', [hashToken(parsed)]).maybeSingle()
		);
		return row !== null;
	}

	/**
	 * Whether this token belonged to an invitation of a request production deleted. Only the token
	 * itself finds it, by its hash: a guess learns nothing.
	 */
	async function wasWithdrawn(token: unknown): Promise<boolean> {
		const parsed = parseToken(token);
		if (!parsed) return false;
		const row = await run<{ token_hash: string } | null>(db.from('withdrawn_links').select('token_hash').eq('token_hash', hashToken(parsed)).maybeSingle());
		return row !== null;
	}

	async function vendorRequest(principal: VendorPrincipal): Promise<RequestRow> {
		const row = await run<RequestRow | null>(from(principal, 'bid_requests', 'read').maybeSingle());
		if (!row) throw new StoreError(403, 'The request is not open yet.');
		return row;
	}

	async function vendorBids(principal: VendorPrincipal, request: RequestRow): Promise<VendorBid[]> {
		return (await vendorRecords(principal, request)).map((record) => record.bid);
	}

	async function vendorRecords(principal: VendorPrincipal, request: RequestRow): Promise<VendorBidRecord[]> {
		const rows = await run<BidRow[]>(from(principal, 'bids', 'read').order('version'));
		const bids = await bidsWithLines(principal, rows, request);
		return rows.map((row, index) => ({ bid: bids[index], version: row.version, submittedAt: row.submitted_at, withdrawnAt: row.withdrawn_at }));
	}

	async function openInvitation(token: unknown): Promise<VendorView> {
		const { principal, row } = await resolveToken(token);
		const request = await vendorRequest(principal);
		await run(update(principal, 'invitations', { last_opened_at: now().toISOString() }));
		const vendor = vendorFromRow(row);
		// The rows and packages of the vendor's packages alone (`scope`).
		const [items, packages] = await Promise.all([itemRows(principal, request.id), packageRows(principal, request.id)]);
		return {
			invitation: vendor,
			code: request.code,
			// A vendor is told bidding is closed once the request is awarded, never who won.
			status: request.status === 'issued' ? 'issued' : 'closed',
			issuedAt: request.issued_at,
			expiresAt: row.expires_at,
			request: requestFromRows(request, items, [vendor], packages),
			bids: await vendorBids(principal, request),
			itemKeys: items.map(itemKey)
		};
	}

	/** The request as the vendor may see it: its packages' rows and packages, for the checks on a write. */
	async function vendorRows(principal: VendorPrincipal, request: RequestRow): Promise<BidRequest> {
		const [items, packages] = await Promise.all([itemRows(principal, request.id), packageRows(principal, request.id)]);
		return requestFromRows(request, items, [], packages);
	}

	/**
	 * What breaks the package rules in a bid of this vendor: a line for a row it may not see, a figure
	 * for a package it may not price, or a figure that does not cover its rows.
	 */
	function packageRefusals(
		visible: BidRequest,
		bid: Pick<VendorBid, 'packages' | 'declined'> & { readonly lines: readonly Pick<VendorBid['lines'][number], 'target' | 'inPackage' | 'excluded' | 'total' | 'unit'>[] },
		submitting = false
	): string[] {
		const seen = new Set([...visible.shots.map((s) => `shot:${s.id}`), ...visible.assets.map((a) => `asset:${a.id}`)]);
		if (bid.lines.some((l) => !seen.has(`${l.target.kind}:${l.target.id}`))) return ['A line names a row outside your bids. Reload the page.'];
		const resolved = resolvePackages(visible);
		const counts = [...visible.shots.map((s) => ({ key: `shot:${s.id}`, label: s.code, count: countOf(s) })), ...visible.assets.map((a) => ({ key: `asset:${a.id}`, label: a.name, count: countOf(a) }))];
		const problems = [...packageProblems(resolved, visible, bid, new Set(resolved.packages.map((p) => p.id))), ...countProblems(counts, bid.lines)];
		// A draft may decline every package for a while; a submit bids on one at least.
		return submitting ? problems : problems.filter((p) => p !== ANSWER_ONE);
	}

	/** The vendor's own bids, oldest version first, with their version and stamps. */
	async function vendorBidRecords(token: unknown): Promise<VendorBidRecord[]> {
		return (await vendorState(token)).records;
	}

	/**
	 * The token's invitation id beside its bids and the request's item keys: what a write is checked
	 * against and translated with (`vendor-api.ts`).
	 */
	async function vendorState(token: unknown): Promise<{ invitationId: string; records: VendorBidRecord[]; itemKeys: ItemKey[] }> {
		const { principal } = await resolveToken(token);
		const request = await vendorRequest(principal);
		const [records, items] = await Promise.all([vendorRecords(principal, request), itemRows(principal, request.id)]);
		return { invitationId: principal.invitationId, records, itemKeys: items.map(itemKey) };
	}

	async function vendorBid(principal: VendorPrincipal, request: RequestRow, bidId: string): Promise<VendorBid> {
		const row = await run<BidRow | null>(from(principal, 'bids', 'read').eq('id', bidId).maybeSingle());
		if (!row) throw new StoreError(404, 'No such bid.');
		const [bid] = await bidsWithLines(principal, [row], request);
		return bid;
	}

	/**
	 * Writes the vendor's draft: the open one, or the next version after a submitted one. The vendor
	 * gives no exchange rate: one sent is dropped, and the amounts are checked in the bid's currency.
	 */
	async function saveDraftBid(token: unknown, draft: BidDraft): Promise<VendorBid> {
		const { principal } = await resolveToken(token);
		const request = await vendorRequest(principal);
		if (request.status !== 'issued') throw new StoreError(409, 'The request is closed.');
		if (!isCurrency(draft.currency)) throw new StoreError(422, `${draft.currency} is not a currency on the ISO 4217 list.`);
		const ranges = rangeProblems(draft);
		if (ranges.length > 0) throw new StoreError(422, ranges.join(' '));
		const refusals = packageRefusals(await vendorRows(principal, request), draft);
		if (refusals.length > 0) throw new StoreError(422, refusals.join(' '));
		let rows: ReturnType<typeof bidToRows>;
		try {
			rows = bidToRows({ ...draft, rate: null }, draft.currency);
		} catch (error) {
			throw new StoreError(422, error instanceof Error ? error.message : String(error));
		}
		const id = await run<string>(db.rpc('sg_save_bid_draft', { p_invitation_id: principal.invitationId, p_bid: rows.bid, p_lines: rows.lines }));
		return vendorBid(principal, request, id);
	}

	/** Submits the vendor's draft after the same checks the comparison will run. */
	async function submitBid(token: unknown, bidId: string): Promise<VendorBid> {
		const { principal } = await resolveToken(token);
		const request = await vendorRequest(principal);
		if (request.status !== 'issued') throw new StoreError(409, 'The request is closed.');
		const bid = await vendorBid(principal, request, bidId);
		if (bid.status !== 'draft') throw new StoreError(409, 'That bid is already submitted. A change is a new version.');
		// The vendor's packages may have changed since the draft was saved: it answers the ones it has now.
		const refusals = packageRefusals(await vendorRows(principal, request), bid, true);
		if (refusals.includes(ANSWER_ONE)) throw new StoreError(422, ANSWER_ONE);
		if (refusals.length > 0) throw new StoreError(409, `Your bids changed since this draft was saved. Reload the page. ${refusals[0]}`, { reason: 'packages' });
		let problems: string[];
		try {
			problems = submitProblems(bid, bid.currency);
		} catch (error) {
			throw new StoreError(422, error instanceof Error ? error.message : String(error));
		}
		if (problems.length > 0) throw new StoreError(422, problems.join(' '));
		const row = await run<BidRow | null>(update(principal, 'bids', { status: 'submitted' }).eq('id', bidId).eq('status', 'draft').select().maybeSingle());
		if (!row) throw new StoreError(404, 'No such draft bid.');
		return vendorBid(principal, request, bidId);
	}

	/** Withdraws the vendor's submitted bid. Production then sees it as withdrawn. */
	async function withdrawBid(token: unknown, bidId: string): Promise<VendorBid> {
		const { principal } = await resolveToken(token);
		const request = await vendorRequest(principal);
		if (request.status !== 'issued') throw new StoreError(409, 'The request is closed.');
		const bid = await vendorBid(principal, request, bidId);
		if (bid.status !== 'submitted') throw new StoreError(409, 'Only a submitted bid can be withdrawn.');
		const row = await run<BidRow | null>(update(principal, 'bids', { status: 'withdrawn' }).eq('id', bidId).eq('status', 'submitted').select().maybeSingle());
		if (!row) throw new StoreError(409, 'Only a submitted bid can be withdrawn.');
		return vendorBid(principal, request, bidId);
	}

	/**
	 * Discards the vendor's draft: a first draft goes, and the vendor starts from empty; a revision
	 * goes, and the last submitted or withdrawn version is the latest again. A submitted bid is never
	 * deleted: the database refuses it, and this deletes drafts only.
	 */
	async function discardDraftBid(token: unknown, bidId: string): Promise<void> {
		const { principal } = await resolveToken(token);
		const request = await vendorRequest(principal);
		if (request.status !== 'issued') throw new StoreError(409, 'The request is closed.');
		const row = await run<{ id: string } | null>(
			filtered(db.from('bids').delete(), scope(principal, 'bids', 'delete')).eq('id', bidId).eq('status', 'draft').select('id').maybeSingle()
		);
		if (!row) throw new StoreError(404, 'No such draft bid.');
	}

	return {
		createDraftRequest,
		deleteRequest,
		updateDraftRequest,
		saveDraft,
		codesInRound,
		linkItems,
		issue,
		issueRequest,
		getRequest,
		listRequests,
		inviteVendor,
		setInvitationPackages,
		revokeInvitation,
		listBids,
		saveScenario,
		openInvitation,
		linkInvitation,
		wasReplaced,
		wasWithdrawn,
		vendorBidRecords,
		vendorState,
		saveDraftBid,
		submitBid,
		withdrawBid,
		discardDraftBid
	};
}

export type Store = ReturnType<typeof createStore>;
