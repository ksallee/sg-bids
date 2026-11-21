/**
 * Several requests at once on the Requests list: the ticks (a press, a Shift range, the header box),
 * the ticks kept to the rows shown, a selection split into what delete may do, and the line after.
 * Pure, no I/O. The press itself is the Add from Flow PT dialog's (`add-list.ts`); each request's
 * own rules are `request-delete.ts`.
 *
 * Delete asks once. A draft goes on that one confirm. A request sent to vendors in the selection
 * asks for a typed word, the way one alone asks for its name. A request whose award is in Flow PT is
 * skipped and named. The ticks only ever hold rows the filters show.
 */

import { shownState, toggle, toggleShown, type Ticks } from './add-list';
import { copyName } from './issue-words';
import { deletionPlan, names, requestName, type DeletionFacts } from './request-delete';

export type Selection = Ticks<string>;

export const NOTHING: Selection = { selected: new Set(), anchor: null };

const NONE: ReadonlySet<string> = new Set();

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A press on a row's box. With Shift, every row shown from the anchor to it takes the state it takes. */
export function press(selection: Selection, id: string, shown: readonly string[], shift: boolean): Selection {
	return toggle(selection, id, { order: shown, blocked: NONE, shift });
}

/** The header box: every row shown, or none when every one was ticked. */
export function pressAll(selection: Selection, shown: readonly string[]): Selection {
	return { selected: toggleShown(selection.selected, shown, NONE), anchor: selection.anchor };
}

/** Whether none, some or all of the rows shown are ticked. */
export function headerState(selection: Selection, shown: readonly string[]): 'none' | 'some' | 'all' {
	return shown.length === 0 ? 'none' : shownState(selection.selected, shown, NONE);
}

/** The ticks kept to the rows shown: a row gone or filtered out goes. The same selection when none did. */
export function prune(selection: Selection, shown: readonly string[]): Selection {
	const present = new Set(shown);
	const kept = [...selection.selected].filter((id) => present.has(id));
	const anchor = selection.anchor !== null && present.has(selection.anchor) ? selection.anchor : null;
	if (kept.length === selection.selected.size && anchor === selection.anchor) return selection;
	return { selected: new Set(kept), anchor };
}

/** The ticked rows, in the order shown. */
export function picked<T extends { readonly id: string }>(rows: readonly T[], selection: Selection): T[] {
	return rows.filter((row) => selection.selected.has(row.id));
}

/* delete --------------------------------------------------------------- */

/** One request's delete check: its facts, or why they could not be read. */
export type DeleteCheck = { readonly facts: DeletionFacts } | { readonly id: string; readonly name: string; readonly reason: string };

export interface Missed {
	readonly id: string;
	readonly name: string;
	/** A sentence. */
	readonly reason: string;
}

export interface DeleteSplit {
	/** Go on the one confirm. */
	readonly drafts: readonly DeletionFacts[];
	/** Issued or closed: they take the vendors' work with them, so the word is typed. */
	readonly sent: readonly DeletionFacts[];
	readonly skipped: readonly Missed[];
}

export const SKIPPED_AWARD = 'The award is in Flow PT. Undo the award first.';

export function splitDelete(checks: readonly DeleteCheck[]): DeleteSplit {
	const drafts: DeletionFacts[] = [];
	const sent: DeletionFacts[] = [];
	const skipped: Missed[] = [];
	for (const check of checks) {
		if (!('facts' in check)) {
			skipped.push({ id: check.id, name: check.name, reason: check.reason });
			continue;
		}
		const kind = deletionPlan(check.facts).kind;
		if (kind === 'refused') skipped.push({ id: check.facts.id, name: requestName(check.facts), reason: SKIPPED_AWARD });
		else (kind === 'draft' ? drafts : sent).push(check.facts);
	}
	return { drafts, sent, skipped };
}

