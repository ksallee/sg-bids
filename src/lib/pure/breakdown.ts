/**
 * A breakdown into request rows: text pasted from a spreadsheet or read from a CSV file, its columns
 * matched to what a shot or asset carries, then the rows to add, each problem named by its row.
 * Pure, no I/O.
 *
 * - The text is tab, comma or semicolon separated, read from its first line. Quotes follow RFC 4180:
 *   a quoted cell may hold the separator, a line break, and a doubled quote. A BOM, CRLF or a lone
 *   CR, and blank lines are read as a spreadsheet writes them. A record keeps its spreadsheet row,
 *   so a problem names the row the person sees.
 * - The first row is a header when a cell in it is a known column name. Columns are matched by
 *   name; with no header the first is the code and the second the description.
 * - A row with no code is left out. A frame count that does not read is left blank and the row
 *   stays. Both are named by row. A count reads with any locale's thousands separator.
 * - A code already in the request, or repeated in the paste, follows one choice for the batch:
 *   skip it, replace the row there (its id and Flow PT row kept), or keep both. Codes compare
 *   without case, as Flow PT's filters do (field_types/text).
 * - A breakdown row has no Flow PT row: `source: 'breakdown'`, no `fpt`.
 */

import type { ItemKind } from './field-map';
import type { Id, RequestAsset, RequestShot } from './model';

export type Delimiter = '\t' | ',' | ';';

export interface TableRecord {
	/** The row in the spreadsheet, from 1. */
	readonly row: number;
	readonly cells: readonly string[];
}

export interface Table {
	readonly delimiter: Delimiter;
	readonly records: readonly TableRecord[];
	/** The most cells in a record. */
	readonly width: number;
}

/** The separator of the first line, outside quotes: a tab, else a comma, else a semicolon. */
function delimiterOf(text: string): Delimiter {
	let quoted = false;
	const seen = { '\t': 0, ',': 0, ';': 0 };
	for (const ch of text) {
		if (ch === '"') quoted = !quoted;
		else if (!quoted && (ch === '\n' || ch === '\r')) break;
		else if (!quoted && ch in seen) seen[ch as Delimiter]++;
	}
	if (seen['\t'] > 0) return '\t';
	if (seen[','] === 0 && seen[';'] > 0) return ';';
	return ',';
}

export function parseTable(input: string): Table {
	const text = input.replace(/^﻿/, '');
	const delimiter = delimiterOf(text);
	const raw: string[][] = [];
	let record: string[] = [];
	let cell = '';
	let quoted = false;
	let started = false; // the cell began with a quote
	const endCell = () => {
		record.push(started ? cell : cell.trim());
		cell = '';
		started = false;
	};
	const endRecord = () => {
		endCell();
		raw.push(record);
		record = [];
	};
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					cell += '"';
					i++;
				} else quoted = false;
			} else cell += ch;
			continue;
		}
		if (ch === '"' && cell.trim() === '' && !started) {
			cell = '';
			quoted = true;
			started = true;
		} else if (ch === delimiter) endCell();
		else if (ch === '\r') {
			if (text[i + 1] === '\n') i++;
			endRecord();
		} else if (ch === '\n') endRecord();
		else cell += ch;
	}
	if (cell !== '' || started || record.length > 0) endRecord();
	const records: TableRecord[] = [];
	raw.forEach((cells, index) => {
		const trimmed = cells.map((c) => (c.trim() === '' ? '' : c));
		if (trimmed.every((c) => c === '')) return;
		records.push({ row: index + 1, cells: trimmed.map((c) => c.replace(/\r\n?/g, '\n')) });
	});
	return { delimiter, records, width: records.reduce((n, r) => Math.max(n, r.cells.length), 0) };
}

// Frames.

export type Frames = { readonly kind: 'blank' } | { readonly kind: 'frames'; readonly frames: number } | { readonly kind: 'error'; readonly message: string };

