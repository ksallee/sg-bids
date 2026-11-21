/**
 * Production's bids: the named sets of rows a request is made from, beside `store.ts` and held to
 * the same rules. Every query carries the principal's filter from `$lib/pure/access`; every write is
 * a SQL function in the verified tenant (`20261126100000_bids_first.sql`). A vendor principal reaches
 * none of this: `scope` refuses it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { scope, siteScope, type ProductionPrincipal, type SitePrincipal, type Table } from '$lib/pure/access';
import type { Id, ProductionBid, RequestAsset, RequestShot, Target } from '$lib/pure/model';
import type { RequestOfBid } from '$lib/pure/request-bids';
import { bidItemsToRows, productionBidFromRows, type ProductionBidItemRow, type ProductionBidRow, type RequestRow } from '$lib/pure/rows';
import { fromDatabase, StoreError } from './errors';

type Query = any;

async function run<T>(query: PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>): Promise<T> {
	const { data, error } = await query;
	if (error) throw fromDatabase(error);
	return data as T;
}

/** Rows per page of a long read. Supabase answers 1000 at most. */
const PAGE = 1000;

async function paged<T>(make: () => Query, size = PAGE): Promise<T[]> {
	const out: T[] = [];
	for (let from = 0; ; from += size) {
		const page = await run<T[]>(make().order('id').range(from, from + size - 1));
		out.push(...page);
		if (page.length < size) return out;
	}
}

/** A bid in a list: its counts and the requests it is in. */
export interface BidOverview {
	readonly id: Id;
	readonly projectId: number;
	readonly name: string;
	/** Rows not omitted, by kind. */
	readonly shots: number;
	readonly assets: number;
	readonly omitted: number;
	readonly frames: number;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly requests: readonly RequestOfBid[];
}

/** A bid with its rows, and the requests it is in. */
export interface LoadedBid {
	readonly bid: ProductionBid;
	readonly projectId: number;
	readonly updatedAt: string;
	readonly requests: readonly RequestOfBid[];
}

/** What deleting a bid would do: the drafts it leaves, the requests that keep what was issued. */
export interface BidDeletionFacts {
	readonly name: string;
	readonly drafts: readonly RequestOfBid[];
	readonly issued: readonly RequestOfBid[];
}

export interface BidDeleted {
	readonly name: string;
	readonly drafts: readonly { id: Id; code: string; round: number }[];
	readonly issued: readonly { id: Id; code: string; round: number }[];
}

const BID_COLUMNS = 'id, site_host, project_id, name, shot_count, asset_count, omitted_count, frame_count, created_at, updated_at';

type PackageLink = { request_id: string; bid_id: string };
type RequestFacts = Pick<RequestRow, 'id' | 'code' | 'round' | 'status' | 'header' | 'created_at'>;

function requestOf(row: RequestFacts): RequestOfBid {
	const title = (row.header as { title?: unknown }).title;
	return { id: row.id, code: row.code, round: row.round, status: row.status, title: typeof title === 'string' ? title : null, createdAt: row.created_at };
}

