/**
 * What the draft's table says about an edit: the confirm before a bulk edit, the line after it,
 * and the line after an undo. Pure, no I/O.
 */

import type { ItemKind } from './field-map';
import { cellTarget, type RequestColumn } from './live-columns';
import type { Id } from './model';
import type { Change } from './row-edit';

/** Where a bulk edit's rows land: how many in Flow PT, how many in the request, and why the rest are left. */
export interface TargetSplit {
	readonly fpt: number;
	readonly request: number;
	readonly locked: readonly string[];
}

interface Item {
	readonly id: Id;
	readonly fpt?: { readonly type: string; readonly id: number };
	readonly source?: 'breakdown';
}

export function splitTargets(column: RequestColumn, items: readonly Item[], gone: ReadonlySet<Id>): TargetSplit {
	let fpt = 0;
	let request = 0;
	const locked: string[] = [];
	for (const item of items) {
		const target = cellTarget(column, item, gone.has(item.id));
		if (target.kind === 'fpt') fpt += 1;
		else if (target.kind === 'request') request += 1;
		else locked.push(target.reason);
	}
	return { fpt, request, locked };
}

function count(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

function nouns(kind: ItemKind): [string, string] {
	return kind === 'shot' ? ['Shot', 'Shots'] : ['Asset', 'Assets'];
}

/** "on 38 Shots in Flow PT and on 2 rows in this request". */
function where(kind: ItemKind, fpt: number, request: number): string {
	const parts: string[] = [];
	if (fpt > 0) parts.push(`on ${count(fpt, ...nouns(kind))} in Flow PT`);
	if (request > 0) parts.push(`on ${count(request, 'row', 'rows')} in this request`);
	return parts.join(' and ');
}

/** The confirm before a bulk edit writes. */
export function bulkConfirm(kind: ItemKind, label: string, split: TargetSplit): { title: string; lines: string[] } {
	const lines = [`This changes ${label} ${where(kind, split.fpt, split.request)}.`];
	if (split.locked.length > 0) {
		const reasons = [...new Set(split.locked)].join(' ');
		lines.push(`${count(split.locked.length, 'selected row stays', 'selected rows stay')} as ${split.locked.length === 1 ? 'it is' : 'they are'}. ${reasons}`);
	}
	return { title: `Change ${label} on ${count(split.fpt + split.request, 'row', 'rows')}?`, lines };
}

/** The line after an edit, for the toast that offers Undo. */
export function editLine(kind: ItemKind, label: string, changes: readonly Change[], codeOf: (id: Id) => string): string {
	const fpt = changes.filter((c) => c.target).length;
	const request = changes.length - fpt;
	if (changes.length === 1) return `${label} of ${codeOf(changes[0].itemId)} changed ${fpt === 1 ? 'in Flow PT' : 'in this request'}.`;
	return `${label} changed ${where(kind, fpt, request)}.`;
}

interface UndoShape {
	readonly fpt: readonly unknown[];
	readonly local: readonly unknown[];
	readonly conflicts: readonly { readonly change: Change; readonly now: string | number | null }[];
	readonly gone: readonly Change[];
}

/** The line after an undo: what came back, and what was left because Flow PT changed since. */
export function undoLine(plan: UndoShape, codeOf: (id: Id) => string): string {
	const parts: string[] = [];
	if (plan.conflicts.length === 0 && plan.gone.length === 0) return 'The old values are back.';
	if (plan.conflicts.length > 0) {
		const named = plan.conflicts.map((c) => `${codeOf(c.change.itemId)} (now ${c.now === null ? 'empty' : c.now})`).join(', ');
		parts.push(`${plan.conflicts.length} changed in Flow PT since your edit and stay as Flow PT holds them: ${named}.`);
	}
	if (plan.gone.length > 0) parts.push(`${plan.gone.length} ${plan.gone.length === 1 ? 'is' : 'are'} gone from Flow PT.`);
	return parts.join(' ');
}

/** One row by its code, or a row with no code as such: never its inner id. */
function oneRow(code: string): string {
	return code.trim() === '' ? 'A row with no code' : code.trim();
}

/** The line after rows are taken out of the request, by their codes. */
export function removedLine(codes: readonly string[]): string {
	return codes.length === 1 ? `${oneRow(codes[0])} is out of the request.` : `${codes.length} rows are out of the request.`;
}

/** The line after rows move to another bid, by their codes. */
export function movedLine(codes: readonly string[], bidName: string): string {
	return codes.length === 1 ? `${oneRow(codes[0])} is in ${bidName} now.` : `${codes.length} rows are in ${bidName} now.`;
}
