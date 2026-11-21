/**
 * Rows by count: one row of the request standing for many shots or assets of a kind, as early bids
 * go (120 simple comps, 40 medium, 10 hard). Pure, no I/O.
 *
 * - A row in this request only (no Flow PT Shot or Asset) has a count: a whole number from 1 to
 *   `MAX_COUNT`, 1 when absent. A row linked to Flow PT is one Shot or Asset: its count is 1, always.
 * - A vendor prices a counted row per unit. The line's total is the unit price times the count, in
 *   whole minor units, exact (bigint). The line keeps its unit price beside it (`BidLine.unit`).
 *   Every total, the comparison, the award and Flow PT read the line's total, as before.
 * - A row of count 1 is a row as it always was: no unit price kept, the line's total is its price.
 * - Frames are typed per unit. A counted row's frames in all are its frames times its count.
 */

import type { BidLine } from './model';
import { money, type Money } from './money';

/** The most units one row stands for. Far above a real bid; inside a Flow PT `number` (int32). */
export const MAX_COUNT = 100_000;

/** Why a row linked to Flow PT has no count of its own. */
export function countLock(kind: 'shot' | 'asset'): string {
	const type = kind === 'shot' ? 'Shot' : 'Asset';
	return `This row is one ${type} in Flow PT. Its count is 1.`;
}

interface Countable {
	readonly count?: number;
	readonly fpt?: { readonly type: string; readonly id: number };
}

/** The row may stand for many: it is in this request only, with no Flow PT row. */
export function canCount(row: Pick<Countable, 'fpt'>): boolean {
	return row.fpt === undefined;
}

/** Whether a stored count holds: a whole number from 1 to `MAX_COUNT`. */
export function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= MAX_COUNT;
}

/** How many the row stands for: its count, 1 when absent or when it is linked to Flow PT. */
export function countOf(row: Countable): number {
	if (!canCount(row)) return 1;
	return isCount(row.count) ? row.count : 1;
}

/** The row stands for more than one. */
export function isCounted(row: Countable): boolean {
	return countOf(row) > 1;
}

/** A count as typed in a cell: blank is 1. Answers the count, or why it does not read. */
export function parseCount(raw: unknown): { readonly value: number } | { readonly error: string } {
	if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { value: 1 };
	const n = typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw.trim()) : raw;
	if (typeof n !== 'number' || !Number.isFinite(n)) return { error: 'A count is a whole number.' };
	if (!Number.isInteger(n)) return { error: 'A count is a whole number.' };
	if (n < 1) return { error: 'A count is 1 at least.' };
	if (n > MAX_COUNT) return { error: `A count is ${MAX_COUNT.toLocaleString('en-US')} at most.` };
	return { value: n };
}

/** The row with its count set: 1 leaves the field off, so a row of count 1 is the row as before. */
export function withCount<T extends object & Countable>(row: T, count: number): T {
	const { count: _, ...rest } = row;
	if (!isCount(count)) throw new Error(`${count} is not a count from 1 to ${MAX_COUNT}.`);
	return (count === 1 || !canCount(row) ? rest : { ...rest, count }) as T;
}

/** A unit price times a count: whole minor units, exact. Throws past what a total may hold. */
export function extend(unit: Money, count: number): Money {
	if (!isCount(count)) throw new Error(`${count} is not a count from 1 to ${MAX_COUNT}.`);
	const minor = BigInt(unit.minor) * BigInt(count);
	if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('The line total is too large to hold exactly.');
	return money(Number(minor), unit.currency);
}

/** A row's frames in all: its frames per unit times its count. Undefined when it has none. */
export function framesOf(row: Countable & { readonly frames?: number }): number | undefined {
	return row.frames === undefined ? undefined : row.frames * countOf(row);
}

/** `170 shots in 3 rows` where the counts make more than the rows; `3 shots` where they are the same. */
export function unitsLine(units: number, rows: number, noun: 'shot' | 'asset', format: (n: number) => string = (n) => n.toLocaleString('en-US')): string {
	const word = `${format(units)} ${units === 1 ? noun : `${noun}s`}`;
	return units === rows ? word : `${word} in ${format(rows)} ${rows === 1 ? 'row' : 'rows'}`;
}

/**
 * What is wrong with a vendor's lines against the rows' counts: a counted row's line carries its
 * unit price and a total of exactly that times the count; a row of count 1 carries no unit price; a
 * line in a bid's one figure carries none. Empty when every line holds.
 */
export function countProblems(
	rows: readonly { readonly key: string; readonly label: string; readonly count: number }[],
	lines: readonly Pick<BidLine, 'target' | 'total' | 'unit' | 'excluded' | 'inPackage'>[]
): string[] {
	const byKey = new Map(rows.map((r) => [r.key, r]));
	const problems: string[] = [];
	for (const line of lines) {
		const row = byKey.get(`${line.target.kind}:${line.target.id}`);
		if (!row) continue;
		if (line.inPackage || row.count === 1) {
			if (line.unit) problems.push(`${row.label} is not priced per unit. Reload the page.`);
			continue;
		}
		if (!line.unit) {
			// An excluded row with no price typed carries a zero and no unit price.
			if (line.excluded && line.total.minor === 0) continue;
			problems.push(`${row.label} stands for ${row.count}. Its line needs its unit price. Reload the page.`);
			continue;
		}
		if (line.unit.currency !== line.total.currency) {
			problems.push(`${row.label}: the unit price is in ${line.unit.currency}, the line in ${line.total.currency}.`);
			continue;
		}
		if (BigInt(line.unit.minor) * BigInt(row.count) !== BigInt(line.total.minor)) {
			problems.push(`${row.label}: the line total is not its unit price times ${row.count}. Reload the page.`);
		}
	}
	return problems;
}
