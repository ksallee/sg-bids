/**
 * Creating the missing Shot and Asset fields in one go, from the mapping: which concepts have no
 * field, the rows the dialog opens with, the plan for the ticked ones, and how each answer reads.
 * Each create is the single create of `field-create.ts`, with its checks and corpus facts; this
 * module adds what only a batch has: two rows that would make one field, the order, and stopping
 * once Flow PT refuses the right (132: a refusal is the person's group, so the next would be too).
 * Pure, no I/O: the calls are `createMany` in `src/lib/io/fpt-field-create.ts`.
 */

import type { FieldSchema } from 'sg-widgets-core';
import { createDraft, planCreate, type CreateAnswer, type CreateDraft, type CreateProblem, type PlannedCreate } from './field-create';
import { slotsFor, type ItemKind, type Mapping, type Slot } from './field-map';

export interface MissingConcept {
	readonly kind: ItemKind;
	readonly slot: Slot;
	readonly entityType: 'Shot' | 'Asset';
	readonly label: string;
	readonly line: string;
	readonly creatable: boolean;
	/** For a concept the app does not create: why. */
	readonly reason?: string;
	readonly dataType: 'text' | 'number' | 'list' | null;
	/** What its row opens with. Null for a link. */
	readonly draft: CreateDraft | null;
}

/** Every concept with no field, Shots then Assets, in the mapping's order. */
export function missingConcepts(mapping: { shot: Mapping; asset: Mapping }): MissingConcept[] {
	const out: MissingConcept[] = [];
	for (const kind of ['shot', 'asset'] as const) {
		for (const spec of slotsFor(kind)) {
			if (mapping[kind][spec.slot]) continue;
			const entityType = kind === 'shot' ? 'Shot' : 'Asset';
			out.push({
				kind,
				slot: spec.slot,
				entityType,
				label: spec.label,
				line: spec.line,
				creatable: spec.create !== undefined,
				...(spec.create ? {} : { reason: `A link field also adds a field to ${spec.linksTo}, so an admin adds it in Flow PT.` }),
				dataType: spec.create?.dataType ?? null,
				draft: createDraft(kind, spec.slot)
			});
		}
	}
	return out;
}

/** One row of the dialog, as typed. `values` is one per line. */
export interface ManyRow {
	readonly kind: ItemKind;
	readonly slot: Slot;
	readonly checked: boolean;
	readonly display: string;
	readonly values: string;
}

export const rowKey = (row: { kind: ItemKind; slot: Slot }) => `${row.kind}:${row.slot}`;

/** The rows the dialog opens with: every creatable concept, ticked. */
export function startRows(missing: readonly MissingConcept[]): ManyRow[] {
	return missing.flatMap((m) => (m.creatable && m.draft ? [{ kind: m.kind, slot: m.slot, checked: true, display: m.draft.display, values: m.draft.values.join('\n') }] : []));
}

export interface ManyPlan {
	/** The ticked rows' creates, in order. */
	readonly creates: readonly PlannedCreate[];
	/** Problems by row key, ticked rows only. */
	readonly problems: Readonly<Record<string, readonly CreateProblem[]>>;
	/** Something is ticked and nothing ticked has a problem. */
	readonly ready: boolean;
}

export function planMany(rows: readonly ManyRow[], schemas: { shot: Record<string, FieldSchema>; asset: Record<string, FieldSchema> }): ManyPlan {
	const problems: Record<string, CreateProblem[]> = {};
	const creates: PlannedCreate[] = [];
	for (const row of rows) {
		if (!row.checked) continue;
		const plan = planCreate(row.kind, row.slot, { display: row.display, values: row.values.split(/\r?\n/) }, schemas[row.kind]);
		if (plan.ok) creates.push(plan);
		else problems[rowKey(row)] = [...plan.problems];
	}
	const byName = new Map<string, PlannedCreate[]>();
	for (const c of creates) byName.set(`${c.entityType}.${c.name}`, [...(byName.get(`${c.entityType}.${c.name}`) ?? []), c]);
	for (const same of byName.values()) {
		if (same.length < 2) continue;
		for (const c of same) problems[rowKey(c)] = [{ field: 'display', message: `Two fields here would be named ${c.name}. Change one of the names.` }];
	}
	const clean = creates.filter((c) => !problems[rowKey(c)]);
	return { creates: clean, problems, ready: clean.length > 0 && Object.keys(problems).length === 0 };
}

export type ManyState = 'created' | 'taken' | 'refused' | 'failed' | 'skipped';

export interface ManyOutcome {
	readonly state: Exclude<ManyState, 'skipped'>;
	/** The field's name on the site, for a created one. */
	readonly name?: string;
	readonly words: string;
}

/** What one answer means for its row. */
export function outcomeOf(answer: CreateAnswer): ManyOutcome {
	switch (answer.state) {
		case 'created':
			return { state: 'created', name: answer.name, words: `Created ${answer.name} and mapped it.` };
		case 'renamed':
			return { state: 'created', name: answer.name, words: `Flow PT named it ${answer.name}, not ${answer.expected}. Mapped as ${answer.name}.` };
		case 'exists':
			return { state: 'taken', words: `The site has ${answer.name} now. Nothing was created. Map it from the list.` };
		case 'retired':
			return { state: 'taken', words: `A retired field holds ${answer.name}. Pick another name, or empty the field trash in Flow PT.` };
		case 'refused':
			return { state: 'refused', words: 'Flow PT refused: you may not create fields. Ask an admin.' };
		case 'failed':
			return { state: 'failed', words: `Flow PT answered ${answer.status}: ${answer.title.replace(/\.$/, '')}.` };
	}
}

/** Whether to send the next create after this answer. */
export function nextAfter(answer: CreateAnswer): 'go' | 'stop' {
	return answer.state === 'refused' ? 'stop' : 'go';
}

const WORDS: Record<ManyState, string> = { created: 'created and mapped', taken: 'name taken', refused: 'refused', failed: 'failed', skipped: 'not tried' };

/** One line: how many of each, in this order. */
export function manySummary(states: readonly ManyState[]): string {
	return (['created', 'taken', 'refused', 'failed', 'skipped'] as const)
		.map((s) => [s, states.filter((x) => x === s).length] as const)
		.filter(([, n]) => n > 0)
		.map(([s, n]) => `${n} ${WORDS[s]}.`)
		.join(' ');
}
