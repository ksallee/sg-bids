/**
 * The columns of a bid's Shots and Assets table, and where each cell's edit lands. Pure, no I/O.
 *
 * A column fed by a Flow PT field is live: on a row picked from Flow PT, its cell shows the field as
 * Flow PT holds it and an edit writes the field, as the signed in person. Every other column, and
 * every cell of a breakdown row, is in the request only. A breakdown row linked to a Shot keeps the
 * values it came with: the link is for the award.
 *
 * The person may not edit a field when the schema says `editable` false for them, or when the
 * preflight write was refused (094, recipe 017). The code and the Sequence are read live and never
 * written here: the code names the Shot in the pipeline, and a Sequence is a link. A row in this
 * request only (a breakdown row with no Flow PT row, typed by hand or pasted) takes a code typed
 * here, and a count (`count.ts`); a row linked to Flow PT keeps its code and a count of 1.
 *
 * A row belongs to a bid because it was added to it: there is no column for its group.
 *
 * Omit marks a row the earlier round held as cut, so vendors and the comparison see it was dropped.
 * A round 1 draft has no earlier round: removing the row does it, so it has no Omit column, unless a
 * row there is omitted already (a draft from before), which keeps the column so it can be brought back.
 */

import type { FieldSchema } from 'sg-widgets-core';
import { countLock } from './count';
import { slotsFor, type ItemKind, type Mapping } from './field-map';
import { DEFAULT_TIERS } from './request';

export type ColumnKey = 'code' | 'count' | 'sequence' | 'frames' | 'description' | 'type' | 'difficulty' | 'notes' | 'omitted';

export type CellType = 'text' | 'number' | 'list' | 'checkbox';

export interface RequestColumn {
	readonly kind: ItemKind;
	readonly key: ColumnKey;
	readonly label: string;
	/** The Flow PT field the column reads and writes on a row picked from Flow PT. Null: in this request only. */
	readonly field: string | null;
	readonly live: boolean;
	/** Why the live cells of this column cannot be edited here. Null when they can. */
	readonly lock: string | null;
	readonly dataType: CellType;
	/** For a list: the values offered. */
	readonly validValues?: readonly string[];
	readonly width: number;
}

/** The display name offered for a description of the bid's own: `field-map`'s create spec. */
export const BID_DESCRIPTION = slotsFor('shot').find((s) => s.slot === 'description')?.create?.display ?? 'Bid Description';

interface ColumnSpec {
	readonly key: ColumnKey;
	readonly label: string;
	readonly width: number;
	/** The request's own type when no field feeds it. */
	readonly fallback: CellType;
	/** The field, from the mapping or fixed. */
	readonly field: (mapping: Mapping) => string | null | undefined;
	/** A live column edited nowhere here. */
	readonly fixedLock?: string;
}

// The code gets room for a long code and its marks: the last column takes what is left.
const SHOT_SPECS: readonly ColumnSpec[] = [
	{ key: 'code', label: 'Shot', width: 300, fallback: 'text', field: () => 'code', fixedLock: 'The code names the Shot in the pipeline. Rename it in Flow PT.' },
	// Beside the code, narrow: a cut row is read with its code, and a wide table scrolls (round 2 on).
	{ key: 'omitted', label: 'Omit', width: 80, fallback: 'checkbox', field: () => null },
	// In this request only: how many shots of a kind the row stands for. Frames are per unit.
	{ key: 'count', label: 'Count', width: 130, fallback: 'number', field: () => null },
	{ key: 'sequence', label: 'Sequence', width: 150, fallback: 'text', field: (m) => m.sequence, fixedLock: 'Move a Shot to another Sequence in Flow PT.' },
	{ key: 'frames', label: 'Frames', width: 120, fallback: 'number', field: (m) => m.frames },
	{ key: 'description', label: 'Description', width: 320, fallback: 'text', field: (m) => m.description },
	{ key: 'type', label: 'Type', width: 140, fallback: 'text', field: (m) => m.type },
	{ key: 'difficulty', label: 'Difficulty', width: 150, fallback: 'list', field: (m) => m.difficulty },
	// Last, so it takes the width the table has left.
	{ key: 'notes', label: 'Note to vendors', width: 260, fallback: 'text', field: () => null }
];

const ASSET_SPECS: readonly ColumnSpec[] = [
	{ key: 'code', label: 'Asset', width: 300, fallback: 'text', field: () => 'code', fixedLock: 'The code names the Asset in the pipeline. Rename it in Flow PT.' },
	// Beside the code, narrow: a cut row is read with its code, and a wide table scrolls (round 2 on).
	{ key: 'omitted', label: 'Omit', width: 80, fallback: 'checkbox', field: () => null },
	{ key: 'count', label: 'Count', width: 130, fallback: 'number', field: () => null },
	{ key: 'type', label: 'Type', width: 150, fallback: 'text', field: (m) => m.type },
	{ key: 'description', label: 'Description', width: 380, fallback: 'text', field: (m) => m.description },
	{ key: 'difficulty', label: 'Difficulty', width: 150, fallback: 'list', field: (m) => m.difficulty },
	{ key: 'notes', label: 'Note to vendors', width: 260, fallback: 'text', field: () => null }
];

function plural(kind: ItemKind): string {
	return kind === 'shot' ? 'Shots' : 'Assets';
}

