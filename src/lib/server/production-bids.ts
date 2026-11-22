/**
 * A draft request's bids, beside `store.ts` and held to the same rules: every query carries the
 * principal's filter from `$lib/pure/access`. The writes are `sg_save_draft`, through the store. A
 * vendor principal reaches none of this: `scope` refuses it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { scope, type ProductionPrincipal, type Table } from '$lib/pure/access';
import type { Id, ProductionBid } from '$lib/pure/model';
import { productionBidFromRows, type ProductionBidItemRow, type ProductionBidRow } from '$lib/pure/rows';
import { fromDatabase } from './errors';

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

const BID_COLUMNS = 'id, site_host, project_id, name, shot_count, asset_count, omitted_count, frame_count, created_at, updated_at';

export function createProductionBids(db: SupabaseClient) {
	function read(principal: ProductionPrincipal, table: Table, columns = '*'): Query {
		const given = scope(principal, table, 'read');
		let query: Query = db.from(table).select(columns).match(given.eq);
		for (const [column, values] of Object.entries(given.in ?? {})) query = query.in(column, [...values]);
		return query;
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

	return { rowsOf };
}

export type ProductionBids = ReturnType<typeof createProductionBids>;
