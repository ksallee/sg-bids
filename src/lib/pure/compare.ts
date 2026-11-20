/**
 * The comparison of several vendor bids on one request, and the cost of an award scenario.
 *
 * The grid has a column per bid and a row per shot, then per asset, in the request's order. A cell
 * is a price in both currencies, an excluded line, or a missing one. A zero price is a price. The
 * lowest base price in a row is marked; ties are all marked.
 *
 * A scenario's cost is the picked lines only, each line converted to the base currency, then its
 * share taken and rounded half away from zero. Non-shot costs, discount and tax stay with the
 * bid's grand total; a scenario leaves them out.
 */

import type { AwardScenario, BidLine, BidRequest, Dual, Id, Target, VendorBid } from './model';
import { targetKey } from './model';
import { add, money, sum, type Money } from './money';
import { comparePercent, percentOf, sumPercents } from './percent';
import { estimateRebate } from './rebate';
import { bidTotals, toBase } from './totals';

export type Cell =
	| { readonly kind: 'price'; readonly lineId: Id; readonly amount: Dual; readonly lowest: boolean }
	| { readonly kind: 'excluded'; readonly lineId: Id }
	| { readonly kind: 'missing' };

export interface Column {
	readonly bidId: Id;
	readonly vendorId: Id;
}

export interface Row {
	readonly target: Target;
	/** The shot code or the asset name. */
	readonly label: string;
	readonly omitted: boolean;
	/** One per column, in the columns' order. */
	readonly cells: readonly Cell[];
}

export interface VendorTotal {
	readonly bidId: Id;
	readonly vendorId: Id;
	readonly gross: Dual;
	/** Null when a rebate split is unknown. */
	readonly afterRebate: Dual | null;
	readonly labourDetailMissing: boolean;
}

export interface Grid {
	readonly baseCurrency: string;
	readonly columns: readonly Column[];
	readonly rows: readonly Row[];
	readonly totals: readonly VendorTotal[];
}

interface Entry {
	readonly target: Target;
	readonly label: string;
	readonly omitted: boolean;
}

function targets(request: BidRequest): Entry[] {
	return [
		...request.shots.map((s) => ({ target: { kind: 'shot', id: s.id } as const, label: s.code, omitted: s.omitted })),
		...request.assets.map((a) => ({ target: { kind: 'asset', id: a.id } as const, label: a.name, omitted: false }))
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

export function compareBids(request: BidRequest, bids: readonly VendorBid[]): Grid {
	const base = request.header.baseCurrency;
	const all = targets(request);
	const known = new Set(all.map((t) => targetKey(t.target)));
	const byBid = bids.map((bid) => linesByTarget(request, bid, known));

	const rows = all.map(({ target, label, omitted }): Row => {
		const key = targetKey(target);
		const cells = bids.map((bid, index): Cell => {
			const line = byBid[index].get(key);
			if (!line) return { kind: 'missing' };
			if (line.excluded) return { kind: 'excluded', lineId: line.id };
			return { kind: 'price', lineId: line.id, amount: { bid: line.total, base: toBase(line.total, bid, base) }, lowest: false };
		});
		const prices = cells.flatMap((c) => (c.kind === 'price' ? [c.amount.base.minor] : []));
		const lowest = Math.min(...prices);
		return {
			target,
			label,
			omitted,
			cells: cells.map((c) => (c.kind === 'price' && c.amount.base.minor === lowest ? { ...c, lowest: true } : c))
		};
	});

	const totals = bids.map((bid): VendorTotal => {
		const rebate = estimateRebate(bid, base);
		return {
			bidId: bid.id,
			vendorId: bid.vendorId,
			gross: bidTotals(bid, base).grand,
			afterRebate: rebate.afterRebate,
			labourDetailMissing: rebate.labourDetailMissing
		};
	});

	return { baseCurrency: base, columns: bids.map((b) => ({ bidId: b.id, vendorId: b.vendorId })), rows, totals };
}

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
