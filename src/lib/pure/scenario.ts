/**
 * Award scenarios on a comparison grid (`compare.ts`): the picks as the user edits them, the bulk
 * picks, and the live summary.
 *
 * Picks are kept by target key (`shot:sh010`), each a list of shares that sum to 100. A click picks
 * a vendor for a row at 100%, a second click on the same cell takes the pick off. A bulk pick
 * replaces the picks of the rows it covers; a row it cannot give (the vendor excluded it, did not
 * bid it, or no lowest is known yet) is left unpicked and counted as skipped. Omitted shots are
 * never picked.
 *
 * The summary is tolerant, as a screen needs: a pick on a cell that is no longer a price, or on a
 * bid not in the grid (another version), is listed as invalid and counts as unawarded.
 *
 * Non-shot costs: when a vendor has at least one row in the scenario, its bid's non-shot costs
 * show as a line of their own, counted in the total unless the user leaves them out. Discount and
 * tax stay with each bid's grand total. A figure that needs a rate makes the totals it feeds
 * unknown (null), never zero.
 *
 * Packages: a vendor that priced a package as one figure takes it whole or not at all. A click on
 * one of its rows picks every row of the package not omitted; a second click, or clearing a row,
 * takes them all off; a row price picked in its place takes the rest of the package off that vendor
 * too. A split with that vendor is refused. A bulk pick that covers part of such a package skips
 * its rows for that vendor. The lowest gives a package to its lowest figure when it beats its
 * rows' lowest prices summed. The summary counts the figure once, and lists a part as not fitting.
 */

import type { Cell, Converted, Grid, PackageView, Row } from './compare';
import type { Id, Percent, ScenarioPick, Target } from './model';
import { targetKey } from './model';
import { add, divideRounded, money, subtract, type Money } from './money';
import { comparePercent, isPercent, percentOf, sumPercents } from './percent';

export interface Share {
	readonly bidId: Id;
	readonly percent: Percent;
}

export type Picks = ReadonlyMap<string, readonly Share[]>;

export function picksFromList(list: readonly ScenarioPick[]): Map<string, readonly Share[]> {
	return new Map(list.map((pick) => [targetKey(pick.target), pick.shares.map((s) => ({ bidId: s.bidId, percent: s.percent }))]));
}

/** The picks as the model stores them, in the grid's row order. Picks for a target not in the grid are dropped. */
export function picksToList(grid: Grid, picks: Picks): ScenarioPick[] {
	return grid.rows.flatMap((row) => {
		const shares = picks.get(targetKey(row.target));
		return shares && shares.length ? [{ target: row.target, shares: [...shares] }] : [];
	});
}

const whole = (bidId: Id): readonly Share[] => [{ bidId, percent: '100' }];

function columnOf(grid: Grid, bidId: Id): number {
	return grid.columns.findIndex((c) => c.bidId === bidId);
}

const isWhole = (shares: readonly Share[] | undefined, bidId: Id): boolean =>
	shares?.length === 1 && shares[0].bidId === bidId && comparePercent(shares[0].percent, '100') === 0;

function packageOf(grid: Grid, id: Id): PackageView | undefined {
	return grid.packages.find((p) => p.id === id);
}

/** Packages given whole, in the grid's order, to the vendor that priced each as one figure. */
export function wholePackages(grid: Grid, picks: Picks): { bidId: Id; package: Id }[] {
	const out: { bidId: Id; package: Id }[] = [];
	for (const pkg of grid.packages) {
		pkg.cells.forEach((cell, column) => {
			const bidId = grid.columns[column].bidId;
			if (cell.kind === 'package' && pkg.targets.length > 0 && pkg.targets.every((t) => isWhole(picks.get(targetKey(t)), bidId))) out.push({ bidId, package: pkg.id });
		});
	}
	return out;
}

/**
 * What no scenario may hold of a package priced as one figure: part of it given to its vendor, or a
 * split of one of its rows with that vendor. Taken off.
 */
function keepWhole(grid: Grid, picks: Map<string, readonly Share[]>): Map<string, readonly Share[]> {
	for (const pkg of grid.packages) {
		pkg.cells.forEach((cell, column) => {
			if (cell.kind !== 'package') return;
			const bidId = grid.columns[column].bidId;
			const keys = pkg.targets.map(targetKey);
			for (const key of keys) {
				const shares = picks.get(key);
				if (shares && shares.length > 1 && shares.some((s) => s.bidId === bidId)) picks.delete(key);
			}
			const given = keys.filter((key) => isWhole(picks.get(key), bidId));
			if (given.length > 0 && given.length < keys.length) for (const key of given) picks.delete(key);
		});
	}
	return picks;
}