export function createProductionBids(db: SupabaseClient) {
	function read(principal: ProductionPrincipal, table: Table, columns = '*'): Query {
		const given = scope(principal, table, 'read');
		let query: Query = db.from(table).select(columns).match(given.eq);
		for (const [column, values] of Object.entries(given.in ?? {})) query = query.in(column, [...values]);
		return query;
	}

	function readAcross(site: SitePrincipal, table: Table, columns = '*'): Query {
		const given = siteScope(site, table);
		let query: Query = db.from(table).select(columns).match(given.eq);
		for (const [column, values] of Object.entries(given.in ?? {})) query = query.in(column, [...values]);
		return query;
	}

	function tenant(principal: ProductionPrincipal, table: Table, action: 'insert' | 'update' | 'delete') {
		return scope(principal, table, action).eq as { site_host: string; project_id: number };
	}

	/** The requests each bid is in, read through `scoped`. */
	async function requestsOf(scoped: (table: Table, columns: string) => Query, bidIds: readonly Id[]): Promise<Map<Id, RequestOfBid[]>> {
		const out = new Map<Id, RequestOfBid[]>();
		if (bidIds.length === 0) return out;
		const links = await paged<PackageLink>(() => scoped('request_packages', 'id, request_id, bid_id').in('bid_id', [...bidIds]));
		const ids = [...new Set(links.map((l) => l.request_id))];
		const requests = ids.length === 0 ? [] : await paged<RequestFacts>(() => scoped('bid_requests', 'id, code, round, status, header, created_at').in('id', ids));
		const byId = new Map(requests.map((r) => [r.id, requestOf(r)]));
		for (const link of links) {
			const request = byId.get(link.request_id);
			if (!request) continue;
			out.set(link.bid_id, [...(out.get(link.bid_id) ?? []), request]);
		}
		return out;
	}

	function overview(row: ProductionBidRow, requests: Map<Id, RequestOfBid[]>): BidOverview {
		return {
			id: row.id,
			projectId: row.project_id,
			name: row.name,
			shots: row.shot_count,
			assets: row.asset_count,
			omitted: row.omitted_count,
			frames: Number(row.frame_count),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			requests: requests.get(row.id) ?? []
		};
	}

	/** The project's bids, newest change first, each with its counts and the requests it is in. */
	async function list(principal: ProductionPrincipal): Promise<BidOverview[]> {
		const rows = await paged<ProductionBidRow>(() => read(principal, 'production_bids', BID_COLUMNS));
		const requests = await requestsOf((table, columns) => read(principal, table, columns), rows.map((r) => r.id));
		return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((row) => overview(row, requests));
	}

	/** The bids of every project the server verified for the person on the site (`siteScope`). No project, no read. */
	async function listAcross(site: SitePrincipal): Promise<BidOverview[]> {
		siteScope(site, 'production_bids');
		if (site.projectIds.length === 0) return [];
		const rows = await paged<ProductionBidRow>(() => readAcross(site, 'production_bids', BID_COLUMNS));
		const requests = await requestsOf((table, columns) => readAcross(site, table, columns), rows.map((r) => r.id));
		return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((row) => overview(row, requests));
	}

	async function bidRow(principal: ProductionPrincipal, id: Id): Promise<ProductionBidRow> {
		const row = await run<ProductionBidRow | null>(read(principal, 'production_bids', BID_COLUMNS).eq('id', id).maybeSingle());
		if (!row) throw new StoreError(404, 'No such bid.');
		return row;
	}

	/** The bids named, with their rows, by id. A bid not in the tenant is not there. */
	async function rowsOf(principal: ProductionPrincipal, ids: readonly Id[]): Promise<Map<Id, ProductionBid>> {
		const out = new Map<Id, ProductionBid>();
		if (ids.length === 0) return out;
		const [rows, items] = await Promise.all([
			run<ProductionBidRow[]>(read(principal, 'production_bids', BID_COLUMNS).in('id', [...ids])),
			paged<ProductionBidItemRow>(() => read(principal, 'production_bid_items').in('bid_id', [...ids]))
		]);
		for (const row of rows) out.set(row.id, productionBidFromRows(row, items.filter((i) => i.bid_id === row.id)));
		return out;
	}

	async function get(principal: ProductionPrincipal, id: Id): Promise<LoadedBid> {
		const row = await bidRow(principal, id);
		const [bids, requests] = await Promise.all([rowsOf(principal, [id]), requestsOf((table, columns) => read(principal, table, columns), [id])]);
		return { bid: bids.get(id)!, projectId: row.project_id, updatedAt: row.updated_at, requests: requests.get(id) ?? [] };
	}

	/** Create a bid (no id) or replace one's name and rows, in one write. Answers it as stored. */
	async function save(principal: ProductionPrincipal, input: { id: Id | null; name: string; shots: readonly RequestShot[]; assets: readonly RequestAsset[] }): Promise<LoadedBid> {
		const t = tenant(principal, 'production_bids', input.id ? 'update' : 'insert');
		let items: ReturnType<typeof bidItemsToRows>;
		try {
			items = bidItemsToRows(input.shots, input.assets);
		} catch (error) {
			throw new StoreError(422, error instanceof Error ? error.message : String(error));
		}
		const id = await run<string>(
			db.rpc('sg_save_production_bid', { p_bid_id: input.id, p_site_host: t.site_host, p_project_id: t.project_id, p_name: input.name, p_items: items })
		);
		return get(principal, id);
	}

	/** A copy named `<name> copy`, with every row. Answers the copy. */
	async function clone(principal: ProductionPrincipal, id: Id): Promise<LoadedBid> {
		const t = tenant(principal, 'production_bids', 'insert');
		const copy = await run<string>(db.rpc('sg_clone_production_bid', { p_bid_id: id, p_site_host: t.site_host, p_project_id: t.project_id }));
		return get(principal, copy);
	}

	/** What deleting the bid would do, for the confirm. */
	async function deletionFacts(principal: ProductionPrincipal, id: Id): Promise<BidDeletionFacts> {
		const loaded = await get(principal, id);
		return { name: loaded.bid.name, drafts: loaded.requests.filter((r) => r.status === 'draft'), issued: loaded.requests.filter((r) => r.status !== 'draft') };
	}

	/** Deletes the bid: out of its drafts, kept where it was issued. Refused while a vendor of a draft is invited to it alone. */
	async function remove(principal: ProductionPrincipal, id: Id): Promise<BidDeleted> {
		const t = tenant(principal, 'production_bids', 'delete');
		const gone = await run<BidDeleted>(db.rpc('sg_delete_production_bid', { p_bid_id: id, p_site_host: t.site_host, p_project_id: t.project_id }));
		return { ...gone, drafts: gone.drafts.map((d) => ({ ...d, round: Number(d.round) })), issued: gone.issued.map((d) => ({ ...d, round: Number(d.round) })) };
	}

	/** Rows of one bid copied, or moved, to another. A row the other holds stays as it is there. Answers how many it took, and the first bid as stored. */
	async function moveRows(principal: ProductionPrincipal, input: { from: Id; to: Id; rows: readonly Target[]; move: boolean }): Promise<{ taken: number; from: LoadedBid }> {
		const t = tenant(principal, 'production_bid_items', 'update');
		const taken = await run<number>(
			db.rpc('sg_move_bid_rows', {
				p_from: input.from,
				p_to: input.to,
				p_site_host: t.site_host,
				p_project_id: t.project_id,
				p_rows: input.rows.map((r) => ({ kind: r.kind, key: r.id })),
				p_move: input.move
			})
		);
		return { taken: Number(taken), from: await get(principal, input.from) };
	}

	return { list, listAcross, get, rowsOf, save, clone, deletionFacts, remove, moveRows };
}

export type ProductionBids = ReturnType<typeof createProductionBids>;
