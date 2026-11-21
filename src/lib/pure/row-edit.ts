/**
 * Editing a draft's rows: where each change lands, the value each field takes, what the read back
 * says landed, and the undo. Pure, no I/O: the writes are in `src/lib/io/fpt-write.ts`. Facts from
 * `../sg-groundtruth/corpus`:
 *
 * - A text write is trimmed and a blank is stored as null (field_types/text).
 * - A number is a signed 32 bit whole number; a decimal is refused (field_types/number).
 * - A list takes only a value in `valid_values`, byte for byte (field_types/list).
 * - A 200 proves nothing: a write is confirmed by reading the row back (028, 024).
 * - There is no conditional write, so the undo reads the field first and leaves a value someone
 *   changed since the edit (024).
 */

import type { EntityRow } from 'sg-widgets-core';
import { cellTarget, type ColumnKey, type RequestColumn } from './live-columns';
import type { Id } from './model';

/** One cell's new value, as the table hands it. */
export interface CellChange {
	readonly itemId: Id;
	readonly key: ColumnKey;
	readonly value: unknown;
}

export type CellValue = string | number | boolean | null;

/** A write to one field of one Flow PT row. */
export interface FptWrite {
	readonly itemId: Id;
	readonly key: ColumnKey;
	readonly type: string;
	readonly id: number;
	readonly field: string;
	readonly value: string | number | null;
	/** What the row showed before, to put back on undo. */
	readonly before: CellValue;
}

/** A change to the request alone. */
export interface LocalWrite {
	readonly itemId: Id;
	readonly key: ColumnKey;
	readonly value: CellValue;
	readonly before: CellValue;
}

export interface Refusal {
	readonly itemId: Id;
	readonly key: ColumnKey;
	readonly reason: string;
	/** True when trying the same write again may land. */
	readonly retry?: boolean;
}

export interface EditPlan {
	readonly fpt: readonly FptWrite[];
	readonly local: readonly LocalWrite[];
	readonly refused: readonly Refusal[];
}

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

/** The value a cell takes, or why it cannot. */
export function parseCell(column: Pick<RequestColumn, 'dataType' | 'validValues'>, raw: unknown): { value: CellValue } | { error: string } {
	switch (column.dataType) {
		case 'checkbox':
			return { value: raw === true };
		case 'number': {
			if (raw === null || raw === undefined || raw === '') return { value: null };
			const n = typeof raw === 'string' && /^\s*-?\d+\s*$/.test(raw) ? Number(raw) : raw;
			if (typeof n !== 'number' || !Number.isFinite(n)) return { error: 'Not a number.' };
			if (!Number.isInteger(n)) return { error: 'Whole numbers only.' };
			if (n < INT32_MIN || n > INT32_MAX) return { error: 'Too large for Flow PT.' };
			return { value: n };
		}
		case 'list': {
			if (raw === null || raw === undefined || raw === '') return { value: null };
			const values = column.validValues ?? [];
			if (typeof raw === 'string' && values.includes(raw)) return { value: raw };
			return { error: `Pick one of ${values.join(', ')}.` };
		}
		default: {
			if (raw === null || raw === undefined) return { value: null };
			if (typeof raw !== 'string') return { error: 'Not text.' };
			const text = raw.trim();
			return { value: text === '' ? null : text };
		}
	}
}

interface Item {
	readonly id: Id;
	readonly code?: string;
	readonly name?: string;
	readonly fpt?: { readonly type: string; readonly id: number };
	readonly source?: 'breakdown';
	readonly description?: string;
	readonly type?: string;
	readonly difficulty?: string;
	readonly notes?: string;
	readonly frames?: number;
	readonly episode?: string;
	readonly sequence?: string;
	readonly omitted?: boolean;
	readonly package?: Id;
}

/** What the request shows in a cell, a blank as null. `packages`: package names by id, for the Package column. */
export function itemValue(item: Item, key: ColumnKey, packages: ReadonlyMap<Id, string> = new Map()): CellValue {
	switch (key) {
		case 'code':
			return item.code ?? item.name ?? null;
		case 'package':
			return item.package === undefined ? null : (packages.get(item.package) ?? null);
		case 'sequence':
			return [item.episode, item.sequence].filter(Boolean).join(' / ') || null;
		case 'frames':
			return item.frames ?? null;
		case 'omitted':
			return item.omitted ?? false;
		default:
			return item[key] ?? null;
	}
}

/** Where each change lands. A change to the value a cell already holds writes nothing. */
export function planEdits(changes: readonly CellChange[], items: readonly Item[], columns: readonly RequestColumn[], gone: ReadonlySet<Id>): EditPlan {
	const byId = new Map(items.map((item) => [item.id, item]));
	const fpt: FptWrite[] = [];
	const local: LocalWrite[] = [];
	const refused: Refusal[] = [];
	for (const change of changes) {
		const item = byId.get(change.itemId);
		const column = columns.find((c) => c.key === change.key);
		if (!item || !column) {
			refused.push({ itemId: change.itemId, key: change.key, reason: 'This row is no longer in the request.' });
			continue;
		}
		const target = cellTarget(column, item, gone.has(item.id));
		if (target.kind === 'locked') {
			refused.push({ itemId: item.id, key: change.key, reason: target.reason });
			continue;
		}
		const parsed = parseCell(column, change.value);
		if ('error' in parsed) {
			refused.push({ itemId: item.id, key: change.key, reason: parsed.error });
			continue;
		}
		const before = itemValue(item, change.key);
		if (parsed.value === before) continue;
		if (target.kind === 'fpt') {
			fpt.push({ itemId: item.id, key: change.key, type: target.type, id: target.id, field: target.field, value: parsed.value as string | number | null, before });
		} else {
			local.push({ itemId: item.id, key: change.key, value: parsed.value, before });
		}
	}
	return { fpt, local, refused };
}

