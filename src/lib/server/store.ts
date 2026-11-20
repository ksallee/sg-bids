/**
 * The data layer. Every read and write of the database goes through here, with the secret key.
 *
 * Each function takes a principal the server verified (`production.ts`) or the vendor's raw link
 * token, and every query carries the filter `$lib/pure/access` gives for it. A vendor function
 * resolves the token on every call: an invitation revoked a second ago is refused now.
 *
 * Writes that must land whole are SQL functions (`supabase/migrations/`); the freezes are
 * triggers there too, so a bug here cannot thaw a submitted bid or an issued request.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { scope, stamp, type Action, type Principal, type ProductionPrincipal, type Table, type VendorPrincipal } from '$lib/pure/access';
import type { AwardScenario, BidRequest, InvitedVendor, RequestAsset, RequestHeader, RequestShot, ScenarioPick, VendorBid } from '$lib/pure/model';
import { targetKey } from '$lib/pure/model';
import { comparePercent, sumPercents } from '$lib/pure/percent';
import { validateSplits } from '$lib/pure/rebate';
import {
	bidFromRows,
	bidToRows,
	headerToColumns,
	itemsToRows,
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
	type RequestRow,
	type ScenarioItemRow,
	type ScenarioRow
} from '$lib/pure/rows';
import { encodeToken, hashToken, parseToken, sameHash, TOKEN_BYTES } from '$lib/pure/token';
import { bidTotals } from '$lib/pure/totals';
import { fromDatabase, StoreError } from './errors';

/** An invitation lives this long unless production says otherwise. */
export const DEFAULT_INVITATION_DAYS = 60;

