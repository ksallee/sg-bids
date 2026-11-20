/**
 * Production's overview reads and the link re-issue, beside `store.ts` and held to the same rules:
 * every query carries the principal's filter from `$lib/pure/access`, and production reads only
 * submitted and withdrawn bids (a draft is the vendor's).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { scope, type ProductionPrincipal, type Table } from '$lib/pure/access';
import { invitationState, requestCounts, type BidFacts, type InvitationFacts, type InvitationState } from '$lib/pure/invitations';
import type { InvitedVendor, RequestHeader } from '$lib/pure/model';
import { vendorFromRow, type RequestRow, type VendorColumns } from '$lib/pure/rows';
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

	/** The project's requests, newest first, with how many vendors are invited and have submitted. */
	async function listOverview(principal: ProductionPrincipal): Promise<RequestOverview[]> {
		const rows = await run<RequestRow[]>(read(principal, 'bid_requests', '*').order('created_at', { ascending: false }));
		if (rows.length === 0) return [];
		const ids = rows.map((row) => row.id);
		const invitations = await run<InvitationFacts[]>(read(principal, 'invitations', INVITATION_FACTS).in('request_id', ids));
		const bids = await run<BidFacts[]>(read(principal, 'bids', BID_FACTS).in('request_id', ids));
		const counts = requestCounts(invitations, bids, now());
		return rows.map((row) => {
			const header = row.header as Partial<RequestHeader>;
			const count = counts.get(row.id) ?? { invited: 0, submitted: 0 };
			return {
				id: row.id,
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

	return { listOverview, listInvitations, reissueInvitation, requestMeta };
}

export type Requests = ReturnType<typeof createRequests>;
