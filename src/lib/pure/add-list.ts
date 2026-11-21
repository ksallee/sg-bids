/**
 * The list in the Add from Flow PT dialog: one Flow PT row as a line (thumbnail, code, status,
 * a quiet Sequence or type), which rows the request already holds, and the ticks. Pure, no I/O.
 *
 * Scalars are read from `attributes`, links from `relationships` (003_query), a link's label from
 * its `name` (060). `image` is a presigned URL re-signed on every read (081, field_types/image):
 * the line holds it only while the dialog shows it, and the request never keeps it.
 */

import type { EntityRow } from 'sg-widgets-core';
import type { ItemKind, Mapping } from './field-map';
import type { SequenceIndex } from './freeze';

export interface ListRow {
	readonly id: number;
	readonly code: string;
	readonly image: string | null;
	readonly status: string | null;
	/** The Sequence of a Shot, the type of an Asset. */
	readonly aside: string | null;
}

function text(row: EntityRow, field: string | null | undefined): string | null {
	if (!field) return null;
	const value = row.attributes?.[field];
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function linked(row: EntityRow, field: string | null | undefined): { id: number; name?: string | null } | null {
	if (!field) return null;
	const data = row.relationships?.[field]?.data;
	return data && !Array.isArray(data) ? (data as { id: number; name?: string | null }) : null;
}

export function listRow(row: EntityRow, kind: ItemKind, mapping: Mapping, sequences: SequenceIndex): ListRow {
	const image = row.attributes?.image;
	let aside: string | null;
	if (kind === 'shot') {
		const sequence = linked(row, mapping.sequence);
		aside = sequence ? (sequences.get(sequence.id)?.code ?? sequence.name ?? null) || null : null;
	} else aside = text(row, mapping.type);
	return {
		id: row.id,
		code: text(row, 'code') ?? `${kind === 'shot' ? 'Shot' : 'Asset'} ${row.id}`,
		image: typeof image === 'string' ? image : null,
		status: text(row, 'sg_status_list'),
		aside
	};
}

/** The Flow PT ids the request holds, a breakdown row linked to one included. */
export function inRequest(items: readonly { readonly fpt?: { readonly id: number } }[]): Set<number> {
	return new Set(items.flatMap((item) => (item.fpt ? [item.fpt.id] : [])));
}

export interface Ticks {
	readonly selected: ReadonlySet<number>;
	/** The row the last press landed on, where a Shift range starts. */
	readonly anchor: number | null;
}

/**
 * A press on a row's box. Alone it ticks or unticks the row. With Shift it gives every row from the
 * anchor to it, in the order shown, the state the pressed row takes. A row already in the request
 * never changes.
 */
export function toggle(ticks: Ticks, id: number, options: { order: readonly number[]; blocked: ReadonlySet<number>; shift: boolean }): Ticks {
	if (options.blocked.has(id)) return ticks;
	const on = !ticks.selected.has(id);
	const next = new Set(ticks.selected);
	const from = ticks.anchor === null ? -1 : options.order.indexOf(ticks.anchor);
	const to = options.order.indexOf(id);
	const range = options.shift && from >= 0 && to >= 0 ? options.order.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
	for (const each of range) {
		if (options.blocked.has(each)) continue;
		if (on) next.add(each);
		else next.delete(each);
	}
	return { selected: next, anchor: id };
}

/** Whether the rows shown that can be added are all ticked, some, or none. */
export function shownState(selected: ReadonlySet<number>, shown: readonly number[], blocked: ReadonlySet<number>): 'none' | 'some' | 'all' {
	const open = shown.filter((id) => !blocked.has(id));
	const ticked = open.filter((id) => selected.has(id)).length;
	if (ticked === 0) return 'none';
	return ticked === open.length ? 'all' : 'some';
}

/** Select all shown: ticks every row shown, or unticks them when all are ticked. Picks not shown stay. */
export function toggleShown(selected: ReadonlySet<number>, shown: readonly number[], blocked: ReadonlySet<number>): Set<number> {
	const next = new Set(selected);
	const clear = shownState(selected, shown, blocked) === 'all';
	for (const id of shown) {
		if (blocked.has(id)) continue;
		if (clear) next.delete(id);
		else next.add(id);
	}
	return next;
}

/** The dialog's one button. */
export function addLabel(kind: ItemKind, count: number): string {
	const noun = kind === 'shot' ? 'shot' : 'asset';
	if (count === 0) return `Add ${noun}s`;
	return `Add ${count} ${count === 1 ? noun : `${noun}s`}`;
}
