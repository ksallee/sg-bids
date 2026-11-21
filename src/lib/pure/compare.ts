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
 *
 * Packages (`packages.ts`). A row in a package a vendor priced as one figure is a `package` cell:
 * in the package price, never a price, a zero or a gap. Row marks count row prices only. Each
 * package also compares as a unit (`Grid.packages`): a figure, or the sum of a vendor's row prices,
 * complete when it priced every row of the package not omitted. The lowest is marked among the
 * figures and the complete sums. A package priced as one figure goes to that vendor whole or not
 * at all: `applyScenario` refuses a part or a split of it. A package a vendor declined shows "Not
 * bidding" for it, row by row and as a unit, never a zero or a gap, and goes to anyone but it.
 */

import type { AwardScenario, BidLine, BidRequest, Id, Percent, Target, VendorBid } from './model';
import { targetKey } from './model';
import { add, divideRounded, money, sum, type Money, type Rate } from './money';
import { declinedOf, packagePrices, packageProblems, resolvePackages, type Resolved } from './packages';
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
	/** In the package price: the vendor priced the row's package as one figure. */
	| { readonly kind: 'package'; readonly lineId: Id; readonly package: Id }
	/** Not bidding: the vendor declined the row's package. */
	| { readonly kind: 'declined'; readonly package: Id }
	| { readonly kind: 'missing' };

/** A package against one bid: its one figure, or the sum of the bid's row prices in it. */
export type PackageCell =
	| {
			readonly kind: 'package';
			readonly amount: Converted;
			readonly lowest: boolean;
			readonly spreadBp: number | null;
	  }
	| {
			readonly kind: 'rows';
			readonly amount: Converted;
			/** Every row of the package not omitted has a price. Only then is the sum compared. */
			readonly complete: boolean;
			readonly priced: number;
			readonly excluded: number;
			readonly missing: number;
			readonly lowest: boolean;
			readonly spreadBp: number | null;
	  }
	/** The vendor declined the package. */
	| { readonly kind: 'declined' }
	| { readonly kind: 'none' };

/** A package compared as a unit. */
export interface PackageView {
	readonly id: Id;
	readonly name: string;
	/** Its rows not omitted, in the request's order. */
	readonly targets: readonly Target[];
	/** One per column. */
	readonly cells: readonly PackageCell[];
	/** The lowest known figure or complete sum, in base minor units. */
	readonly lowest: number | null;
	readonly lowestColumns: readonly number[];
	readonly rangeBp: number | null;
}

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
	/** The package the row sits in. */
	readonly package: Id;
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
	/** Each package as a unit, in the request's order. */
	readonly packages: readonly PackageView[];
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

/** Throws on the first way the bid's package prices do not hold together. */
function checkPackages(request: BidRequest, resolved: Resolved, bid: VendorBid): void {
	const problems = packageProblems(resolved, request, bid);
	if (problems.length > 0) throw new Error(`Bid ${bid.id}: ${problems[0]}`);
}

/** Lowest marks over known base figures: the lowest, the columns holding it, the spread of the highest. */
function marks(known: readonly { column: number; minor: number }[]): { lowest: number | null; columns: number[]; rangeBp: number | null } {
	if (known.length === 0) return { lowest: null, columns: [], rangeBp: null };
	const lowest = Math.min(...known.map((k) => k.minor));
	const highest = Math.max(...known.map((k) => k.minor));
	return { lowest, columns: known.filter((k) => k.minor === lowest).map((k) => k.column), rangeBp: known.length >= 2 ? spreadBp(highest, lowest) : null };
}

function packageViews(request: BidRequest, resolved: Resolved, bids: readonly VendorBid[], rows: readonly Row[]): PackageView[] {
	const base = request.header.baseCurrency;
	const rowByKey = new Map(rows.map((r) => [targetKey(r.target), r]));
	return resolved.packages.map((pkg): PackageView => {
		const targets = resolved.live.get(pkg.id) ?? [];
		const draft = bids.map((bid, column): PackageCell => {
			if (declinedOf(bid).has(pkg.id)) return { kind: 'declined' };
			const price = packagePrices(bid).get(pkg.id);
			if (price) {
				const converted = needsRate(bid, base) ? null : toBase(price.total, bid, base);
				return { kind: 'package', amount: { bid: price.total, base: converted }, lowest: false, spreadBp: null };
			}
			let total = money(0, bid.currency);
			let totalBase: Money | null = money(0, base);
			let priced = 0;
			let excluded = 0;
			let missing = 0;
			for (const target of targets) {
				const cell = rowByKey.get(targetKey(target))?.cells[column];
				if (cell?.kind === 'price') {
					priced++;
					total = add(total, cell.amount.bid);
					totalBase = totalBase && cell.amount.base ? add(totalBase, cell.amount.base) : null;
				} else if (cell?.kind === 'excluded') excluded++;
				else missing++;
			}
			if (priced === 0) return { kind: 'none' };
			return { kind: 'rows', amount: { bid: total, base: totalBase }, complete: priced === targets.length, priced, excluded, missing, lowest: false, spreadBp: null };
		});
		const comparable = (cell: PackageCell): cell is Extract<PackageCell, { kind: 'package' | 'rows' }> =>
			(cell.kind === 'package' || (cell.kind === 'rows' && cell.complete)) && cell.amount.base !== null;
		const known = draft.flatMap((cell, column) => (comparable(cell) ? [{ column, minor: cell.amount.base!.minor }] : []));
		const m = marks(known);
		const cells = draft.map((cell): PackageCell => {
			if (!comparable(cell) || m.lowest === null) return cell;
			return { ...cell, lowest: cell.amount.base!.minor === m.lowest, spreadBp: spreadBp(cell.amount.base!.minor, m.lowest) };
		});
		return { id: pkg.id, name: pkg.name, targets, cells, lowest: m.lowest, lowestColumns: m.columns, rangeBp: m.rangeBp };
	});
}

