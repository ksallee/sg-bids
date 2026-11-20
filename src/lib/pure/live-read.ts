/**
 * A draft's rows as Flow PT holds them now. A draft reads its rows' live values when it opens and
 * after every write, so the request never keeps a stale copy; the issue freezes what is on screen.
 * Pure, no I/O.
 *
 * A row picked from Flow PT takes each value a mapped field feeds from the row read, and keeps the
 * request's own: the note to vendors, omit, and any concept no field feeds. A breakdown row keeps
 * what it was typed with. A row Flow PT did not answer for, deleted or out of the person's reach,
 * stays as it was and is flagged.
 */

import type { EntityRow, FieldSchema } from 'sg-widgets-core';
import { slotsFor, EPISODE_FROM_SEQUENCE, type ItemKind, type Mapping } from './field-map';
import type { Id } from './model';

/** The slots whose value is a field of the row, by the item key each fills. */
const SLOT_KEYS: Readonly<Record<string, readonly string[]>> = {
	description: ['description'],
	frames: ['frames'],
	sequence: ['sequence'],
	episode: ['episode'],
	type: ['type'],
	difficulty: ['difficulty'],
	assets: ['assetIds']
};

/** The item keys a field feeds under this mapping: the code, and each slot mapped to a field the schema holds. */
export function liveKeys(kind: ItemKind, mapping: Mapping, schema: Record<string, FieldSchema>): ReadonlySet<string> {
	const keys = new Set<string>(['code']);
	for (const spec of slotsFor(kind)) {
		const field = mapping[spec.slot];
		const fed = spec.slot === 'episode' && field === EPISODE_FROM_SEQUENCE ? typeof mapping.sequence === 'string' && mapping.sequence in schema : typeof field === 'string' && field in schema;
		if (fed) for (const key of SLOT_KEYS[spec.slot] ?? []) keys.add(key);
	}
	return keys;
}

interface Item {
	readonly id: Id;
	readonly fpt?: { readonly type: string; readonly id: number };
	readonly source?: 'breakdown';
}

export interface LiveRead<T> {
	readonly items: T[];
	/** Rows picked from Flow PT that it did not answer for. */
	readonly gone: Id[];
	/** True when a value differs from the items given. */
	readonly changed: boolean;
}

/**
 * The items with their live values. `rows`: the Flow PT rows read for them. `freeze`: the row as a
 * request item (`freeze.ts`), its position from 1 for a row with no code.
 */
export function liveItems<T extends Item>(items: readonly T[], rows: readonly EntityRow[], keys: ReadonlySet<string>, freeze: (row: EntityRow, position: number) => T): LiveRead<T> {
	const byId = new Map(rows.map((row) => [row.id, row]));
	const gone: Id[] = [];
	let changed = false;
	const next = items.map((item, index) => {
		if (item.source === 'breakdown' || !item.fpt) return item;
		const row = byId.get(item.fpt.id);
		if (!row) {
			gone.push(item.id);
			return item;
		}
		const fresh = freeze(row, index + 1) as unknown as Record<string, unknown>;
		const merged: Record<string, unknown> = { ...item };
		for (const key of keys) {
			if (fresh[key] === undefined) delete merged[key];
			else merged[key] = fresh[key];
		}
		if (JSON.stringify(merged) === JSON.stringify(item)) return item;
		changed = true;
		return merged as unknown as T;
	});
	return { items: next, gone, changed };
}