/** Every row of the package not omitted to the bid, whole. */
function giveWhole(next: Map<string, readonly Share[]>, pkg: PackageView, bidId: Id): void {
	for (const target of pkg.targets) next.set(targetKey(target), whole(bidId));
}

/**
 * Click a cell: pick its vendor for the row at 100%, or take the pick off when it is already that.
 * A row in the package price picks, or takes off, the whole package.
 */
export function pickCell(grid: Grid, picks: Picks, row: Row, column: number): Picks {
	const cell = row.cells[column];
	if (!cell || (cell.kind !== 'price' && cell.kind !== 'package') || row.omitted) return picks;
	const bidId = grid.columns[column].bidId;
	const key = targetKey(row.target);
	const next = new Map(picks);
	const current = picks.get(key);
	const again = current?.length === 1 && current[0].bidId === bidId;
	const pkg = cell.kind === 'package' ? packageOf(grid, cell.package) : undefined;
	if (pkg) {
		if (again) for (const target of pkg.targets) next.delete(targetKey(target));
		else giveWhole(next, pkg, bidId);
		return keepWhole(grid, next);
	}
	if (again) next.delete(key);
	else next.set(key, whole(bidId));
	return keepWhole(grid, next);
}

/** Take a row's pick off. With the grid, a row of a package given whole takes the whole package off. */
export function clearRow(picks: Picks, row: Row, grid?: Grid): Picks {
	const next = new Map(picks);
	next.delete(targetKey(row.target));
	return grid ? keepWhole(grid, next) : next;
}

export type SplitResult = { readonly ok: true; readonly picks: Picks } | { readonly ok: false; readonly message: string };

/** Split a row between vendors by percent. Zero shares drop out; the rest must be priced and sum to 100. */
export function setShares(grid: Grid, picks: Picks, row: Row, shares: readonly Share[]): SplitResult {
	if (row.omitted) return { ok: false, message: 'This shot is omitted.' };
	for (const share of shares) {
		if (!isPercent(share.percent.trim())) return { ok: false, message: `'${share.percent}' is not a percent.` };
	}
	const live = shares.map((s) => ({ bidId: s.bidId, percent: s.percent.trim() })).filter((s) => comparePercent(s.percent, '0') > 0);
	if (live.length === 0) return { ok: true, picks: clearRow(picks, row, grid) };
	if (new Set(live.map((s) => s.bidId)).size !== live.length) return { ok: false, message: 'A vendor appears twice.' };
	const inPackage = live.some((share) => row.cells[columnOf(grid, share.bidId)]?.kind === 'package');
	if (inPackage && live.length > 1) {
		const name = packageOf(grid, row.package)?.name ?? 'This package';
		return { ok: false, message: `${name} was priced as one figure by a vendor here. Give that vendor the whole package, or none of it.` };
	}
	for (const share of live) {
		const column = columnOf(grid, share.bidId);
		const kind = column < 0 ? null : row.cells[column].kind;
		if (kind !== 'price' && kind !== 'package') return { ok: false, message: 'Only a vendor that priced this row can take a share.' };
	}
	const total = sumPercents(live.map((s) => s.percent));
	if (comparePercent(total, '100') !== 0) return { ok: false, message: `The shares sum to ${total}%. They must sum to 100%.` };
	const next = new Map(picks);
	const pkg = inPackage ? packageOf(grid, row.package) : undefined;
	if (pkg) giveWhole(next, pkg, live[0].bidId);
	else next.set(targetKey(row.target), live);
	return { ok: true, picks: keepWhole(grid, next) };
}

export interface BulkResult {
	readonly picks: Picks;
	/** Live rows in scope that could not be given. */
	readonly skipped: number;
}

/**
 * Give every live row in `rows` to `column` where it priced the row; clear the rest. A package the
 * vendor priced as one figure goes whole when every row of it is in `rows`; else its rows are skipped.
 */
export function awardRows(grid: Grid, picks: Picks, rows: readonly Row[], column: number): BulkResult {
	const next = new Map(picks);
	let skipped = 0;
	const bidId = grid.columns[column]?.bidId;
	const scope = new Set(rows.map((r) => targetKey(r.target)));
	for (const row of rows) {
		const key = targetKey(row.target);
		next.delete(key);
		if (row.omitted) continue;
		const cell = bidId === undefined ? undefined : row.cells[column];
		if (cell?.kind === 'price') next.set(key, whole(bidId!));
		else if (cell?.kind === 'package' && packageOf(grid, cell.package)?.targets.every((t) => scope.has(targetKey(t)))) next.set(key, whole(bidId!));
		else skipped++;
	}
	return { picks: keepWhole(grid, next), skipped };
}

