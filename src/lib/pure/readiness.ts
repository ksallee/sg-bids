/**
 * How far a draft request is from going out, in words. Pure, no I/O.
 *
 * Every problem names its field and points at the control that fixes it: a summary never counts
 * without naming. Nothing but a project stops a save (`persist.savable` makes the code when it is
 * blank). The issue needs what `header.REQUIRED` names and one Shot or Asset still in. A due date
 * in the past is a warning while the draft is worked on and an error at issue.
 *
 * A request made from bids (`send`) needs a bid, no row in two of its bids, a vendor, and a bid for
 * each vendor; its rows are its bids', so a problem with them points at the bids.
 */

import { OPTIONAL_GROUPS, checkHeader, LABELS, type FieldProblem, type HeaderForm, type Stage } from './header';
import type { Day, Id } from './model';
import type { BuilderState } from './request';

/** What a problem points at: a header field, the project, the picked Shots and Assets, the request's bids or its vendors. */
export type Target = keyof HeaderForm | 'project' | 'items' | 'bids' | 'vendors';

export interface Problem {
	readonly id: string;
	readonly target: Target;
	readonly label: string;
	readonly tone: 'error' | 'warning';
	/** Something still to do, not a value to fix: a blank required field, nothing picked. */
	readonly missing: boolean;
	readonly short: string;
	readonly message: string;
}

export interface ChecklistLine {
	readonly key: string;
	readonly label: string;
	/** `todo` is a problem that is `missing`. */
	readonly state: 'done' | 'todo' | 'error' | 'warning';
	/** What is set, or what is wrong, in a few words. */
	readonly detail: string;
	readonly target: Target;
}

/** Another request of the project, as the requests list gives it. */
export interface OtherRequest {
	readonly id: Id;
	readonly code: string;
	readonly round: number;
}

/** A request made from bids: what it takes beyond the header. */
export interface SendFacts {
	/** The bids it is made from, by name. */
	readonly bids: readonly string[];
	/** Rows in two of its bids: the code and the two bids' names. */
	readonly overlaps: readonly { readonly code: string; readonly bids: readonly [string, string] }[];
	/** The vendors added, each with how many of the bids it is invited to. */
	readonly vendors: readonly { readonly name: string; readonly bids: number }[];
}

export interface ReadinessInput {
	readonly state: BuilderState;
	readonly today: Day;
	readonly others?: readonly OtherRequest[];
	readonly send?: SendFacts;
}

export interface Readiness {
	/** What is wrong now, in the order of the page. */
	readonly problems: readonly Problem[];
	/** What stops the issue: the problems as the issue checks them. */
	readonly toIssue: readonly Problem[];
	readonly canSave: boolean;
	readonly canIssue: boolean;
	/** The summary's lines: each required thing, set or not, then any other problem. */
	readonly checklist: readonly ChecklistLine[];
}

const ITEMS_LABEL = 'Shots and assets';
const ROUND = /^[1-9]\d*$/;

function fromField(p: FieldProblem): Problem {
	return { id: p.field, target: p.field, label: p.label, tone: p.tone, missing: p.missing, short: p.short, message: p.message };
}

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function problemsAt(input: ReadinessInput, stage: Stage): Problem[] {
	const { state, today } = input;
	const out: Problem[] = [];
	if (!state.project) out.push({ id: 'project', target: 'project', label: 'Project', tone: 'error', missing: true, short: 'not picked', message: 'Pick the project.' });

	const header = checkHeader(state.form, today, stage).map(fromField);
	const code = state.form.code.trim();
	const round = state.form.round.trim();
	const clash = code !== '' && ROUND.test(round) ? input.others?.find((o) => o.id !== state.id && o.code === code && o.round === Number(round)) : undefined;
	if (clash && !header.some((p) => p.target === 'code')) {
		const at = header.findIndex((p) => p.target !== 'title');
		const problem: Problem = {
			id: 'code',
			target: 'code',
			label: LABELS.code,
			tone: 'error',
			missing: false,
			short: 'used by another request',
			message: `Another request in this project has the code ${code} in round ${clash.round}. Change the code.`
		};
		header.splice(at === -1 ? header.length : at, 0, problem);
	}
	out.push(...header);

	const send = input.send;
	if (send && send.bids.length === 0) {
		out.push({ id: 'bids', target: 'bids', label: BIDS_LABEL, tone: 'error', missing: true, short: 'none picked', message: 'Pick at least one bid.' });
	} else {
		const target: Target = send ? 'bids' : 'items';
		const items = [...state.shots, ...state.assets];
		if (items.length === 0) out.push({ id: 'items', target, label: ITEMS_LABEL, tone: 'error', missing: true, short: 'none picked', message: send ? 'The bids hold no shot or asset. Add rows to a bid.' : 'Pick at least one shot or asset.' });
		else if (items.every((item) => item.omitted)) {
			out.push({ id: 'items', target, label: ITEMS_LABEL, tone: 'error', missing: false, short: 'every one is omitted', message: send ? 'Every row of the bids is omitted. Bring one back in its bid.' : 'Every picked item is omitted. Bring one back.' });
		}
	}
	if (send) {
		const twice = send.overlaps[0];
		if (twice) {
			const more = send.overlaps.length > 1 ? ` And ${send.overlaps.length - 1} more.` : '';
			out.push({ id: 'overlaps', target: 'bids', label: BIDS_LABEL, tone: 'error', missing: false, short: `${twice.code} is in two bids`, message: `${twice.code} is in ${twice.bids[0]} and in ${twice.bids[1]}. A request takes each row once.${more}` });
		}
		if (send.vendors.length === 0) out.push({ id: 'vendors', target: 'vendors', label: VENDORS_LABEL, tone: 'error', missing: true, short: 'none added', message: 'Add a vendor to send the request to.' });
		const none = send.vendors.find((v) => v.bids === 0);
		if (none) out.push({ id: 'vendor-bids', target: 'vendors', label: VENDORS_LABEL, tone: 'error', missing: false, short: `${none.name} has no bid`, message: `${none.name} is invited to no bid of the request. Pick its bids.` });
	}
	return out;
}

