/**
 * Production's overview reads and the link re-issue, beside `store.ts` and held to the same rules:
 * every query carries the principal's filter from `$lib/pure/access`, and production reads only
 * submitted and withdrawn bids (a draft is the vendor's).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { scope, siteScope, type ProductionPrincipal, type SitePrincipal, type Table } from '$lib/pure/access';
import { invitationState, requestCounts, type BidFacts, type InvitationFacts, type InvitationState } from '$lib/pure/invitations';
import type { InvitedVendor, RequestHeader } from '$lib/pure/model';
import { vendorFromRow, type RequestRow, type VendorColumns } from '$lib/pure/rows';
import type { AwardState, DeletionFacts } from '$lib/pure/request-delete';
import { encodeToken, hashToken, TOKEN_BYTES } from '$lib/pure/token';
import { fromDatabase, StoreError } from './errors';
import { DEFAULT_INVITATION_DAYS } from './store';

export interface RequestOverview {
	readonly id: string;
	readonly code: string;
	readonly title: string | null;
	readonly round: number;
	readonly status: RequestRow['status'];
	readonly dueDate: string | null;
	readonly issuedAt: string | null;
	readonly invited: number;
	readonly submitted: number;
}

/** A request in the list across a site: the overview and its project. */
export interface SiteRequestOverview extends RequestOverview {
	readonly projectId: number;
}

export interface InvitationView {
	readonly vendor: InvitedVendor;
	readonly state: InvitationState;
	readonly expiresAt: string;
	readonly createdAt: string;
}

const INVITATION_FACTS = 'id, request_id, expires_at, revoked_at, last_opened_at';
const INVITATION_COLUMNS = `${INVITATION_FACTS}, vendor_name, vendor_group_id, contact_email, details, created_at`;
const BID_FACTS = 'invitation_id, request_id, version, status, submitted_at, withdrawn_at';

type Query = any;

async function run<T>(query: PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>): Promise<T> {
	const { data, error } = await query;
	if (error) throw fromDatabase(error);
	return data as T;
}

export interface RequestsOptions {
	readonly now?: () => Date;
	readonly random?: (length: number) => Uint8Array;
}

