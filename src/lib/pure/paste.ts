/**
 * Pasting prices from a spreadsheet into the bid form.
 *
 * Two shapes are read:
 *
 * - **A column** of prices: filled down from the cell pasted into, in the order the form shows.
 *   Rows past the last item are counted, never wrapped.
 * - **Code and price** rows, when most rows start with a code of the request: each price goes to its
 *   item wherever it was pasted. The price is the row's last cell. A first row that is not a code
 *   and holds no amount is a header and is skipped.
 *
 * A blank cell clears a price. `excluded` marks the item excluded. A cell that is not an amount is
 * reported with its row, and the rest still lands.
 */

import { parseAmount, showAmount, type DecimalMark } from './amount';

export type PasteUpdate = { readonly key: string; readonly price: string } | { readonly key: string; readonly excluded: true };

export interface PasteError {
	/** The row in the pasted text, from 1. */
	readonly row: number;
	readonly text: string;
	readonly message: string;
}

export interface PastePlan {
	readonly mode: 'column' | 'codes';
	readonly updates: readonly PasteUpdate[];
	readonly errors: readonly PasteError[];
	/** Column rows past the last item. */
	readonly overflow: number;
	/** Codes that name no item of the request. */
	readonly unknown: readonly string[];
}

export interface PasteContext {
	/** The key of the price cell pasted into. */
	readonly start: string;
	/** Every item key, in the order the form shows them. */
	readonly order: readonly string[];
	/** Item code to key. */
	readonly codes: ReadonlyMap<string, string>;
	readonly currency: string;
	readonly mark: DecimalMark;
}

const EXCLUDED = /^(excluded|exclude|excl\.?)$/i;

/** Rows and cells of clipboard text: tabs between cells, any line break between rows, quotes as a spreadsheet writes them. */
export function pasteCells(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else cell += ch;
		} else if (ch === '"' && cell === '') quoted = true;
		else if (ch === '\t') {
			row.push(cell);
			cell = '';
		} else if (ch === '\r' || ch === '\n') {
			if (ch === '\r' && text[i + 1] === '\n') i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else cell += ch;
	}
	if (cell !== '' || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}

function cellUpdate(key: string, text: string, row: number, context: PasteContext, errors: PasteError[]): PasteUpdate | null {
	const trimmed = text.trim();
	if (EXCLUDED.test(trimmed)) return { key, excluded: true };
	const parsed = parseAmount(trimmed, context.currency, context.mark);
	if (parsed.kind === 'error') {
		errors.push({ row, text: trimmed, message: parsed.message });
		return null;
	}
	return { key, price: parsed.kind === 'blank' ? '' : showAmount(parsed.decimal, context.mark) };
}

function codeKey(cell: string | undefined, codes: ReadonlyMap<string, string>): string | undefined {
	if (cell === undefined) return undefined;
	const wanted = cell.trim().toUpperCase();
	for (const [code, key] of codes) if (code.toUpperCase() === wanted) return key;
	return undefined;
}

/** What a paste does, or null for a single value, which the input takes as typed. */
export function planPaste(text: string, context: PasteContext): PastePlan | null {
	const rows = pasteCells(text);
	if (rows.length === 0 || (rows.length === 1 && rows[0].length === 1)) return null;
	const errors: PasteError[] = [];
	const updates: PasteUpdate[] = [];

	const filled = rows.map((cells, index) => ({ cells, row: index + 1 })).filter(({ cells }) => cells.some((c) => c.trim() !== ''));
	const matched = filled.filter(({ cells }) => cells.length >= 2 && codeKey(cells[0], context.codes) !== undefined);
	if (filled.every(({ cells }) => cells.length >= 2) && matched.length >= Math.max(1, Math.ceil(filled.length / 2))) {
		const unknown: string[] = [];
		for (const [index, { cells, row }] of filled.entries()) {
			const key = codeKey(cells[0], context.codes);
			const last = cells[cells.length - 1];
			if (key === undefined) {
				const header = index === 0 && parseAmount(last.trim(), context.currency, context.mark).kind === 'error';
				if (!header) unknown.push(cells[0].trim());
				continue;
			}
			const update = cellUpdate(key, last, row, context, errors);
			if (update) updates.push(update);
		}
		return { mode: 'codes', updates, errors, overflow: 0, unknown };
	}

	const from = Math.max(0, context.order.indexOf(context.start));
	let overflow = 0;
	for (const [index, cells] of rows.entries()) {
		const key = context.order[from + index];
		if (key === undefined) {
			overflow++;
			continue;
		}
		const update = cellUpdate(key, cells[0] ?? '', index + 1, context, errors);
		if (update) updates.push(update);
	}
	return { mode: 'column', updates, errors, overflow, unknown: [] };
}