const GROUPED = /^\d{1,3}([,.'   ])\d{3}(\1\d{3})*$/;
const DECIMAL = /^\d+[.,](\d+)$/;
const TIMECODE = /^\d{1,2}(:\d{2}){2,3}([:;.]\d{2})?$/;

/** A frame count as typed: `96`, `1,234`, `1.234`, `1 234`, `24.0`. */
export function parseFrames(input: string): Frames {
	const text = input.trim();
	if (text === '') return { kind: 'blank' };
	const say = (what: string): Frames => ({ kind: 'error', message: `"${text}" ${what}` });
	let digits: string | null = null;
	if (/^\d+$/.test(text)) digits = text;
	else if (GROUPED.test(text)) digits = text.replace(/[,.'   ]/g, '');
	else if (DECIMAL.test(text)) {
		if (!/^0+$/.test(DECIMAL.exec(text)![1])) return say('is not a whole number of frames.');
		digits = text.split(/[.,]/)[0];
	} else if (TIMECODE.test(text)) return say('is a timecode. Give the count in frames.');
	else if (/^-\s*\d/.test(text)) return say('is below zero.');
	else return say('is not a number of frames.');
	const frames = Number(digits);
	if (!Number.isSafeInteger(frames)) return say('is too large.');
	return { kind: 'frames', frames };
}

// Columns.

export type Column = 'code' | 'description' | 'sequence' | 'episode' | 'scene' | 'frames' | 'difficulty' | 'type' | 'assets' | 'notes';

export interface ColumnSpec {
	readonly column: Column;
	readonly label: string;
	readonly kinds: readonly ItemKind[];
	/** Header names it answers to, normalised: lower case, words split by spaces. */
	readonly names: readonly string[];
}

const BOTH: readonly ItemKind[] = ['shot', 'asset'];
const SHOT: readonly ItemKind[] = ['shot'];

export const COLUMNS: readonly ColumnSpec[] = [
	{
		column: 'code',
		label: 'Code',
		kinds: BOTH,
		names: ['code', 'shot', 'shot code', 'shot name', 'shot id', 'shot number', 'shot no', 'vfx id', 'vfx shot', 'vfx number', 'vfx code', 'id', 'name', 'asset', 'asset name', 'asset code']
	},
	{
		column: 'description',
		label: 'Description',
		kinds: BOTH,
		names: ['description', 'desc', 'action', 'vfx description', 'vfx work', 'work', 'scope', 'summary', 'brief', 'what']
	},
	{ column: 'sequence', label: 'Sequence', kinds: SHOT, names: ['sequence', 'seq', 'sq', 'sequence code', 'sequence name'] },
	{ column: 'episode', label: 'Episode', kinds: SHOT, names: ['episode', 'ep', 'eps', 'episode code', 'episode number'] },
	{ column: 'scene', label: 'Scene', kinds: SHOT, names: ['scene', 'sc', 'scene number', 'scene no'] },
	{
		column: 'frames',
		label: 'Frames',
		kinds: SHOT,
		names: ['frames', 'frame count', 'frames count', 'frame', 'fr', 'duration', 'dur', 'length', 'cut length', 'cut duration', 'cut frames', 'working duration']
	},
	{ column: 'difficulty', label: 'Difficulty', kinds: BOTH, names: ['difficulty', 'complexity', 'tier', 'level', 'grade', 'rating'] },
	{ column: 'type', label: 'Type', kinds: BOTH, names: ['type', 'shot type', 'asset type', 'category', 'kind', 'work type', 'vfx type'] },
	{ column: 'assets', label: 'Linked assets', kinds: SHOT, names: ['assets', 'linked assets', 'asset list', 'assets used', 'asset links'] },
	{ column: 'notes', label: 'Notes', kinds: BOTH, names: ['notes', 'note', 'comments', 'comment', 'remarks', 'production notes', 'note to vendors'] }
];

export function columnsFor(kind: ItemKind): readonly ColumnSpec[] {
	return COLUMNS.filter((c) => c.kinds.includes(kind));
}

export function columnLabel(column: Column): string {
	return COLUMNS.find((c) => c.column === column)!.label;
}

function normal(header: string): string {
	return header
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function exact(header: string, kind: ItemKind): Column | null {
	const h = normal(header);
	return columnsFor(kind).find((c) => c.names.includes(h))?.column ?? null;
}

/** A header holding a name of two words or more, the longest first: `Shot code (VFX)`. */
function within(header: string, kind: ItemKind, taken: ReadonlySet<Column>): Column | null {
	const h = ` ${normal(header)} `;
	let best: { column: Column; length: number } | null = null;
	for (const spec of columnsFor(kind)) {
		if (taken.has(spec.column)) continue;
		for (const name of spec.names) {
			if (!name.includes(' ') || !h.includes(` ${name} `)) continue;
			if (!best || name.length > best.length) best = { column: spec.column, length: name.length };
		}
	}
	return best?.column ?? null;
}

/** A first row is a header when a cell in it is a known column name. */
export function looksLikeHeader(cells: readonly string[], kind: ItemKind): boolean {
	return cells.some((cell) => exact(cell, kind) !== null) || cells.filter((cell) => within(cell, kind, new Set()) !== null).length >= 2;
}

/** The header, when the first row is one, and the records under it. */
export function splitTable(table: Table, kind: ItemKind, header?: boolean): { header: readonly string[] | null; records: readonly TableRecord[] } {
	const [first, ...rest] = table.records;
	if (!first) return { header: null, records: [] };
	const isHeader = header ?? looksLikeHeader(first.cells, kind);
	return isHeader ? { header: first.cells, records: rest } : { header: null, records: table.records };
}

function wholeNumbers(records: readonly TableRecord[], index: number): boolean {
	const cells = records.map((r) => r.cells[index] ?? '').filter((c) => c.trim() !== '');
	return cells.length > 0 && cells.every((c) => parseFrames(c).kind === 'frames');
}

/** Each column's field, by header name, each field once. With no header: the code, the description, then whole numbers as frames. */
export function detectColumns(header: readonly string[] | null, records: readonly TableRecord[], kind: ItemKind): (Column | null)[] {
	const width = Math.max(header?.length ?? 0, ...records.map((r) => r.cells.length), 0);
	const out: (Column | null)[] = Array.from({ length: width }, () => null);
	const taken = new Set<Column>();
	if (header) {
		header.forEach((cell, i) => {
			const column = exact(cell, kind);
			if (column && !taken.has(column)) {
				out[i] = column;
				taken.add(column);
			}
		});
		header.forEach((cell, i) => {
			if (out[i]) return;
			const column = within(cell, kind, taken);
			if (column) {
				out[i] = column;
				taken.add(column);
			}
		});
		return out;
	}
	if (width > 0) out[0] = 'code';
	if (width > 1) out[1] = 'description';
	if (kind === 'shot') {
		for (let i = 2; i < width; i++) {
			if (wholeNumbers(records, i)) {
				out[i] = 'frames';
				break;
			}
		}
	}
	return out;
}

// The plan.

export type DuplicateChoice = 'skip' | 'replace' | 'both';

export interface RowIssue {
	/** The spreadsheet row, 0 for the batch as a whole. */
	readonly row: number;
	readonly level: 'error' | 'warning';
	readonly code?: string;
	readonly message: string;
}

export interface Duplicate {
	readonly row: number;
	readonly code: string;
	/** `in the request`, or `row 4` for an earlier row of the paste. */
	readonly matches: string;
}

export interface PlanInput {
	readonly kind: ItemKind;
	/** The records to read: the header left out. */
	readonly records: readonly TableRecord[];
	readonly columns: readonly (Column | null)[];
	readonly existing: { readonly shots: readonly RequestShot[]; readonly assets: readonly RequestAsset[] };
	readonly duplicates: DuplicateChoice;
	/** Add the assets a shot names that the request lacks, as breakdown rows. */
	readonly addAssets: boolean;
	/** A new item id for a kind. */
	readonly newId: (kind: ItemKind) => Id;
}

export interface BreakdownPlan<T> {
	/** New rows, in order. */
	readonly add: readonly T[];
	/** Rows of the request a breakdown row replaces, by id. */
	readonly replace: readonly { readonly row: number; readonly id: Id; readonly item: T }[];
	readonly duplicates: readonly Duplicate[];
	readonly issues: readonly RowIssue[];
	/** Assets the shots name that the request lacks. */
	readonly assetsToAdd: readonly RequestAsset[];
	/** Something to add and nothing that stops it. */
	readonly ready: boolean;
}

const MAX_CODE = 200;

function list(parts: readonly string[]): string {
	return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

const key = (code: string) => code.trim().toLowerCase();

type Fields = Record<string, unknown>;

/** The row's mapped values: text trimmed, blank as undefined, frames read. */
function readRow(record: TableRecord, columns: readonly (Column | null)[], issues: RowIssue[], code: string): { fields: Fields; assets: string[] | null } {
	const fields: Fields = {};
	let assets: string[] | null = null;
	columns.forEach((column, i) => {
		if (!column || column === 'code') return;
		const cell = (record.cells[i] ?? '').trim();
		if (column === 'frames') {
			const frames = parseFrames(cell);
			if (frames.kind === 'frames') fields.frames = frames.frames;
			else {
				fields.frames = undefined;
				if (frames.kind === 'error') issues.push({ row: record.row, level: 'warning', code, message: `Row ${record.row}, ${code}: ${frames.message} Frames left blank.` });
			}
		} else if (column === 'assets') {
			assets = cell
				.split(/[,;|\n]/)
				.map((n) => n.trim())
				.filter(Boolean);
		} else fields[column] = cell === '' ? undefined : cell;
	});
	return { fields, assets };
}

function compact<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export function planBreakdown(input: PlanInput): BreakdownPlan<RequestShot> | BreakdownPlan<RequestAsset>;
export function planBreakdown(input: PlanInput): BreakdownPlan<RequestShot | RequestAsset> {
	const { kind, columns } = input;
	const issues: RowIssue[] = [];
	const empty = (): BreakdownPlan<never> => ({ add: [], replace: [], duplicates: [], issues, assetsToAdd: [], ready: false });
	const offered = new Set(columnsFor(kind).map((c) => c.column));
	const picked = columns.filter((c): c is Column => c !== null && offered.has(c));
	const codeAt = columns.indexOf('code');
	if (codeAt < 0) {
		issues.push({ row: 0, level: 'error', message: 'Pick the column that holds the code.' });
		return empty();
	}
	const twice = picked.find((c, i) => picked.indexOf(c) !== i);
	if (twice) {
		issues.push({ row: 0, level: 'error', message: `${columnLabel(twice)} is picked for two columns. Pick it once.` });
		return empty();
	}
	const usable = columns.map((c) => (c !== null && offered.has(c) ? c : null));

	const existingItems: readonly (RequestShot | RequestAsset)[] = kind === 'shot' ? input.existing.shots : input.existing.assets;
	const labelOf = (item: RequestShot | RequestAsset) => ('code' in item ? item.code : item.name);
	const inRequest = new Map<string, RequestShot | RequestAsset>();
	for (const item of existingItems) if (!inRequest.has(key(labelOf(item)))) inRequest.set(key(labelOf(item)), item);

	const assetsByName = new Map(input.existing.assets.map((a) => [key(a.name), a.id]));
	const assetsToAdd: RequestAsset[] = [];

	const add: (RequestShot | RequestAsset)[] = [];
	const addRow = new Map<number, number>(); // index in `add` -> spreadsheet row
	const inBatch = new Map<string, number>(); // code -> index in `add`
	const replace = new Map<Id, { row: number; id: Id; item: RequestShot | RequestAsset }>();
	const duplicates: Duplicate[] = [];

	for (const record of input.records) {
		const code = (record.cells[codeAt] ?? '').trim();
		if (code === '') {
			issues.push({ row: record.row, level: 'error', message: `Row ${record.row} has no code. It is left out.` });
			continue;
		}
		if (code.length > MAX_CODE) {
			issues.push({ row: record.row, level: 'error', message: `Row ${record.row}: the code is longer than ${MAX_CODE} characters. It is left out.` });
			continue;
		}
		const { fields, assets } = readRow(record, usable, issues, code);
		let assetIds: Id[] | null = null;
		if (kind === 'shot' && assets !== null) {
			assetIds = [];
			const missing: string[] = [];
			for (const name of assets as string[]) {
				let id = assetsByName.get(key(name));
				if (!id && input.addAssets) {
					id = input.newId('asset');
					assetsToAdd.push({ id, name, source: 'breakdown', omitted: false });
					assetsByName.set(key(name), id);
				}
				if (id) {
					if (!assetIds.includes(id)) assetIds.push(id);
				} else missing.push(name);
			}
			if (missing.length > 0) {
				issues.push({ row: record.row, level: 'warning', code, message: `Row ${record.row}, ${code}: ${list(missing)} ${missing.length === 1 ? 'is' : 'are'} not in the request. Not linked.` });
			}
		}
		const fresh = (): RequestShot | RequestAsset => {
			const id = input.newId(kind);
			return kind === 'shot'
				? (compact({ id, code, source: 'breakdown', omitted: false, assetIds: assetIds ?? [], ...fields }) as RequestShot)
				: (compact({ id, name: code, source: 'breakdown', omitted: false, ...fields }) as RequestAsset);
		};
		const over = (item: RequestShot | RequestAsset): RequestShot | RequestAsset => {
			const next: Fields = { ...item, ...fields, ...(kind === 'shot' ? { code } : { name: code }) };
			if (kind === 'shot' && assetIds !== null) next.assetIds = assetIds;
			return compact(next) as unknown as RequestShot | RequestAsset;
		};

		const k = key(code);
		const earlier = inBatch.get(k);
		const there = inRequest.get(k);
		if (earlier !== undefined) {
			duplicates.push({ row: record.row, code, matches: `row ${addRow.get(earlier)}` });
			if (input.duplicates === 'skip') continue;
			if (input.duplicates === 'replace') {
				add[earlier] = over(add[earlier]);
				addRow.set(earlier, record.row);
				continue;
			}
		} else if (there) {
			duplicates.push({ row: record.row, code, matches: 'in the request' });
			if (input.duplicates === 'skip') continue;
			if (input.duplicates === 'replace') {
				const base = replace.get(there.id)?.item ?? there;
				replace.set(there.id, { row: record.row, id: there.id, item: over(base) });
				continue;
			}
		}
		add.push(fresh());
		addRow.set(add.length - 1, record.row);
		if (earlier === undefined) inBatch.set(k, add.length - 1);
	}

	return {
		add,
		replace: [...replace.values()],
		duplicates,
		issues,
		assetsToAdd,
		ready: add.length + replace.size > 0
	};
}

/** The request's rows of both kinds after the plan: replaced in place, new ones after, the named assets added. */
export function applyBreakdown(
	existing: { readonly shots: readonly RequestShot[]; readonly assets: readonly RequestAsset[] },
	plan: BreakdownPlan<RequestShot> | BreakdownPlan<RequestAsset>,
	kind: ItemKind
): { shots: RequestShot[]; assets: RequestAsset[] } {
	const swap = <T extends { id: Id }>(items: readonly T[]) => {
		const by = new Map(plan.replace.map((r) => [r.id, r.item as unknown as T]));
		return items.map((item) => by.get(item.id) ?? item);
	};
	if (kind === 'shot') {
		return { shots: [...swap(existing.shots), ...(plan.add as RequestShot[])], assets: [...existing.assets, ...plan.assetsToAdd] };
	}
	return { shots: [...existing.shots], assets: [...swap(existing.assets), ...(plan.add as RequestAsset[]), ...plan.assetsToAdd] };
}
