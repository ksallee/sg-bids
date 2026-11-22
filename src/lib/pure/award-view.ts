/**
 * The award as the publish page and the award panel say it: the counts on the button, the steps of
 * the write in order, the lines grouped per item, the undo in words. Display only. Pure, no I/O.
 */

import type { AwardPlan, CreatedType, LinePreview, Step, Written } from './fpt-award';

export interface PlanCounts {
	readonly bids: { readonly create: number; readonly update: number };
	readonly lines: { readonly create: number; readonly update: number };
	readonly groups: number;
	readonly removed: { readonly bids: number; readonly lines: number; readonly groups: number; readonly items: number };
	readonly links: number;
	/** Rows the run creates, by type. */
	readonly created: Readonly<Record<CreatedType, number>>;
}

export function planCounts(plan: AwardPlan): PlanCounts {
	const count = (entity: 'bid' | 'line', kind: 'create' | 'update') => plan.steps.flatMap((s) => s.writes).filter((w) => (w.kind === 'create' || w.kind === 'update') && w.entity === entity && w.kind === kind).length;
	const writes = plan.steps.flatMap((s) => s.writes);
	return {
		bids: { create: count('bid', 'create'), update: count('bid', 'update') },
		lines: { create: count('line', 'create'), update: count('line', 'update') },
		groups: writes.reduce((n, w) => n + (w.kind === 'addGroups' ? w.groups.length : 0), 0),
		removed: {
			bids: writes.filter((w) => w.kind === 'delete' && w.entity === 'bid').length,
			lines: writes.filter((w) => w.kind === 'delete' && w.entity === 'line').length,
			groups: writes.reduce((n, w) => n + (w.kind === 'removeGroups' ? w.groups.length : 0), 0),
			items: writes.filter((w) => w.kind === 'delete' && w.entity === 'item').length
		},
		links: writes.filter((w) => w.kind === 'link').length,
		created: {
			Shot: writes.filter((w) => w.kind === 'createItem' && w.itemType === 'Shot').length,
			Asset: writes.filter((w) => w.kind === 'createItem' && w.itemType === 'Asset').length,
			Sequence: writes.filter((w) => w.kind === 'createItem' && w.itemType === 'Sequence').length
		}
	};
}

function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** `a, b and c`. */
export function list(parts: readonly string[]): string {
	if (parts.length <= 1) return parts[0] ?? '';
	return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The publish button: what it writes, in a few words. */
export function publishLabel(plan: AwardPlan): string {
	const c = planCounts(plan);
	const parts: string[] = [];
	const bids = c.bids.create + c.bids.update;
	const lines = c.lines.create + c.lines.update;
	if (c.created.Shot) parts.push(plural(c.created.Shot, 'Shot'));
	if (c.created.Asset) parts.push(plural(c.created.Asset, 'Asset'));
	if (c.created.Sequence) parts.push(plural(c.created.Sequence, 'Sequence'));
	if (bids) parts.push(plural(bids, 'Bid'));
	if (lines) parts.push(plural(lines, 'Bid Line'));
	if (c.groups) parts.push(plural(c.groups, 'Group'));
	return parts.length ? `Publish ${list(parts)}` : 'Publish';
}

export interface StepView {
	readonly label: string;
	/** What the step does, one line. */
	readonly line: string;
	readonly writes: number;
}

/** Each step of the write, in the order it runs, with what it does. */
export function stepViews(plan: AwardPlan): StepView[] {
	return plan.steps.map((step: Step) => {
		const n = step.writes.length;
		let line: string;
		switch (step.label) {
			case 'Take back what the scenario dropped':
				line = 'Removes the Groups and deletes the rows an earlier publish wrote that this scenario no longer awards. One batch, all or nothing.';
				break;
			case 'Sequences':
				line = 'One batch, all or nothing. Creates the Sequences the new Shots name that the project lacks, as you asked.';
				break;
			case 'Shots and Assets':
				line = 'One batch, all or nothing. Creates the awarded rows from the breakdown in Flow PT: code, description and the mapped fields that hold a value. Undo award deletes them.';
				break;
			case 'Bids':
				line = 'One batch, all or nothing. Rows found by their key are updated, never written twice.';
				break;
			case 'Bid Lines and vendor Groups':
				line = 'One batch for each 200 writes, each all or nothing. A Group is added beside those already there, never in their place.';
				break;
			case 'App links':
				line = 'One request per new Bid: Flow PT takes a link only one at a time.';
				break;
			default:
				line = '';
		}
		return { label: step.label, line, writes: n };
	});
}

export interface ItemLines {
	readonly item: string;
	readonly lines: readonly LinePreview[];
	readonly split: boolean;
}

/** The preview's lines by item, in the order written, a split item's vendors together. */
export function linesByItem(lines: readonly LinePreview[]): ItemLines[] {
	const out = new Map<string, LinePreview[]>();
	for (const l of lines) {
		const key = l.target;
		out.set(key, [...(out.get(key) ?? []), l]);
	}
	return [...out.values()].map((ls) => ({ item: ls[0].item, lines: ls, split: ls.filter((l) => l.share !== null).length > 1 }));
}

/** The rows a publish created that the undo left in Flow PT, and why. Null when it left none. */
export function leftLine(left: readonly { readonly type: string; readonly id: number; readonly key: string; readonly why: string }[]): string | null {
	if (left.length === 0) return null;
	const each = left.map((l) => `${l.type} ${l.id} (${l.why})`);
	return `Undo left ${left.length === 1 ? 'a row' : `${left.length} rows`} the publish created: ${list(each)}. ${left.length === 1 ? 'It has' : 'They have'} links the app did not make, so ${left.length === 1 ? 'it stays' : 'they stay'} in Flow PT. The app no longer tracks ${left.length === 1 ? 'it' : 'them'}.`;
}

/** What the undo takes back, in words. */
export function undoLine(written: Written): string {
	const groups = written.groups.reduce((n, g) => n + g.groups.length, 0);
	const bids = written.bids.filter((b) => b.created).length;
	const lines = written.lines.filter((l) => l.created).length;
	const parts: string[] = [];
	if (groups) parts.push(`removes ${plural(groups, 'Group')} from the Shots and Assets`);
	const rows = [bids ? plural(bids, 'Bid') : '', lines ? plural(lines, 'Bid Line') : ''].filter(Boolean);
	if (rows.length) parts.push(`deletes ${list(rows)}`);
	const items = written.items ?? [];
	if (items.length) {
		const made = (['Shot', 'Asset', 'Sequence'] as const).map((t) => [t, items.filter((i) => i.type === t).length] as const).filter(([, n]) => n > 0);
		parts.push(`deletes the ${list(made.map(([t, n]) => plural(n, t)))} the publish created, unless one has gained Tasks, Versions or other links since`);
	}
	if (parts.length === 0) return 'Undo finds nothing the app wrote. It clears the award in the app.';
	return `Undo ${list(parts)}. Then the request is issued again and the rates unlock.`;
}
