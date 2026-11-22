/**
 * What the comparison grid shows of a `Grid` (`compare.ts`): rows grouped by sequence or episode
 * with subtotals per column, then filtered and sorted inside each group, then laid out as one flat
 * list of group headers and rows for a virtualised view.
 *
 * A group's subtotals count every row of the group, whatever the filter hides: a sequence's
 * subtotal is the sequence's. A subtotal's base figure is null while a priced cell in it has no
 * rate. Assets come last, in their own group.
 *
 * Grouped by package, each group is a package in the request's order, shots and assets together,
 * and carries the package compared as a unit (`compare.ts`, `PackageView`): a figure for a vendor
 * that priced it as one, else the sum of its row prices, the lowest marked.
 */

import type { Cell, Grid, PackageView, Row } from './compare';
import { targetKey } from './model';
import { add, money, type Money } from './money';
import { isPercent } from './percent';

export type GroupBy = 'package' | 'sequence' | 'episode' | 'none';

export interface Subtotal {
	/** Priced cells, in the column's bid currency. */
	readonly bid: Money;
	/** Priced cells in the base currency. Null while one of them needs a rate. */
	readonly base: Money | null;
	readonly priced: number;
	readonly excluded: number;
	readonly missing: number;
	/** Cells in a package price. */
	readonly inPackage: number;
	/** Cells of a package the vendor is not bidding on. */
	readonly declined: number;
}

export interface Group {
	/** Stable across filters: `seq:SEQ010`, `assets`, `pkg:<id>`. */
	readonly key: string;
	readonly label: string;
	readonly kind: 'package' | 'sequence' | 'episode' | 'shots' | 'assets' | 'unset';
	readonly rows: readonly Row[];
	/** One per column. */
	readonly subtotals: readonly Subtotal[];
	/** Grouped by package: the package as a unit. */
	readonly unit?: PackageView;
}

const UNSET: Record<Exclude<GroupBy, 'package'>, string> = { sequence: 'No sequence', episode: 'No episode', none: 'Shots' };

function subtotals(grid: Grid, rows: readonly Row[]): Subtotal[] {
	return grid.columns.map((column, index) => {
		let bid = money(0, column.currency);
		let base: Money | null = money(0, grid.baseCurrency);
		let priced = 0;
		let excluded = 0;
		let missing = 0;
		let inPackage = 0;
		let declined = 0;
		for (const row of rows) {
			const cell = row.cells[index];
			if (cell.kind === 'excluded') excluded++;
			else if (cell.kind === 'missing') missing++;
			else if (cell.kind === 'package') inPackage++;
			else if (cell.kind === 'declined') declined++;
			else {
				priced++;
				bid = add(bid, cell.amount.bid);
				base = base && cell.amount.base ? add(base, cell.amount.base) : null;
			}
		}
		return { bid, base, priced, excluded, missing, inPackage, declined };
	});
}

/** The grid's rows by package, in the request's order. A package with no row is left out. */
function byPackage(grid: Grid): Group[] {
	return grid.packages.flatMap((unit) => {
		const rows = grid.rows.filter((r) => r.package === unit.id);
		return rows.length === 0 ? [] : [{ key: `pkg:${unit.id}`, label: unit.name, kind: 'package' as const, rows, subtotals: subtotals(grid, rows), unit }];
	});
}

/** The grid's rows in groups, in the order each group first appears, unset shots then assets last. */
export function groupRows(grid: Grid, by: GroupBy): Group[] {
	if (by === 'package') return byPackage(grid);
	const shots = new Map<string, { label: string; kind: Group['kind']; rows: Row[] }>();
	const unset: Row[] = [];
	const assets: Row[] = [];
	for (const row of grid.rows) {
		if (row.target.kind === 'asset') {
			assets.push(row);
			continue;
		}
		const value = by === 'sequence' ? row.sequence : by === 'episode' ? row.episode : 'all';
		if (!value) {
			unset.push(row);
			continue;
		}
		const key = by === 'none' ? 'shots' : `${by === 'sequence' ? 'seq' : 'ep'}:${value}`;
		if (!shots.has(key)) shots.set(key, { label: by === 'none' ? 'Shots' : value, kind: by === 'none' ? 'shots' : by, rows: [] });
		shots.get(key)!.rows.push(row);
	}
	const groups: Group[] = [...shots.entries()].map(([key, g]) => ({ key, label: g.label, kind: g.kind, rows: g.rows, subtotals: subtotals(grid, g.rows) }));
	if (unset.length) groups.push({ key: `unset:${by}`, label: UNSET[by], kind: 'unset', rows: unset, subtotals: subtotals(grid, unset) });
	if (assets.length) groups.push({ key: 'assets', label: 'Assets', kind: 'assets', rows: assets, subtotals: subtotals(grid, assets) });
	return groups;
}

// Filters.

export type Only = 'all' | 'missing' | 'excluded' | 'unconverted';

export interface RowFilter {
	/** Words that must all appear in the code or the description, any case. */
	readonly text?: string;
	/** Only rows whose known prices differ by more than this percent, as typed. */
	readonly differsOver?: string;
	readonly only?: Only;
	/** Only rows where this column holds the lowest price. */
	readonly lowestColumn?: number | null;
	readonly hideOmitted?: boolean;
	/** Only these rows, by target key: the rows a scenario leaves unawarded. */
	readonly keys?: ReadonlySet<string> | null;
}

/** A typed percent as basis points, rounded half away from zero; null when it is not a percent. */
export function percentToBp(text: string): number | null {
	const trimmed = text.trim();
	if (!isPercent(trimmed)) return null;
	const [whole, fraction = ''] = trimmed.split('.');
	const digits = (fraction + '000').slice(0, 3);
	const value = Number(whole) * 100 + Number(digits.slice(0, 2));
	return Number(digits[2]) >= 5 ? value + 1 : value;
}