const BIDS_LABEL = 'Bids';
const VENDORS_LABEL = 'Vendors';

const stateOf = (p: Problem): ChecklistLine['state'] => (p.missing ? 'todo' : p.tone);

const CHECKED: readonly (keyof HeaderForm)[] = ['title', 'code', 'round', 'baseCurrency'];

export function readiness(input: ReadinessInput): Readiness {
	const problems = problemsAt(input, 'draft');
	const toIssue = problemsAt(input, 'issue').filter((p) => p.tone === 'error');
	const { state } = input;
	const byTarget = new Map(problems.map((p) => [p.target, p]));
	const line = (key: Target, label: string, detail: string): ChecklistLine => {
		const p = byTarget.get(key);
		return p ? { key, label, state: stateOf(p), detail: p.short, target: key } : { key, label, state: 'done', detail, target: key };
	};
	const shots = state.shots.filter((s) => !s.omitted).length;
	const assets = state.assets.filter((a) => !a.omitted).length;
	const counted = [shots > 0 ? plural(shots, 'shot') : '', assets > 0 ? plural(assets, 'asset') : ''].filter(Boolean).join(', ');
	const send = input.send;
	const listed = new Set<string>(send ? ['bids', 'vendors', 'items', 'project'] : ['items', 'project']);
	const byId = new Map(problems.map((p) => [p.id, p]));
	const lineOf = (id: string, key: Target, label: string, detail: string): ChecklistLine => {
		const p = byId.get(id);
		return p ? { key: id, label, state: stateOf(p), detail: p.short, target: key } : { key: id, label, state: 'done', detail, target: key };
	};
	const checklist: ChecklistLine[] = [
		...CHECKED.map((field) => line(field, LABELS[field], state.form[field].trim())),
		...(send
			? [
					lineOf(send.bids.length === 0 ? 'bids' : byId.has('overlaps') ? 'overlaps' : 'items', 'bids', BIDS_LABEL, [plural(send.bids.length, 'bid'), counted].filter(Boolean).join(': ')),
					lineOf(byId.has('vendors') ? 'vendors' : 'vendor-bids', 'vendors', VENDORS_LABEL, plural(send.vendors.length, 'vendor'))
				]
			: [line('items', ITEMS_LABEL, counted)]),
		...problems
			.filter((p) => !listed.has(p.target) && !CHECKED.includes(p.target as keyof HeaderForm))
			.map((p): ChecklistLine => ({ key: p.id, label: p.label, state: stateOf(p), detail: p.short, target: p.target }))
	];
	return { problems, toIssue, canSave: state.project !== null, canIssue: toIssue.length === 0, checklist };
}

/** The id of the control a problem points at. Header fields are `f-<field>`. */
export function controlId(target: Target): string {
	return `f-${target}`;
}

/** The folded group that holds a field, so it is opened before the field is focused. Null when none does. */
export function foldOf(target: Target): keyof typeof OPTIONAL_GROUPS | null {
	for (const [group, fields] of Object.entries(OPTIONAL_GROUPS) as [keyof typeof OPTIONAL_GROUPS, readonly string[]][]) {
		if (fields.includes(target)) return group;
	}
	return null;
}
