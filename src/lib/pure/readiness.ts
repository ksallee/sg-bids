/**
 * How far a draft request is from going out, in words. Pure, no I/O.
 *
 * Every problem names its field and points at the control that fixes it: a summary never counts
 * without naming. Nothing but a project stops a save (`persist.savable` makes the code when it is
 * blank). The issue needs what `header.REQUIRED` names and one Shot or Asset still in. A due date
 * in the past is a warning while the draft is worked on and an error at issue.
 */

import { OPTIONAL_GROUPS, checkHeader, LABELS, type FieldProblem, type HeaderForm, type Stage } from './header';
import type { Day, Id } from './model';
import type { BuilderState } from './request';

/** What a problem points at: a header field, the project, or the picked Shots and Assets. */
export type Target = keyof HeaderForm | 'project' | 'items';

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

export interface ReadinessInput {
	readonly state: BuilderState;
	readonly today: Day;
	readonly others?: readonly OtherRequest[];
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

	const items = [...state.shots, ...state.assets];
	if (items.length === 0) out.push({ id: 'items', target: 'items', label: ITEMS_LABEL, tone: 'error', missing: true, short: 'none picked', message: 'Pick at least one shot or asset.' });
	else if (items.every((item) => item.omitted)) {
		out.push({ id: 'items', target: 'items', label: ITEMS_LABEL, tone: 'error', missing: false, short: 'every one is omitted', message: 'Every picked item is omitted. Bring one back.' });
	}
	return out;
}

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
	const checklist: ChecklistLine[] = [
		...CHECKED.map((field) => line(field, LABELS[field], state.form[field].trim())),
		line('items', ITEMS_LABEL, counted),
		...problems
			.filter((p) => p.target !== 'items' && p.target !== 'project' && !CHECKED.includes(p.target as keyof HeaderForm))
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