const has = (row: Row, kind: Cell['kind']) => row.cells.some((c) => c.kind === kind);

export function matchesFilter(row: Row, filter: RowFilter): boolean {
	if (filter.hideOmitted && row.omitted) return false;
	if (filter.keys && !filter.keys.has(targetKey(row.target))) return false;
	if (filter.text) {
		const hay = `${row.label} ${row.description ?? ''}`.toLowerCase();
		if (!filter.text.toLowerCase().split(/\s+/).filter(Boolean).every((word) => hay.includes(word))) return false;
	}
	if (filter.differsOver !== undefined && filter.differsOver.trim() !== '') {
		const bp = percentToBp(filter.differsOver);
		if (bp !== null && (row.rangeBp === null || row.rangeBp <= bp)) return false;
	}
	if (filter.only === 'missing' && !has(row, 'missing')) return false;
	if (filter.only === 'excluded' && !has(row, 'excluded')) return false;
	if (filter.only === 'unconverted' && row.unconverted === 0) return false;
	if (filter.lowestColumn !== undefined && filter.lowestColumn !== null && !row.lowestColumns.includes(filter.lowestColumn)) return false;
	return true;
}

// Sorting.

export type SortKey = 'order' | 'code' | 'spread' | 'lowest' | 'lowestVendor';
export type SortDir = 'asc' | 'desc';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Unknowns sort last whichever way. */
function nullable(a: number | null, b: number | null, dir: number): number {
	if (a === null && b === null) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	if (a === b) return 0;
	return (a < b ? -1 : 1) * dir;
}

/** A stable sort; ties keep the request order. */
export function sortRows(rows: readonly Row[], key: SortKey, dir: SortDir = 'asc'): Row[] {
	const d = dir === 'asc' ? 1 : -1;
	const compare = (a: Row, b: Row): number => {
		switch (key) {
			case 'code':
				return collator.compare(a.label, b.label) * d;
			case 'spread':
				return nullable(a.rangeBp, b.rangeBp, d);
			case 'lowest':
				return nullable(a.lowest, b.lowest, d);
			case 'lowestVendor':
				return nullable(a.lowestColumns[0] ?? null, b.lowestColumns[0] ?? null, d) || nullable(a.rangeBp, b.rangeBp, -1);
			default:
				return (a.index - b.index) * d;
		}
	};
	return [...rows].sort((a, b) => compare(a, b) || a.index - b.index);
}

// Layout.

export type DisplayRow =
	| { readonly kind: 'group'; readonly key: string; readonly group: Group; readonly shown: number; readonly collapsed: boolean }
	| { readonly kind: 'row'; readonly key: string; readonly row: Row; readonly group: string };

export interface ViewOptions {
	readonly by: GroupBy;
	readonly filter: RowFilter;
	readonly sort: SortKey;
	readonly dir: SortDir;
	readonly collapsed: ReadonlySet<string>;
}

export interface GridView {
	readonly groups: readonly Group[];
	readonly display: readonly DisplayRow[];
	/** Rows the filter lets through, collapsed or not. */
	readonly shown: number;
	readonly total: number;
}

/** Group, filter and sort the grid, and flatten it: a header per group with a row shown, then its rows unless collapsed. */
export function viewGrid(grid: Grid, options: ViewOptions): GridView {
	const groups = groupRows(grid, options.by);
	const display: DisplayRow[] = [];
	let shown = 0;
	for (const group of groups) {
		const rows = sortRows(
			group.rows.filter((row) => matchesFilter(row, options.filter)),
			options.sort,
			options.dir
		);
		if (rows.length === 0) continue;
		shown += rows.length;
		const collapsed = options.collapsed.has(group.key);
		display.push({ kind: 'group', key: `g:${group.key}`, group, shown: rows.length, collapsed });
		if (!collapsed) for (const row of rows) display.push({ kind: 'row', key: targetKey(row.target), row, group: group.key });
	}
	return { groups, display, shown, total: grid.rows.length };
}

// Windowing: rows of fixed heights, so the window is arithmetic.

/** Where each display row starts, plus the total height last: `n + 1` numbers. */
export function offsetsOf(display: readonly DisplayRow[], heights: { readonly group: number; readonly row: number }): number[] {
	const offsets = [0];
	for (const item of display) offsets.push(offsets[offsets.length - 1] + (item.kind === 'group' ? heights.group : heights.row));
	return offsets;
}

/** The display rows from `from` to `to` inclusive that meet the viewport, with `overscan` more each side. */
export function visibleRange(offsets: readonly number[], top: number, height: number, overscan = 6): { from: number; to: number } {
	const count = offsets.length - 1;
	if (count <= 0) return { from: 0, to: -1 };
	// The last row starting at or above `top`.
	let lo = 0;
	let hi = count - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (offsets[mid] <= top) lo = mid;
		else hi = mid - 1;
	}
	let end = lo;
	while (end < count - 1 && offsets[end + 1] < top + height) end++;
	return { from: Math.max(0, lo - overscan), to: Math.min(count - 1, end + overscan) };
}

/** The scroll position that shows row `index` whole below a sticky header, or null when it already shows. */
export function scrollToShow(offsets: readonly number[], index: number, top: number, height: number, header = 0): number | null {
	const start = offsets[index];
	const end = offsets[index + 1];
	if (start === undefined || end === undefined) return null;
	if (start < top) return start;
	if (end > top + height - header) return end - (height - header);
	return null;
}