export function compareBids(request: BidRequest, bids: readonly VendorBid[]): Grid {
	const base = request.header.baseCurrency;
	const all = targets(request);
	const known = new Set(all.map((t) => targetKey(t.target)));
	const byBid = bids.map((bid) => linesByTarget(request, bid, known));
	const resolved = resolvePackages(request);
	for (const bid of bids) checkPackages(request, resolved, bid);
	const declined = bids.map(declinedOf);

	const rows = all.map((entry, index): Row => {
		const key = targetKey(entry.target);
		const priced = bids.map((bid, column): Cell => {
			const line = byBid[column].get(key);
			if (!line && declined[column].has(resolved.of.get(key)!)) return { kind: 'declined', package: resolved.of.get(key)! };
			if (!line) return { kind: 'missing' };
			if (line.excluded) return { kind: 'excluded', lineId: line.id };
			if (line.inPackage) return { kind: 'package', lineId: line.id, package: resolved.of.get(key)! };
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
			package: resolved.of.get(key)!,
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
		totals: bids.map((bid) => totalsOf(bid, base)),
		packages: packageViews(request, resolved, bids, rows)
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
	const resolved = resolvePackages(request);
	for (const bid of bids) checkPackages(request, resolved, bid);
	const labels = new Map(all.map((t) => [targetKey(t.target), t.label]));
	const perVendor = new Map<Id, Money>();
	const picked = new Set<string>();
	/** Rows given whole to a bid that priced their package as one figure: `bid|package` to row keys. */
	const wholes = new Map<string, Set<string>>();

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
			if (!line && declinedOf(bid).has(resolved.of.get(key)!)) {
				throw new Error(`Bid ${bid.id} is not bidding on ${resolved.packages.find((p) => p.id === resolved.of.get(key))?.name}. ${labels.get(key)} cannot go to it.`);
			}
			if (!line) throw new Error(`Bid ${bid.id} has no line for ${name}.`);
			if (line.excluded) throw new Error(`Bid ${bid.id} excluded ${name}.`);
			if (line.inPackage) {
				const pkg = resolved.of.get(key)!;
				const pkgName = resolved.packages.find((p) => p.id === pkg)?.name ?? pkg;
				if (pick.shares.length !== 1) throw new Error(`${labels.get(key)} is in ${pkgName}, which bid ${bid.id} priced as one figure. It cannot be split.`);
				const slot = `${bid.id}|${pkg}`;
				if (!wholes.has(slot)) wholes.set(slot, new Set());
				wholes.get(slot)!.add(key);
				continue;
			}
			const amount = percentOf(toBase(line.total, bid, base), share.percent);
			perVendor.set(bid.vendorId, add(perVendor.get(bid.vendorId) ?? money(0, base), amount));
		}
	}
	// A package priced as one figure is awarded whole: every row of it not omitted, to that bid. Its figure counts once.
	for (const [slot, rows] of wholes) {
		const [bidId, pkg] = slot.split('|');
		const bid = bidsById.get(bidId)!;
		const pkgName = resolved.packages.find((p) => p.id === pkg)?.name ?? pkg;
		const every = (resolved.live.get(pkg) ?? []).every((t) => rows.has(targetKey(t)));
		if (!every) throw new Error(`Bid ${bidId} priced ${pkgName} as one figure. The scenario gives it part of the package: it is awarded whole or not at all.`);
		const price = packagePrices(bid).get(pkg)!;
		perVendor.set(bid.vendorId, add(perVendor.get(bid.vendorId) ?? money(0, base), toBase(price.total, bid, base)));
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