export function awardAll(grid: Grid, picks: Picks, column: number): BulkResult {
	return awardRows(grid, picks, grid.rows, column);
}

/**
 * Give each live row to its lowest known price, the first column on a tie. A package whose lowest
 * figure beats its rows' lowest prices summed goes whole to that figure's vendor, as it does when
 * a row of it has no lowest price at all.
 */
export function awardLowest(grid: Grid, picks: Picks, rows: readonly Row[] = grid.rows): BulkResult {
	const next = new Map(picks);
	let skipped = 0;
	const scope = new Set(rows.map((r) => targetKey(r.target)));
	const byKey = new Map(grid.rows.map((r) => [targetKey(r.target), r]));
	const done = new Set<string>();
	for (const row of rows) next.delete(targetKey(row.target));
	for (const pkg of grid.packages) {
		if (pkg.targets.length === 0 || !pkg.targets.every((t) => scope.has(targetKey(t)))) continue;
		let best: { column: number; minor: number } | null = null;
		pkg.cells.forEach((cell, column) => {
			if (cell.kind !== 'package' || !cell.amount.base) return;
			if (!best || cell.amount.base.minor < best.minor) best = { column, minor: cell.amount.base.minor };
		});
		if (!best) continue;
		const found = best as { column: number; minor: number };
		let rowsTotal: number | null = 0;
		for (const t of pkg.targets) {
			const low = byKey.get(targetKey(t))?.lowest;
			rowsTotal = rowsTotal === null || low === null || low === undefined ? null : rowsTotal + low;
		}
		if (rowsTotal !== null && found.minor >= rowsTotal) continue;
		giveWhole(next, pkg, grid.columns[found.column].bidId);
		for (const t of pkg.targets) done.add(targetKey(t));
	}
	for (const row of rows) {
		const key = targetKey(row.target);
		if (row.omitted || done.has(key)) continue;
		const column = row.lowestColumns[0];
		if (column === undefined) skipped++;
		else next.set(key, whole(grid.columns[column].bidId));
	}
	return { picks: keepWhole(grid, next), skipped };
}

// The summary.

export interface VendorPart {
	readonly bidId: Id;
	readonly vendorId: Id;
	readonly column: number;
	/** Rows with a share for this vendor; a split row counts for each vendor in it. */
	readonly rows: number;
	readonly splitRows: number;
	/** The picked lines, in the base currency. Null when the bid needs a rate. */
	readonly lines: Money | null;
	readonly costs: Converted;
	readonly costsIncluded: boolean;
	/** Lines plus the costs when included. */
	readonly total: Money | null;
	/** The part of the scenario total, in basis points. */
	readonly shareBp: number | null;
}

export interface ScenarioSummary {
	readonly lines: Money | null;
	/** The non-shot costs counted. */
	readonly costs: Money | null;
	readonly total: Money | null;
	/** Vendors with at least one row, in column order. */
	readonly vendors: readonly VendorPart[];
	/** Live rows with a valid pick. */
	readonly awarded: number;
	/** Rows not omitted. */
	readonly live: number;
	/** Live rows with no valid pick, in the grid's order. */
	readonly unawarded: readonly Target[];
	/** Picks that no longer fit the grid: a cell not priced, a bid not shown, shares not summing to 100. */
	readonly invalid: readonly Target[];
	/** Picked bids that need a rate. */
	readonly needsRate: readonly Id[];
	/** Packages priced as one figure given in part to their vendor: their rows are in `invalid`. */
	readonly partial: readonly { readonly bidId: Id; readonly package: Id; readonly name: string }[];
}

function validShares(grid: Grid, row: Row, shares: readonly Share[]): boolean {
	if (shares.length === 0) return false;
	try {
		if (comparePercent(sumPercents(shares.map((s) => s.percent)), '100') !== 0) return false;
	} catch {
		return false;
	}
	return shares.every((s) => {
		const column = columnOf(grid, s.bidId);
		if (column < 0) return false;
		const kind = row.cells[column].kind;
		return kind === 'price' || (kind === 'package' && shares.length === 1);
	});
}

const plus = (a: Money | null, b: Money | null): Money | null => (a && b ? add(a, b) : null);

function basisPoints(part: Money | null, whole: Money | null): number | null {
	if (!part || !whole || whole.minor <= 0) return null;
	return Number(divideRounded(BigInt(part.minor) * 10_000n, BigInt(whole.minor)));
}