export interface BulkDeletePlan {
	readonly title: string;
	readonly lines: readonly string[];
	/** The requests that stay, grouped by reason, one sentence each group. */
	readonly skipped: readonly string[];
	/** The word must be typed: a request sent to vendors is in it. */
	readonly typed: boolean;
	/** The button, or null when nothing can go. */
	readonly confirm: string | null;
}

/** The word typed to delete requests sent to vendors. */
export const DELETE_WORD = 'delete';

export function wordMatches(typed: string): boolean {
	return typed.trim().toLowerCase() === DELETE_WORD;
}

const sum = (list: readonly DeletionFacts[], key: 'invitations' | 'bids' | 'scenarios' | 'rates') => list.reduce((n, f) => n + f[key], 0);
const stop = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/** Names grouped by reason, in the order each reason first comes. */
function byReason(missed: readonly Missed[], say: (names: string, many: boolean) => string): string[] {
	const groups = new Map<string, string[]>();
	for (const m of missed) groups.set(stop(m.reason), [...(groups.get(stop(m.reason)) ?? []), m.name]);
	return [...groups].map(([reason, list]) => `${say(names(list), list.length > 1)} ${reason}`);
}

/** What the one confirm says goes, what stays and why, and whether the word is typed. */
export function bulkDeletePlan(split: DeleteSplit): BulkDeletePlan {
	const { drafts, sent } = split;
	const total = drafts.length + sent.length;
	const skipped = byReason(split.skipped, (list, many) => `${list} ${many ? 'are' : 'is'} skipped.`);
	if (total === 0) return { title: 'Nothing here can be deleted yet', lines: [], skipped, typed: false, confirm: null };
	const lines: string[] = [];
	if (drafts.length > 0) lines.push(`${plural(drafts.length, 'draft')}: ${names(drafts.map(requestName))}.`);
	if (sent.length > 0) lines.push(`${plural(sent.length, 'request')} sent to vendors: ${names(sent.map((f) => `${requestName(f)} (round ${f.round})`))}.`);
	const all = [...drafts, ...sent];
	if (sum(all, 'invitations') > 0) lines.push(`${plural(sum(all, 'invitations'), 'invitation')}. Their links stop working.`);
	if (sum(sent, 'bids') > 0) lines.push(`${plural(sum(sent, 'bids'), 'submitted bid')}.`);
	if (sum(sent, 'scenarios') > 0) lines.push(`${plural(sum(sent, 'scenarios'), 'award scenario')}.`);
	if (sum(sent, 'rates') > 0) lines.push(`${plural(sum(sent, 'rates'), 'exchange rate')}.`);
	const what = sent.length === 0 ? plural(drafts.length, 'draft') : plural(total, 'request');
	return { title: `Delete ${what}?`, lines, skipped, typed: sent.length > 0, confirm: `Delete ${what}` };
}

/* duplicate ------------------------------------------------------------ */

/** Each request with the name its copy takes: its own, then ` copy`. */
export function copies(rows: readonly { readonly id: string; readonly projectId: number; readonly title: string | null; readonly code: string }[]) {
	return rows.map((row) => {
		const name = requestName(row);
		return { id: row.id, projectId: row.projectId, name, copy: copyName(name) };
	});
}

/* the line after ------------------------------------------------------- */

/** How many went, then which did not and why. */
export function resultLine(kind: 'delete' | 'duplicate', outcome: { readonly went: number; readonly missed: readonly Missed[] }): string {
	const verb = kind === 'delete' ? 'deleted' : 'duplicated';
	const head =
		outcome.went === 0 ? `Nothing ${verb}.` : kind === 'delete' ? `Deleted ${plural(outcome.went, 'request')}.` : `Made ${plural(outcome.went, 'draft copy', 'draft copies')}.`;
	return [head, ...byReason(outcome.missed, (list, many) => `${list} ${many ? 'were' : 'was'} not ${verb}.`)].join(' ');
}
