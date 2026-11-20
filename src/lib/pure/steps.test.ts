import { describe, expect, it } from 'vitest';
import { STEPS, neighbours, parseStep, stepStates, type StepFacts } from './steps';

const none: StepFacts = { project: false, details: false, mapping: false, shots: 0, assets: 0 };
const ready: StepFacts = { project: true, details: true, mapping: true, shots: 3, assets: 1 };

describe('STEPS', () => {
	it('runs project, details, fields, shots, assets, items, review', () => {
		expect(STEPS.map((s) => s.key)).toEqual(['project', 'details', 'fields', 'shots', 'assets', 'items', 'review']);
	});
});

describe('parseStep', () => {
	it('reads a known step', () => {
		expect(parseStep('shots', true)).toBe('shots');
	});
	it('opens on the project with none picked, else on the details', () => {
		expect(parseStep(null, false)).toBe('project');
		expect(parseStep('nope', true)).toBe('details');
	});
	it('sends every step back to the project while none is picked', () => {
		expect(parseStep('review', false)).toBe('project');
	});
});

describe('stepStates', () => {
	it('blocks every step after the project until one is picked', () => {
		const states = stepStates('project', none);
		expect(states.project).toEqual({ state: 'current' });
		expect(states.details).toEqual({ state: 'blocked', reason: 'Pick a project first.' });
		expect(states.review.state).toBe('blocked');
	});

	it('marks what is done', () => {
		const states = stepStates('items', ready);
		expect(states.project.state).toBe('done');
		expect(states.details.state).toBe('done');
		expect(states.fields.state).toBe('done');
		expect(states.shots.state).toBe('done');
		expect(states.assets.state).toBe('done');
		expect(states.items.state).toBe('current');
		expect(states.review.state).toBe('open');
	});

	it('leaves a step open when nothing is in it yet', () => {
		const states = stepStates('details', { ...ready, details: false, shots: 0, assets: 0 });
		expect(states.shots.state).toBe('open');
		expect(states.assets.state).toBe('open');
		expect(states.items.state).toBe('open');
	});
});

describe('neighbours', () => {
	it('names the step before and after', () => {
		expect(neighbours('project')).toEqual({ back: null, next: 'details' });
		expect(neighbours('assets')).toEqual({ back: 'shots', next: 'items' });
		expect(neighbours('review')).toEqual({ back: 'items', next: null });
	});
});