/** The invitation columns anyone reads back. The token hash is never among them. */
const INVITATION_COLUMNS = 'id, request_id, site_host, project_id, vendor_name, vendor_group_id, contact_email, details, expires_at, revoked_at, last_opened_at, created_at';

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
	/** The frozen request. Its vendors list holds this vendor alone. */
	readonly request: BidRequest;
	/** This vendor's bids, oldest version first. */
	readonly bids: readonly VendorBid[];
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

	async function getRequest(principal: ProductionPrincipal, requestId: string): Promise<BidRequest> {
		const row = await requestRow(principal, requestId);
		const items = await itemRows(principal, requestId);
		const invitations = await run<InvitationView[]>(
			from(principal, 'invitations', 'read', INVITATION_COLUMNS).eq('request_id', requestId).order('created_at')
		);
		return requestFromRows(row, items, invitations.map(vendorFromRow));
	}

	async function saveItems(principal: ProductionPrincipal, requestId: string, items: { shots: readonly RequestShot[]; assets: readonly RequestAsset[] }) {
		const tenant = scope(principal, 'request_items', 'insert').eq;
		await run(
			db.rpc('sg_save_request_items', {
				p_request_id: requestId,
				p_site_host: tenant.site_host,
				p_project_id: tenant.project_id,
				p_items: itemsToRows(items.shots, items.assets)
			})
		);
	}

	async function createDraftRequest(
		principal: ProductionPrincipal,
		input: { code: string; header: RequestHeader; items?: { shots: readonly RequestShot[]; assets: readonly RequestAsset[] } }
	): Promise<BidRequest> {
		const row = await run<RequestRow>(
			insert(principal, 'bid_requests', { code: input.code, status: 'draft', ...headerToColumns(input.header) })
				.select()
				.single()
		);
		if (input.items) await saveItems(principal, row.id, input.items);
		return getRequest(principal, row.id);
	}

	async function updateDraftRequest(
		principal: ProductionPrincipal,
		requestId: string,
		input: { code?: string; header?: RequestHeader; items?: { shots: readonly RequestShot[]; assets: readonly RequestAsset[] } }
	): Promise<BidRequest> {
		const values: Record<string, unknown> = {};
		if (input.code !== undefined) values.code = input.code;
		if (input.header !== undefined) Object.assign(values, headerToColumns(input.header));
		if (Object.keys(values).length > 0) {
			const row = await run<RequestRow | null>(update(principal, 'bid_requests', values).eq('id', requestId).eq('status', 'draft').select().maybeSingle());
			if (!row) throw new StoreError(404, 'No such draft request.');
		}
		if (input.items) await saveItems(principal, requestId, input.items);
		return getRequest(principal, requestId);
	}

	/** Freezes the request's items. The trigger stamps `issued_at` and refuses an empty request. */
	async function issueRequest(principal: ProductionPrincipal, requestId: string): Promise<BidRequest> {
		const row = await run<RequestRow | null>(
			update(principal, 'bid_requests', { status: 'issued' }).eq('id', requestId).eq('status', 'draft').select().maybeSingle()
		);
		if (!row) throw new StoreError(404, 'No such draft request.');
		return getRequest(principal, requestId);
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
		const token = encodeToken(random(TOKEN_BYTES));
		const expires = (expiresAt ?? new Date(now().getTime() + DEFAULT_INVITATION_DAYS * 86_400_000)).toISOString();
		const row = await run<InvitationView>(
			insert(principal, 'invitations', { request_id: requestId, ...vendorToColumns(vendor), token_hash: hashToken(token), expires_at: expires })
				.select(INVITATION_COLUMNS)
				.single()
		);
		return { invitation: vendorFromRow(row), token, expiresAt: row.expires_at };
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
		return { principal: { kind: 'vendor', invitationId: row.id, requestId: row.request_id }, row };
	}

	async function vendorRequest(principal: VendorPrincipal): Promise<RequestRow> {
		const row = await run<RequestRow | null>(from(principal, 'bid_requests', 'read').maybeSingle());
		if (!row) throw new StoreError(403, 'The request is not open yet.');
		return row;
	}

	async function vendorBids(principal: VendorPrincipal, request: RequestRow): Promise<VendorBid[]> {
		const rows = await run<BidRow[]>(from(principal, 'bids', 'read').order('version'));
		return bidsWithLines(principal, rows, request);
	}

	async function openInvitation(token: unknown): Promise<VendorView> {
		const { principal, row } = await resolveToken(token);
		const request = await vendorRequest(principal);
		await run(update(principal, 'invitations', { last_opened_at: now().toISOString() }));
		const vendor = vendorFromRow(row);
		const items = await itemRows(principal, request.id);
		return { invitation: vendor, request: requestFromRows(request, items, [vendor]), bids: await vendorBids(principal, request) };
	}

	async function vendorBid(principal: VendorPrincipal, request: RequestRow, bidId: string): Promise<VendorBid> {
		const row = await run<BidRow | null>(from(principal, 'bids', 'read').eq('id', bidId).maybeSingle());
		if (!row) throw new StoreError(404, 'No such bid.');
		const [bid] = await bidsWithLines(principal, [row], request);
		return bid;
	}

	/** Writes the vendor's draft: the open one, or the next version after a submitted one. */
	async function saveDraftBid(token: unknown, draft: BidDraft): Promise<VendorBid> {
		const { principal } = await resolveToken(token);
		const request = await vendorRequest(principal);
		if (request.status !== 'issued') throw new StoreError(409, 'The request is closed.');
		let rows: ReturnType<typeof bidToRows>;
		try {
			rows = bidToRows(draft, request.base_currency);
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
		try {
			bidTotals(bid, request.base_currency);
		} catch (error) {
			throw new StoreError(422, error instanceof Error ? error.message : String(error));
		}
		const splits = validateSplits(bid.rebate);
		if (splits.length > 0) throw new StoreError(422, splits.join(' '));
		const row = await run<BidRow | null>(update(principal, 'bids', { status: 'submitted' }).eq('id', bidId).eq('status', 'draft').select().maybeSingle());
		if (!row) throw new StoreError(404, 'No such draft bid.');
		return vendorBid(principal, request, bidId);
	}

	return {
		createDraftRequest,
		updateDraftRequest,
		issueRequest,
		getRequest,
		listRequests,
		inviteVendor,
		revokeInvitation,
		listBids,
		saveScenario,
		openInvitation,
		saveDraftBid,
		submitBid
	};
}

export type Store = ReturnType<typeof createStore>;