export function createRequests(db: SupabaseClient, options: RequestsOptions = {}) {
	const now = options.now ?? (() => new Date());
	const random = options.random ?? ((length: number) => crypto.getRandomValues(new Uint8Array(length)));

	function read(principal: ProductionPrincipal, table: Table, columns: string): Query {
		const given = scope(principal, table, 'read');
		let query: Query = db.from(table).select(columns).match(given.eq);
		for (const [column, values] of Object.entries(given.in ?? {})) query = query.in(column, [...values]);
		return query;
	}

	/** Requests newest first, with how many vendors are invited and have submitted, read through `scoped`. */
	async function overview(scoped: (table: Table, columns: string) => Query): Promise<(RequestOverview & { projectId: number })[]> {
		const rows = await run<RequestRow[]>(scoped('bid_requests', '*').order('created_at', { ascending: false }));
		if (rows.length === 0) return [];
		const ids = rows.map((row) => row.id);
		const invitations = await run<InvitationFacts[]>(scoped('invitations', INVITATION_FACTS).in('request_id', ids));
		const bids = await run<BidFacts[]>(scoped('bids', BID_FACTS).in('request_id', ids));
		const counts = requestCounts(invitations, bids, now());
		return rows.map((row) => {
			const header = row.header as Partial<RequestHeader>;
			const count = counts.get(row.id) ?? { invited: 0, submitted: 0 };
			return {
				id: row.id,
				projectId: row.project_id,
				code: row.code,
				title: typeof header.title === 'string' ? header.title : null,
				round: row.round,
				status: row.status,
				dueDate: row.due_on,
				issuedAt: row.issued_at,
				...count
			};
		});
	}

	/** The project's requests, newest first, with how many vendors are invited and have submitted. */
	async function listOverview(principal: ProductionPrincipal): Promise<RequestOverview[]> {
		const rows = await overview((table, columns) => read(principal, table, columns));
		return rows.map(({ projectId: _, ...row }) => row);
	}

	/**
	 * The requests of every project the server verified for the person on the site (`siteScope`),
	 * newest first, each with its project. No project, no read.
	 */
	async function listAcross(principal: SitePrincipal): Promise<SiteRequestOverview[]> {
		siteScope(principal, 'bid_requests');
		if (principal.projectIds.length === 0) return [];
		return overview((table, columns) => {
			const given = siteScope(principal, table);
			let query: Query = db.from(table).select(columns).match(given.eq);
			for (const [column, values] of Object.entries(given.in ?? {})) query = query.in(column, [...values]);
			return query;
		});
	}

	/** A request's invitations, oldest first, each with its state. */
	async function listInvitations(principal: ProductionPrincipal, requestId: string): Promise<InvitationView[]> {
		const request = await run<{ id: string } | null>(read(principal, 'bid_requests', 'id').eq('id', requestId).maybeSingle());
		if (!request) throw new StoreError(404, 'No such request.');
		const rows = await run<(InvitationFacts & VendorColumns & { created_at: string })[]>(
			read(principal, 'invitations', INVITATION_COLUMNS).eq('request_id', requestId).order('created_at')
		);
		const bids = await run<BidFacts[]>(read(principal, 'bids', BID_FACTS).eq('request_id', requestId));
		const at = now();
		return rows.map((row) => ({ vendor: vendorFromRow(row), state: invitationState(row, bids, at), expiresAt: row.expires_at, createdAt: row.created_at }));
	}

	/**
	 * A new link for an invitation: the old one stops working at once, a revoked invitation is live
	 * again, and the vendor keeps its bids. The token is answered once; only its hash is stored.
	 */
	async function reissueInvitation(principal: ProductionPrincipal, invitationId: string, expiresAt?: Date): Promise<{ token: string; expiresAt: string }> {
		const invitation = await run<{ request_id: string } | null>(read(principal, 'invitations', 'request_id').eq('id', invitationId).maybeSingle());
		if (!invitation) throw new StoreError(404, 'No such invitation.');
		const request = await run<{ status: string } | null>(read(principal, 'bid_requests', 'status').eq('id', invitation.request_id).maybeSingle());
		if (!request) throw new StoreError(404, 'No such invitation.');
		if (request.status === 'closed') throw new StoreError(409, 'The request is closed.');
		const token = encodeToken(random(TOKEN_BYTES));
		const expires = (expiresAt ?? new Date(now().getTime() + DEFAULT_INVITATION_DAYS * 86_400_000)).toISOString();
		const given = scope(principal, 'invitations', 'update');
		const row = await run<{ expires_at: string } | null>(
			db
				.from('invitations')
				.update({ token_hash: hashToken(token), revoked_at: null, expires_at: expires })
				.match(given.eq)
				.eq('id', invitationId)
				.select('expires_at')
				.maybeSingle()
		);
		if (!row) throw new StoreError(404, 'No such invitation.');
		return { token, expiresAt: row.expires_at };
	}

	/** A request's status and stamps, which `store.getRequest`'s model does not carry. */
	async function requestMeta(principal: ProductionPrincipal, requestId: string): Promise<Pick<RequestOverview, 'status' | 'issuedAt'>> {
		const row = await run<Pick<RequestRow, 'status' | 'issued_at'> | null>(read(principal, 'bid_requests', 'status, issued_at').eq('id', requestId).maybeSingle());
		if (!row) throw new StoreError(404, 'No such request.');
		return { status: row.status, issuedAt: row.issued_at };
	}

	/** How many rows of `table` the request has, in the principal's tenant. */
	async function count(principal: ProductionPrincipal, table: Table, requestId: string, extra: Record<string, string> = {}): Promise<number> {
		const given = scope(principal, table, 'read');
		let query: Query = db.from(table).select('id', { count: 'exact', head: true }).match(given.eq).match(extra).eq('request_id', requestId);
		for (const [column, values] of Object.entries(given.in ?? {})) query = query.in(column, [...values]);
		const { count: n, error } = await query;
		if (error) throw fromDatabase(error);
		return n ?? 0;
	}

	/**
	 * What deleting the request would take with it, for the confirm (`$lib/pure/request-delete`):
	 * its items, invitations, the submitted and withdrawn bids and their vendors, scenarios, rates,
	 * and the award record while one is in Flow PT. A vendor's draft is not read: it is the vendor's.
	 */
	async function deletionFacts(principal: ProductionPrincipal, requestId: string): Promise<DeletionFacts> {
		const row = await run<RequestRow | null>(read(principal, 'bid_requests', '*').eq('id', requestId).maybeSingle());
		if (!row) throw new StoreError(404, 'No such request.');
		const [shots, assets, scenarios, rates, invitations, bids, publication] = await Promise.all([
			count(principal, 'request_items', requestId, { kind: 'shot' }),
			count(principal, 'request_items', requestId, { kind: 'asset' }),
			count(principal, 'award_scenarios', requestId),
			count(principal, 'bid_rates', requestId),
			run<{ id: string; vendor_name: string }[]>(read(principal, 'invitations', 'id, vendor_name').eq('request_id', requestId).order('created_at')),
			run<{ invitation_id: string }[]>(read(principal, 'bids', 'invitation_id').eq('request_id', requestId)),
			run<{ state: AwardState } | null>(read(principal, 'award_publications', 'state').eq('request_id', requestId).maybeSingle())
		]);
		const bidding = new Set(bids.map((b) => b.invitation_id));
		const header = row.header as Partial<RequestHeader>;
		return {
			id: row.id,
			code: row.code,
			title: typeof header.title === 'string' ? header.title : null,
			round: row.round,
			status: row.status,
			shots,
			assets,
			invitations: invitations.length,
			bids: bids.length,
			vendors: invitations.filter((i) => bidding.has(i.id)).map((i) => i.vendor_name),
			scenarios,
			rates,
			award: publication?.state ?? null
		};
	}

	return { listOverview, listAcross, listInvitations, reissueInvitation, requestMeta, deletionFacts };
}

export type Requests = ReturnType<typeof createRequests>;