/** The items with the request's own changes made. A cleared text or number leaves the item. */
export function applyLocal<T extends Item>(items: readonly T[], writes: readonly LocalWrite[]): T[] {
	if (writes.length === 0) return [...items];
	const byItem = new Map<Id, LocalWrite[]>();
	for (const w of writes) byItem.set(w.itemId, [...(byItem.get(w.itemId) ?? []), w]);
	return items.map((item) => {
		const mine = byItem.get(item.id);
		if (!mine) return item;
		const next = { ...item } as Record<string, unknown>;
		for (const w of mine) {
			// The code and the Sequence are Flow PT's; a package moves by `packages.moveRows`.
			if (w.key === 'code' || w.key === 'sequence' || w.key === 'package') continue;
			if (w.value === null) delete next[w.key];
			else next[w.key] = w.value;
		}
		return next as T;
	});
}

/** A field's value as read back: a text trimmed, a blank as null. */
function readValue(row: EntityRow, field: string): string | number | null {
	const value = row.attributes?.[field];
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
	return null;
}

/** What one write did, by the row read back after it. */
export type WriteOutcome =
	| { readonly state: 'landed'; readonly now: string | number | null }
	| { readonly state: 'silent'; readonly now: string | number | null; readonly reason: string }
	| { readonly state: 'refused'; readonly reason: string }
	| { readonly state: 'gone'; readonly reason: string };

function goneReason(type: string): string {
	return `This ${type === 'Asset' ? 'Asset' : 'Shot'} is gone from Flow PT, or you cannot read it.`;
}

/**
 * Each write's outcome. `refused`: the writes the site refused, by index, with its words. `rows`:
 * the rows read back after the writes. A 200 that left another value is silent (028).
 */
export function readBack(writes: readonly FptWrite[], refused: ReadonlyMap<number, string>, rows: readonly EntityRow[]): WriteOutcome[] {
	const byRef = new Map(rows.map((row) => [`${row.type}:${row.id}`, row]));
	return writes.map((write, index): WriteOutcome => {
		const reason = refused.get(index);
		if (reason !== undefined) return { state: 'refused', reason };
		const row = byRef.get(`${write.type}:${write.id}`);
		if (!row) return { state: 'gone', reason: goneReason(write.type) };
		const now = readValue(row, write.field);
		if (now === write.value) return { state: 'landed', now };
		return { state: 'silent', now, reason: `Flow PT answered, then still held ${now === null ? 'nothing' : now}.` };
	});
}

/** One change that landed: in Flow PT when it has a target, else in the request. */
export interface Change {
	readonly itemId: Id;
	readonly key: ColumnKey;
	readonly target: { readonly type: string; readonly id: number; readonly field: string } | null;
	readonly before: CellValue;
	/** The value read back, or the request's new value. */
	readonly after: CellValue;
}

/** The changes an edit made: the writes that landed, then the request's own. */
export function changesOf(writes: readonly FptWrite[], outcomes: readonly WriteOutcome[], local: readonly LocalWrite[]): Change[] {
	const landed = writes.flatMap((write, i): Change[] => {
		const outcome = outcomes[i];
		return outcome?.state === 'landed'
			? [{ itemId: write.itemId, key: write.key, target: { type: write.type, id: write.id, field: write.field }, before: write.before, after: outcome.now }]
			: [];
	});
	return [...landed, ...local.map((w): Change => ({ itemId: w.itemId, key: w.key, target: null, before: w.before, after: w.value }))];
}

export interface UndoPlan {
	readonly fpt: readonly FptWrite[];
	readonly local: readonly LocalWrite[];
	/** Changed in Flow PT since the edit: left as Flow PT holds it. */
	readonly conflicts: readonly { readonly change: Change; readonly now: string | number | null }[];
	/** Flow PT no longer answers for the row. */
	readonly gone: readonly Change[];
}

/**
 * The writes that put an edit back. `rows`: the edited rows as Flow PT holds them now. A field that
 * no longer holds the edited value was changed by someone since, and is left (024: no conditional
 * write).
 */
export function undoPlan(changes: readonly Change[], rows: readonly EntityRow[]): UndoPlan {
	const byRef = new Map(rows.map((row) => [`${row.type}:${row.id}`, row]));
	const fpt: FptWrite[] = [];
	const local: LocalWrite[] = [];
	const conflicts: { change: Change; now: string | number | null }[] = [];
	const gone: Change[] = [];
	for (const change of changes) {
		if (!change.target) {
			local.push({ itemId: change.itemId, key: change.key, value: change.before, before: change.after });
			continue;
		}
		const row = byRef.get(`${change.target.type}:${change.target.id}`);
		if (!row) {
			gone.push(change);
			continue;
		}
		const now = readValue(row, change.target.field);
		if (now !== change.after) {
			conflicts.push({ change, now });
			continue;
		}
		fpt.push({ itemId: change.itemId, key: change.key, ...change.target, value: change.before as string | number | null, before: change.after });
	}
	return { fpt, local, conflicts, gone };
}
