/**
 * Production's comparison reads and the award scenarios, beside `store.ts` and held to the same
 * rules: every query carries the principal's filter from `$lib/pure/access`, so production reads
 * only submitted and withdrawn bids (a draft is the vendor's), and every write is a SQL function
 * or a filtered update in the verified tenant.
 *
 * The rate of a bid is production's (`bid_rates`), set after submission and locked by the
 * database at the award. The bids this answers carry it; a bid without one has `rate: null`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { scope, type ProductionPrincipal, type Table } from '$lib/pure/access';
import { applyRate, shownVersions, type BidRecord } from '$lib/pure/compare';
import type { AwardScenario, BidRequest, Id, ScenarioPick, VendorBid } from '$lib/pure/model';
import { targetKey } from '$lib/pure/model';
import { rate as lockRate, type Rate } from '$lib/pure/money';
import { comparePercent, sumPercents } from '$lib/pure/percent';
import {
	bidFromRows,
	requestFromRows,
	scenarioFromRows,
	scenarioToRows,
	vendorFromRow,
	type BidLineRow,
	type BidRow,
	type InvitationRow,
	type RequestItemRow,
	type RequestRow,
	type ScenarioItemRow,
	type ScenarioRow
} from '$lib/pure/rows';
import { fromDatabase, StoreError } from './errors';

type Query = any;

async function run<T>(query: PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>): Promise<T> {
	const { data, error } = await query;
	if (error) throw fromDatabase(error);
	return data as T;
}

export interface BidVersion extends BidRecord {
	readonly number: string;
	readonly date: string;
	readonly currency: string;
	readonly submittedAt: string | null;
	readonly withdrawnAt: string | null;
}

export interface StoredRate {
	readonly bidId: Id;
	readonly rate: Rate;
	readonly setAt: string;
}

export interface StoredScenario extends AwardScenario {
	readonly chosen: boolean;
	/** Bids whose non-shot costs the scenario does not count. */
	readonly costsLeftOut: readonly Id[];
	readonly updatedAt: string;
}

export interface Comparison {
	readonly request: BidRequest;
	/** Production's reference for the request. */
	readonly code: string;
	readonly status: RequestRow['status'];
	/** Every submitted and withdrawn bid, oldest first. */
	readonly versions: readonly BidVersion[];
	/** The bids shown, one per vendor, production's rate on each. */
	readonly bids: readonly VendorBid[];
	readonly rates: readonly StoredRate[];
	readonly scenarios: readonly StoredScenario[];
	/** The request has an award: rates are locked. */
	readonly awarded: boolean;
}

export interface ScenarioInput {
	readonly id?: Id;
	readonly name: string;
	readonly picks: readonly ScenarioPick[];
	readonly costsLeftOut: readonly Id[];
}

interface RateRow {
	bid_id: string;
	request_id: string;
	rate: string;
	rate_date: string;
	set_at: string;
}

/** Every row of a query, a page at a time: PostgREST caps one answer (1000 rows on Supabase). */
async function paged<T>(make: () => Query, size = PAGE): Promise<T[]> {
	const out: T[] = [];
	for (let from = 0; ; from += size) {
		const page = await run<T[]>(make().order('id').range(from, from + size - 1));
		out.push(...page);
		if (page.length < size) return out;
	}
}

export const PAGE = 1000;

type StoredScenarioRow = ScenarioRow & { chosen: boolean; costs_left_out: unknown };

const INVITATION_COLUMNS = 'id, request_id, site_host, project_id, vendor_name, vendor_group_id, contact_email, details, expires_at, revoked_at, last_opened_at, created_at';

export interface ComparisonOptions {
	/** Rows per page of a long read. Supabase answers 1000 at most. */
	readonly page?: number;
}