export function summarize(grid: Grid, picks: Picks, leftOutCosts: ReadonlySet<Id> = new Set()): ScenarioSummary {
	const base = grid.baseCurrency;
	const zero = money(0, base);
	const lines: (Money | null)[] = grid.columns.map(() => zero);
	const rows = grid.columns.map(() => 0);
	const splits = grid.columns.map(() => 0);
	const unawarded: Target[] = [];
	const invalid: Target[] = [];
	const partial: { bidId: Id; package: Id; name: string }[] = [];
	let awarded = 0;
	let live = 0;

	// A package priced as one figure counts when every row of it goes whole to that vendor; else its rows do not fit.
	const broken = new Set<string>();
	for (const pkg of grid.packages) {
		pkg.cells.forEach((cell, column) => {
			if (cell.kind !== 'package') return;
			const bidId = grid.columns[column].bidId;
			const given = pkg.targets.filter((t) => picks.get(targetKey(t))?.some((s) => s.bidId === bidId));
			if (given.length === 0) return;
			if (given.length === pkg.targets.length && given.every((t) => isWhole(picks.get(targetKey(t)), bidId))) {
				lines[column] = plus(lines[column], cell.amount.base);
				return;
			}
			partial.push({ bidId, package: pkg.id, name: pkg.name });
			for (const t of given) broken.add(targetKey(t));
		});
	}

	for (const row of grid.rows) {
		if (row.omitted) continue;
		live++;
		const key = targetKey(row.target);
		const shares = picks.get(key);
		if (!shares || shares.length === 0) {
			unawarded.push(row.target);
			continue;
		}
		if (broken.has(key) || !validShares(grid, row, shares)) {
			invalid.push(row.target);
			unawarded.push(row.target);
			continue;
		}
		awarded++;
		for (const share of shares) {
			const column = columnOf(grid, share.bidId);
			const cell = row.cells[column] as Extract<Cell, { kind: 'price' | 'package' }>;
			rows[column]++;
			if (shares.length > 1) splits[column]++;
			if (cell.kind === 'package') continue;
			const amount = cell.amount.base ? percentOf(cell.amount.base, share.percent) : null;
			lines[column] = plus(lines[column], amount);
		}
	}

	const parts = grid.columns.flatMap((column, index) => {
		if (rows[index] === 0) return [];
		const costs = grid.totals[index].costs;
		const included = !leftOutCosts.has(column.bidId);
		const total = included ? plus(lines[index], costs.base) : lines[index];
		return [{ bidId: column.bidId, vendorId: column.vendorId, column: index, rows: rows[index], splitRows: splits[index], lines: lines[index], costs, costsIncluded: included, total }];
	});

	const sumOf = (values: (Money | null)[]) => values.reduce<Money | null>((a, b) => plus(a, b), zero);
	const lineTotal = sumOf(parts.map((p) => p.lines));
	const costTotal = sumOf(parts.filter((p) => p.costsIncluded).map((p) => p.costs.base));
	const total = plus(lineTotal, costTotal);

	return {
		lines: lineTotal,
		costs: costTotal,
		total,
		vendors: parts.map((p) => ({ ...p, shareBp: basisPoints(p.total, total) })),
		awarded,
		live,
		unawarded,
		invalid,
		needsRate: parts.filter((p) => grid.columns[p.column].needsRate).map((p) => p.bidId),
		partial
	};
}

export interface AgainstLowest {
	/** The scenario that gives each row to its lowest price, with the same non-shot cost choices. */
	readonly lowest: ScenarioSummary;
	/** This scenario's total less the lowest's. Null when either is unknown. */
	readonly difference: Money | null;
}

export function againstLowest(grid: Grid, summary: ScenarioSummary, leftOutCosts: ReadonlySet<Id> = new Set()): AgainstLowest {
	const lowest = summarize(grid, awardLowest(grid, new Map()).picks, leftOutCosts);
	return { lowest, difference: summary.total && lowest.total ? subtract(summary.total, lowest.total) : null };
}

function sameShares(a: readonly Share[] | undefined, b: readonly Share[] | undefined): boolean {
	const norm = (s: readonly Share[] | undefined) =>
		(s ?? [])
			.map((x) => `${x.bidId}=${x.percent}`)
			.sort()
			.join('|');
	return norm(a) === norm(b);
}

/** How many rows two scenarios pick differently. */
export function differingRows(a: Picks, b: Picks): number {
	const keys = new Set([...a.keys(), ...b.keys()]);
	let count = 0;
	for (const key of keys) if (!sameShares(a.get(key), b.get(key))) count++;
	return count;
}

/** The picks a row has, as `{ column, percent }`, for the cells to show. */
export function rowShares(grid: Grid, picks: Picks, row: Row): Map<number, Percent> {
	const out = new Map<number, Percent>();
	for (const share of picks.get(targetKey(row.target)) ?? []) {
		const column = columnOf(grid, share.bidId);
		if (column >= 0) out.set(column, share.percent);
	}
	return out;
}
