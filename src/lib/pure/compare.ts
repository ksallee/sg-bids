/**
 * The comparison of several vendor bids on one request, and the cost of an award scenario.
 *
 * The grid has a column per bid and a row per shot, then per asset, in the request's order. A cell
 * is a price, an excluded line, or a missing one. A zero price is a price.
 *
 * Each vendor bids in its own currency. Production sets the rate to the base currency per bid,
 * with its date (`applyRate`). Until a bid has one, its prices and totals have no base figure:
 * `base` is null, and the screen says "needs a rate". An unknown is never a zero.
 *
 * The lowest known base price in a row is marked; ties are all marked. A price's spread is how far
 * it sits over the row's lowest, in basis points (1% is 100), rounded half away from zero. Over a
 * lowest of zero the spread is infinite.
 *
 * A scenario's cost is the picked lines only, each line converted to the base currency, then its
 * share taken and rounded half away from zero. Non-shot costs, discount and tax stay with the
 * bid's grand total; `applyScenario` leaves them out. `scenario.ts` adds the non-shot costs as a
 * line per vendor the user can leave out.
 */

import type { AwardScenario, BidLine, BidRequest, Id, Percent, Target, VendorBid } from './model';
import { targetKey } from './model';
import { add, divideRounded, money, sum, type Money, type Rate } from './money';
import { comparePercent, percentOf, sumPercents } from './percent';
import { estimateRebate } from './rebate';
import { bidTotals, toBase } from './totals';

/** An amount in the bid currency, and in the base currency once the bid has a rate. */
export interface Converted {
	readonly bid: Money;
	/** Null until production sets the bid's rate. */
	readonly base: Money | null;
}

export type Cell =
	| {
			readonly kind: 'price';
			readonly lineId: Id;
			readonly amount: Converted;
			readonly lowest: boolean;
			/** Over the row's lowest, in basis points. Null when either base price is unknown. */
			readonly spreadBp: number | null;
	  }
	| { readonly kind: 'excluded'; readonly lineId: Id }
	| { readonly kind: 'missing' };

export interface Column {
	readonly bidId: Id;
	readonly vendorId: Id;
	readonly currency: string;
	readonly rate: Rate | null;
	/** The bid is in another currency and has no rate yet. */
	readonly needsRate: boolean;
}

export interface Row {
	readonly target: Target;
	/** The shot code or the asset name. */
	readonly label: string;
	readonly description?: string;
	readonly episode?: string;
	readonly sequence?: string;
	readonly omitted: boolean;
	/** The row's place in the request, for the default order. */
	readonly index: number;
	/** One per column, in the columns' order. */
	readonly cells: readonly Cell[];
	/** The lowest known base price, in minor units. Null when no cell has one. */
	readonly lowest: number | null;
	/** The columns holding the lowest price. */
	readonly lowestColumns: readonly number[];
	/** The highest known base price over the lowest, in basis points. Null under two known prices. */
	readonly rangeBp: number | null;
	/** Priced cells whose bid has no rate yet. */
	readonly unconverted: number;
}

export interface ColumnTotals {
	readonly bidId: Id;
	readonly vendorId: Id;
	/** Lines, excluded ones skipped. */
	readonly items: Converted;
	readonly costs: Converted;
	readonly discount: Converted;
	readonly tax: Converted;
	readonly grand: Converted;
	/** Null when a split is unknown: a labour base with a line lacking department detail. */
	readonly rebate: Converted | null;
	readonly afterRebate: Converted | null;
	readonly splits: number;
	readonly coveredPercent: Percent;
	readonly labourDetailMissing: boolean;
	readonly linesWithoutDetail: number;
}

export interface Grid {
	readonly baseCurrency: string;
	readonly columns: readonly Column[];
	readonly rows: readonly Row[];
	readonly totals: readonly ColumnTotals[];
}

interface Entry {
	readonly target: Target;
	readonly label: string;
	readonly omitted: boolean;
	readonly description?: string;
	readonly episode?: string;
	readonly sequence?: string;
}

function targets(request: BidRequest): Entry[] {
	return [
		...request.shots.map((s) => ({
			target: { kind: 'shot', id: s.id } as const,
			label: s.code,
			omitted: s.omitted,
			description: s.description,
			episode: s.episode,
			sequence: s.sequence
		})),
		...request.assets.map((a) => ({ target: { kind: 'asset', id: a.id } as const, label: a.name, omitted: a.omitted === true, description: a.description }))
	];
}