export function createComparison(db: SupabaseClient, options: ComparisonOptions = {}) {
	const page = options.page ?? PAGE;
	const all = <T>(make: () => Query) => paged<T>(make, page);

	function read(principal: ProductionPrincipal, table: Table, columns = '*'): Query {
		const given = scope(principal, table, 'read');
		let query: Query = db.from(table).select(columns).match(given.eq);
		for (const [column, values] of Object.entries(given.in ?? {})) query = query.in(column, [...values]);
		return query;
	}

	function tenant(principal: ProductionPrincipal, table: Table, action: 'insert' | 'update' | 'delete') {
		return scope(principal, table, action).eq as { site_host: string; project_id: number };
	}

	async function requestRow(principal: ProductionPrincipal, requestId: string): Promise<RequestRow> {
		const row = await run<RequestRow | null>(read(principal, 'bid_requests').eq('id', requestId).maybeSingle());
		if (!row) throw new StoreError(404, 'No such request.');
		return row;
	}

	async function scenarioList(principal: ProductionPrincipal, requestId: string): Promise<StoredScenario[]> {
		const rows = await run<StoredScenarioRow[]>(read(principal, 'award_scenarios').eq('request_id', requestId).order('created_at'));
		if (rows.length === 0) return [];
		const items = await all<ScenarioItemRow>(() =>
			read(principal, 'award_scenario_items').in(
				'scenario_id',
				rows.map((r) => r.id)
			)
		);
		return rows.map((row) => ({
			...scenarioFromRows(
				row,
				items.filter((i) => i.scenario_id === row.id)
			),
			chosen: row.chosen,
			costsLeftOut: Array.isArray(row.costs_left_out) ? row.costs_left_out.filter((v): v is string => typeof v === 'string') : [],
			updatedAt: row.updated_at
		}));
	}

	/**
	 * The request, its submitted and withdrawn bids, the rates and the scenarios. Shown: the latest
	 * submitted version per vendor, or for a vendor the version named in `asked`.
	 */
	async function loadComparison(principal: ProductionPrincipal, requestId: string, asked: readonly string[] = []): Promise<Comparison> {
		const row = await requestRow(principal, requestId);
		const [items, invitations, bidRows, rateRows, awards, scenarios] = await Promise.all([
			all<RequestItemRow>(() => read(principal, 'request_items').eq('request_id', requestId)),
			run<Omit<InvitationRow, 'token_hash'>[]>(read(principal, 'invitations', INVITATION_COLUMNS).eq('request_id', requestId).order('created_at')),
			run<BidRow[]>(read(principal, 'bids').eq('request_id', requestId).order('created_at')),
			run<RateRow[]>(read(principal, 'bid_rates').eq('request_id', requestId)),
			run<{ id: string }[]>(read(principal, 'awards', 'id').eq('request_id', requestId).limit(1)),
			scenarioList(principal, requestId)
		]);
		const request = requestFromRows(row, items, invitations.map(vendorFromRow));
		const versions: BidVersion[] = bidRows.map((b) => {
			const header = b.header as { number?: string; date?: string };
			return {
				bidId: b.id,
				vendorId: b.invitation_id,
				version: b.version,
				status: b.status as 'submitted' | 'withdrawn',
				number: header.number ?? '',
				date: header.date ?? '',
				currency: b.currency,
				submittedAt: b.submitted_at,
				withdrawnAt: b.withdrawn_at
			};
		});
		const shown = shownVersions(versions, asked);
		const shownRows = shown.map((id) => bidRows.find((b) => b.id === id)!);
		const lines =
			shownRows.length === 0
				? []
				: await all<BidLineRow>(() =>
						read(principal, 'bid_lines').in(
							'bid_id',
							shownRows.map((b) => b.id)
						)
					);
		const base = row.base_currency;
		const rates: StoredRate[] = rateRows.flatMap((r) => {
			const bid = bidRows.find((b) => b.id === r.bid_id);
			return bid ? [{ bidId: r.bid_id, rate: lockRate(bid.currency, base, r.rate, r.rate_date), setAt: r.set_at }] : [];
		});
		const rateOf = new Map(rates.map((r) => [r.bidId, r.rate]));
		const bids = shownRows.map((b) =>
			applyRate(
				bidFromRows(
					b,
					lines.filter((l) => l.bid_id === b.id),
					{ round: row.round, baseCurrency: base }
				),
				base,
				rateOf.get(b.id) ?? null
			)
		);
		return { request, code: row.code, status: row.status, versions, bids, rates, scenarios, awarded: awards.length > 0 };
	}

	/** Set the rate of a bid to the base currency with its date, or clear it with null. */
	async function setRate(principal: ProductionPrincipal, requestId: string, bidId: string, value: { rate: string; date: string } | null): Promise<StoredRate | null> {
		const row = await requestRow(principal, requestId);
		const bid = await run<Pick<BidRow, 'id' | 'currency'> | null>(read(principal, 'bids', 'id, currency').eq('request_id', requestId).eq('id', bidId).maybeSingle());
		if (!bid) throw new StoreError(404, 'No such bid.');
		if (bid.currency === row.base_currency) throw new StoreError(422, 'The bid is in the base currency. It takes no rate.');
		let locked: Rate | null = null;
		if (value) {
			try {
				locked = lockRate(bid.currency, row.base_currency, value.rate, value.date);
			} catch (error) {
				throw new StoreError(422, error instanceof Error ? error.message : String(error));
			}
		}
		const t = tenant(principal, 'bid_rates', 'update');
		await run(
			db.rpc('sg_set_bid_rate', {
				p_request_id: requestId,
				p_site_host: t.site_host,
				p_project_id: t.project_id,
				p_bid_id: bidId,
				p_rate: locked?.rate ?? null,
				p_rate_date: locked?.date ?? null
			})
		);
		if (!locked) return null;
		const stored = await run<RateRow>(read(principal, 'bid_rates').eq('bid_id', bidId).single());
		return { bidId, rate: locked, setAt: stored.set_at };
	}

	function checkPicks(picks: readonly ScenarioPick[]): void {
		const seen = new Set<string>();
		for (const pick of picks) {
			const key = targetKey(pick.target);
			if (seen.has(key)) throw new StoreError(422, `The scenario picks ${pick.target.kind} ${pick.target.id} twice.`);
			seen.add(key);
			let total: string;
			try {
				total = sumPercents(pick.shares.map((share) => share.percent));
			} catch (error) {
				throw new StoreError(422, error instanceof Error ? error.message : String(error));
			}
			if (comparePercent(total, '100') !== 0) throw new StoreError(422, `The shares of ${pick.target.kind} ${pick.target.id} sum to ${total}%, not 100%.`);
		}
	}

	async function one(principal: ProductionPrincipal, requestId: string, scenarioId: string): Promise<StoredScenario> {
		const found = (await scenarioList(principal, requestId)).find((s) => s.id === scenarioId);
		if (!found) throw new StoreError(404, 'No such scenario.');
		return found;
	}

	async function saveScenario(principal: ProductionPrincipal, requestId: string, input: ScenarioInput): Promise<StoredScenario> {
		checkPicks(input.picks);
		const t = tenant(principal, 'award_scenarios', input.id ? 'update' : 'insert');
		const id = await run<string>(
			db.rpc('sg_save_award_scenario', {
				p_request_id: requestId,
				p_site_host: t.site_host,
				p_project_id: t.project_id,
				p_scenario_id: input.id ?? null,
				p_name: input.name,
				p_items: scenarioToRows(input.picks),
				p_costs_left_out: [...new Set(input.costsLeftOut)]
			})
		);
		return one(principal, requestId, id);
	}

	async function renameScenario(principal: ProductionPrincipal, requestId: string, scenarioId: string, name: string): Promise<StoredScenario> {
		const given = scope(principal, 'award_scenarios', 'update');
		const row = await run<{ id: string } | null>(
			db.from('award_scenarios').update({ name }).match(given.eq).eq('request_id', requestId).eq('id', scenarioId).select('id').maybeSingle()
		);
		if (!row) throw new StoreError(404, 'No such scenario.');
		return one(principal, requestId, scenarioId);
	}

	async function deleteScenario(principal: ProductionPrincipal, requestId: string, scenarioId: string): Promise<void> {
		const given = scope(principal, 'award_scenarios', 'delete');
		const row = await run<{ id: string } | null>(
			db.from('award_scenarios').delete().match(given.eq).eq('request_id', requestId).eq('id', scenarioId).select('id').maybeSingle()
		);
		if (!row) throw new StoreError(404, 'No such scenario.');
	}

	/** Mark one scenario as the chosen one; null unmarks. */
	async function chooseScenario(principal: ProductionPrincipal, requestId: string, scenarioId: string | null): Promise<StoredScenario[]> {
		const t = tenant(principal, 'award_scenarios', 'update');
		await run(db.rpc('sg_choose_scenario', { p_request_id: requestId, p_site_host: t.site_host, p_project_id: t.project_id, p_scenario_id: scenarioId }));
		return scenarioList(principal, requestId);
	}

	async function listScenarios(principal: ProductionPrincipal, requestId: string): Promise<StoredScenario[]> {
		await requestRow(principal, requestId);
		return scenarioList(principal, requestId);
	}

	return { loadComparison, setRate, listScenarios, saveScenario, renameScenario, deleteScenario, chooseScenario };
}

export type ComparisonStore = ReturnType<typeof createComparison>;