function noun(kind: ItemKind): string {
	return kind === 'shot' ? 'Shot' : 'Asset';
}

/** The cell type a field is edited as. A link and a decimal are read here and edited in Flow PT. */
function cellTypeOf(field: FieldSchema): CellType | null {
	if (field.dataType === 'text') return 'text';
	if (field.dataType === 'number') return 'number';
	if (field.dataType === 'list') return 'list';
	return null;
}

/**
 * The table's columns for a kind. `denied`: the fields the preflight write was refused on, with
 * what the site said (094).
 */
export function requestColumns(
	kind: ItemKind,
	mapping: Mapping,
	schema: Record<string, FieldSchema>,
	denied: Readonly<Record<string, string>> = {},
	options: { readonly omit: boolean } = { omit: true }
): RequestColumn[] {
	const specs = (kind === 'shot' ? SHOT_SPECS : ASSET_SPECS).filter((spec) => options.omit || spec.key !== 'omitted');
	return specs.map((spec): RequestColumn => {
		const name = spec.field(mapping);
		const field = typeof name === 'string' ? schema[name] : undefined;
		if (!field) {
			const list = spec.fallback === 'list';
			return { kind, key: spec.key, label: spec.label, field: null, live: false, lock: null, dataType: spec.fallback, ...(list ? { validValues: DEFAULT_TIERS } : {}), width: spec.width };
		}
		const display = field.displayName || field.name;
		const type = cellTypeOf(field);
		let lock: string | null = spec.fixedLock ?? null;
		if (lock === null && type === null) lock = `${display} is edited in Flow PT.`;
		if (lock === null && !field.editable) lock = `You cannot edit ${display} on ${plural(kind)} in Flow PT.`;
		if (lock === null && denied[field.name]) lock = `Flow PT refused a change to ${display}: ${denied[field.name]}`;
		const dataType = type ?? 'text';
		return {
			kind,
			key: spec.key,
			label: spec.label,
			field: field.name,
			live: true,
			lock,
			dataType,
			...(dataType === 'list' ? { validValues: field.validValues ?? [] } : {}),
			width: spec.width
		};
	});
}

/** Whether a draft of this round offers Omit. `anyOmitted`: a row of it is omitted already. */
export function offersOmit(round: number, anyOmitted: boolean): boolean {
	return round >= 2 || anyOmitted;
}

/** What the bar over a selection offers: Omit from round 2, Include while a selected row is omitted. */
export function omitActions(round: number, selectedOmitted: readonly boolean[]): { readonly omit: boolean; readonly include: boolean } {
	const later = round >= 2;
	return { omit: later, include: later || selectedOmitted.some(Boolean) };
}

export function columnByKey(columns: readonly RequestColumn[], key: ColumnKey): RequestColumn {
	const column = columns.find((c) => c.key === key);
	if (!column) throw new Error(`No ${key} column.`);
	return column;
}

interface Item {
	readonly fpt?: { readonly type: string; readonly id: number };
	readonly source?: 'breakdown';
}

/** A code or Sequence a row keeps: a linked breakdown row keeps what it was matched with. */
function keeps(key: 'code' | 'sequence', linked: boolean): string {
	if (key === 'code') return linked ? 'A breakdown row linked to Flow PT keeps the code it was matched with.' : 'A breakdown row keeps the code it came with.';
	return 'A breakdown row keeps the Sequence it came with.';
}

/** Where one cell's edit lands: the Flow PT field of the row, the request, or nowhere and why. */
export type CellTarget =
	| { readonly kind: 'fpt'; readonly type: string; readonly id: number; readonly field: string }
	| { readonly kind: 'request' }
	| { readonly kind: 'locked'; readonly reason: string };

/** `gone`: Flow PT did not answer for the row when the draft was read. */
export function cellTarget(column: RequestColumn, item: Item, gone: boolean): CellTarget {
	const breakdown = item.source === 'breakdown' || !item.fpt;
	// A row in this request only takes a count and a code typed here; a row linked to Flow PT is one Shot or Asset.
	if (column.key === 'count') return item.fpt ? { kind: 'locked', reason: countLock(column.kind) } : { kind: 'request' };
	if (column.key === 'code' && breakdown && !item.fpt) return { kind: 'request' };
	if (column.key === 'code' || column.key === 'sequence') {
		if (breakdown) return { kind: 'locked', reason: keeps(column.key, item.fpt !== undefined) };
	}
	if (!column.live || !column.field || breakdown) return { kind: 'request' };
	if (gone) return { kind: 'locked', reason: `This ${noun(column.kind)} is gone from Flow PT, or you cannot read it.` };
	if (column.lock) return { kind: 'locked', reason: column.lock };
	return { kind: 'fpt', type: item.fpt!.type, id: item.fpt!.id, field: column.field };
}

/**
 * When Description reads the stock `description`, an edit for vendors overwrites the production
 * description. The advice, or null. A suggestion, not a block.
 */
export function descriptionAdvice(kind: ItemKind, mapping: Mapping): string | null {
	if (mapping.description !== 'description') return null;
	return `Description is the ${noun(kind)}'s own description, so an edit here changes the production description in Flow PT. Map it to a field of its own, such as ${BID_DESCRIPTION}: leave it unmapped, then Create missing fields.`;
}