/** The bid's lines by target key. Throws on a line for a target the request lacks, or two lines for one. */
function linesByTarget(request: BidRequest, bid: VendorBid, known: ReadonlySet<string>): Map<string, BidLine> {
	if (bid.requestId !== request.id) throw new Error(`Bid ${bid.id} answers request ${bid.requestId}, not ${request.id}.`);
	const lines = new Map<string, BidLine>();
	for (const line of bid.lines) {
		const key = targetKey(line.target);
		if (!known.has(key)) throw new Error(`Bid ${bid.id} has line ${line.id} for ${line.target.kind} ${line.target.id}, not in the request.`);
		if (lines.has(key)) throw new Error(`Bid ${bid.id} has two lines for ${line.target.kind} ${line.target.id}.`);
		lines.set(key, line);
	}
	return lines;
}

/** The bid with production's rate on it. A bid in the base currency takes none. */
export function applyRate(bid: VendorBid, base: string, rate: Rate | null): VendorBid {
	if (bid.currency === base) return { ...bid, rate: null };
	if (rate && (rate.from !== bid.currency || rate.to !== base)) {
		throw new Error(`Bid ${bid.id} needs a rate from ${bid.currency} to ${base}; it has ${rate.from} to ${rate.to}.`);
	}
	return { ...bid, rate };
}

export function needsRate(bid: VendorBid, base: string): boolean {
	return bid.currency !== base && bid.rate === null;
}

/** How far `price` sits over `lowest`, in basis points. Infinite over a lowest of zero. */
export function spreadBp(price: number, lowest: number): number {
	if (price === lowest) return 0;
	if (lowest === 0) return Number.POSITIVE_INFINITY;
	return Number(divideRounded((BigInt(price) - BigInt(lowest)) * 10_000n, BigInt(lowest)));
}

function totalsOf(bid: VendorBid, base: string): ColumnTotals {
	const unknown = needsRate(bid, base);
	// Without a rate, the bid's own currency is its base: every bid figure is right, no base one is known.
	const own = unknown ? bid.currency : base;
	const totals = bidTotals(bid, own);
	const rebate = estimateRebate(bid, own);
	const conv = (dual: { bid: Money; base: Money }): Converted => ({ bid: dual.bid, base: unknown ? null : dual.base });
	return {
		bidId: bid.id,
		vendorId: bid.vendorId,
		items: conv(totals.lines),
		costs: conv(totals.costs),
		discount: conv(totals.discount),
		tax: conv(totals.tax),
		grand: conv(totals.grand),
		rebate: rebate.rebate && conv(rebate.rebate),
		afterRebate: rebate.afterRebate && conv(rebate.afterRebate),
		splits: bid.rebate.length,
		coveredPercent: rebate.coveredPercent,
		labourDetailMissing: rebate.labourDetailMissing,
		linesWithoutDetail: rebate.linesWithoutDetail.length
	};
}

export function compareBids(request: BidRequest, bids: readonly VendorBid[]): Grid {
	const base = request.header.baseCurrency;
	const all = targets(request);
	const known = new Set(all.map((t) => targetKey(t.target)));
	const byBid = bids.map((bid) => linesByTarget(request, bid, known));

	const rows = all.map((entry, index): Row => {
		const key = targetKey(entry.target);
		const priced = bids.map((bid, column): Cell => {
			const line = byBid[column].get(key);
			if (!line) return { kind: 'missing' };
			if (line.excluded) return { kind: 'excluded', lineId: line.id };
			const converted = needsRate(bid, base) ? null : toBase(line.total, bid, base);
			return { kind: 'price', lineId: line.id, amount: { bid: line.total, base: converted }, lowest: false, spreadBp: null };
		});
		const known = priced.flatMap((c) => (c.kind === 'price' && c.amount.base ? [c.amount.base.minor] : []));
		const lowest = known.length > 0 ? Math.min(...known) : null;
		const highest = known.length > 0 ? Math.max(...known) : null;
		const lowestColumns: number[] = [];
		const cells = priced.map((c, column): Cell => {
			if (c.kind !== 'price' || !c.amount.base || lowest === null) return c;
			const isLowest = c.amount.base.minor === lowest;
			if (isLowest) lowestColumns.push(column);
			return { ...c, lowest: isLowest, spreadBp: spreadBp(c.amount.base.minor, lowest) };
		});
		return {
			target: entry.target,
			label: entry.label,
			...(entry.description !== undefined ? { description: entry.description } : {}),
			...(entry.episode !== undefined ? { episode: entry.episode } : {}),
			...(entry.sequence !== undefined ? { sequence: entry.sequence } : {}),
			omitted: entry.omitted,
			index,
			cells,
			lowest,
			lowestColumns,
			rangeBp: known.length >= 2 && lowest !== null && highest !== null ? spreadBp(highest, lowest) : null,
			unconverted: priced.filter((c) => c.kind === 'price' && c.amount.base === null).length
		};
	});

	return {
		baseCurrency: base,
		columns: bids.map((b) => ({ bidId: b.id, vendorId: b.vendorId, currency: b.currency, rate: b.rate, needsRate: needsRate(b, base) })),
		rows,
		totals: bids.map((bid) => totalsOf(bid, base))
	};
}

