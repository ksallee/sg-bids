/**
 * The builder's steps and where each one stands. Pure, no I/O. As sg-task-templates' flow: the
 * current step is ringed, a done step is checked and still a link, a blocked step says why.
 */

export type StepKey = 'project' | 'details' | 'fields' | 'shots' | 'assets' | 'items' | 'review';

export const STEPS: ReadonlyArray<{ key: StepKey; label: string }> = [
	{ key: 'project', label: 'Project' },
	{ key: 'details', label: 'Details' },
	{ key: 'fields', label: 'Fields' },
	{ key: 'shots', label: 'Shots' },
	{ key: 'assets', label: 'Assets' },
	{ key: 'items', label: 'Items' },
	{ key: 'review', label: 'Review' }
];

export interface StepFacts {
	readonly project: boolean;
	/** The header passes its checks. */
	readonly details: boolean;
	/** The mapping is read for this project. */
	readonly mapping: boolean;
	readonly shots: number;
	readonly assets: number;
}

export type StepState = { state: 'current' | 'done' | 'open' } | { state: 'blocked'; reason: string };

const KEYS = STEPS.map((s) => s.key);

/** The step in the URL, or where to open. Nothing past the project opens before one is picked. */
export function parseStep(value: string | null, hasProject: boolean): StepKey {
	if (!hasProject) return 'project';
	return KEYS.includes(value as StepKey) ? (value as StepKey) : 'details';
}

function done(key: StepKey, facts: StepFacts): boolean {
	switch (key) {
		case 'project':
			return facts.project;
		case 'details':
			return facts.details;
		case 'fields':
			return facts.mapping;
		case 'shots':
			return facts.shots > 0;
		case 'assets':
			return facts.assets > 0;
		case 'items':
			return facts.shots + facts.assets > 0;
		case 'review':
			return false;
	}
}

export function stepStates(current: StepKey, facts: StepFacts): Record<StepKey, StepState> {
	return Object.fromEntries(
		KEYS.map((key): [StepKey, StepState] => {
			if (key === current) return [key, { state: 'current' }];
			if (key !== 'project' && !facts.project) return [key, { state: 'blocked', reason: 'Pick a project first.' }];
			return [key, { state: done(key, facts) ? 'done' : 'open' }];
		})
	) as Record<StepKey, StepState>;
}

export function neighbours(key: StepKey): { back: StepKey | null; next: StepKey | null } {
	const i = KEYS.indexOf(key);
	return { back: KEYS[i - 1] ?? null, next: KEYS[i + 1] ?? null };
}