// Versions: which bid of each vendor the grid shows.

export interface BidRecord {
	readonly bidId: Id;
	readonly vendorId: Id;
	readonly version: number;
	readonly status: 'submitted' | 'withdrawn';
}

/**
 * The bid shown per vendor: the one asked for, else the latest submitted version. A vendor whose
 * every version is withdrawn shows none. Answered in the order vendors first appear.
 */
export function shownVersions(records: readonly BidRecord[], asked: readonly Id[] = []): Id[] {
	const byId = new Map(records.map((r) => [r.bidId, r]));
	const chosen = new Map<Id, BidRecord>();
	for (const id of asked) {
		const record = byId.get(id);
		if (record) chosen.set(record.vendorId, record);
	}
	const vendors = [...new Set(records.map((r) => r.vendorId))];
	return vendors.flatMap((vendorId) => {
		const pick = chosen.get(vendorId);
		if (pick) return [pick.bidId];
		const latest = records.filter((r) => r.vendorId === vendorId && r.status === 'submitted').sort((a, b) => b.version - a.version)[0];
		return latest ? [latest.bidId] : [];
	});
}

// The scenario's cost, strict: every pick must be valid.

export interface ScenarioResult {
	/** The picked lines' cost in the base currency. */
	readonly total: Money;
	/** Each picked vendor's part of the total, in the order of the bids given. */
	readonly perVendor: readonly { readonly vendorId: Id; readonly amount: Money }[];
	/** The shots and assets not omitted that the scenario picks no one for. */
	readonly unpicked: readonly Target[];
}

export function applyScenario(request: BidRequest, bids: readonly VendorBid[], scenario: AwardScenario): ScenarioResult {
	if (scenario.requestId !== request.id) {
		throw new Error(`Scenario ${scenario.id} is for request ${scenario.requestId}, not ${request.id}.`);
	}
	const base = request.header.baseCurrency;
	const all = targets(request);
	const known = new Set(all.map((t) => targetKey(t.target)));
	const lines = new Map(bids.map((bid) => [bid.id, linesByTarget(request, bid, known)]));
	const bidsById = new Map(bids.map((bid) => [bid.id, bid]));
	const perVendor = new Map<Id, Money>();
	const picked = new Set<string>();

	for (const pick of scenario.picks) {
		const key = targetKey(pick.target);
		const name = `${pick.target.kind} ${pick.target.id}`;
		if (!known.has(key)) throw new Error(`The scenario picks ${name}, not in the request.`);
		if (picked.has(key)) throw new Error(`The scenario picks ${name} twice.`);
		picked.add(key);
		const shares = pick.shares.map((s) => s.percent);
		if (comparePercent(sumPercents(shares), '100') !== 0) {
			throw new Error(`The shares of ${name} sum to ${sumPercents(shares)}%, not 100%.`);
		}
		for (const share of pick.shares) {
			const bid = bidsById.get(share.bidId);
			if (!bid) throw new Error(`The scenario picks bid ${share.bidId} for ${name}; no such bid.`);
			const line = lines.get(bid.id)?.get(key);
			if (!line) throw new Error(`Bid ${bid.id} has no line for ${name}.`);
			if (line.excluded) throw new Error(`Bid ${bid.id} excluded ${name}.`);
			const amount = percentOf(toBase(line.total, bid, base), share.percent);
			perVendor.set(bid.vendorId, add(perVendor.get(bid.vendorId) ?? money(0, base), amount));
		}
	}

	const vendors = [...new Set(bids.map((b) => b.vendorId))].filter((v) => perVendor.has(v));
	const parts = vendors.map((vendorId) => ({ vendorId, amount: perVendor.get(vendorId)! }));
	return {
		total: sum(
			parts.map((p) => p.amount),
			base
		),
		perVendor: parts,
		unpicked: all.filter((t) => !t.omitted && !picked.has(targetKey(t.target))).map((t) => t.target)
	};
}
