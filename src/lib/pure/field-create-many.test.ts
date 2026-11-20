import { describe, expect, it } from 'vitest';
import { normalizeFields } from 'sg-widgets-core';
import { ASSET_FIELDS_A, SHOT_FIELDS_A } from './fixtures/schema';
import type { Mapping } from './field-map';
import { manySummary, missingConcepts, nextAfter, outcomeOf, planMany, startRows, type ManyRow } from './field-create-many';

const schemas = { shot: normalizeFields(SHOT_FIELDS_A), asset: normalizeFields(ASSET_FIELDS_A) };
const TIERS = ['Simple', 'Moderate', 'Complex', 'Hero'];

/** Site A, mapped as the defaults map it: no Shot type, no difficulty anywhere, no episode. */
const mapping: { shot: Mapping; asset: Mapping } = {
	shot: { description: 'description', frames: 'sg_cut_duration', sequence: 'sg_sequence', episode: null, type: null, difficulty: null, assets: 'assets' },
	asset: { description: 'description', type: 'sg_asset_type', difficulty: null }
};

describe('missingConcepts', () => {
	it('lists every unmapped concept, Shot then Asset, the creatable ones with what the dialog opens with', () => {
		const missing = missingConcepts(mapping);
		expect(missing.map((m) => `${m.kind}:${m.slot}`)).toEqual(['shot:episode', 'shot:type', 'shot:difficulty', 'asset:difficulty']);
		expect(missing.find((m) => m.slot === 'difficulty' && m.kind === 'shot')).toMatchObject({
			entityType: 'Shot',
			label: 'Difficulty',
			creatable: true,
			dataType: 'list',
			draft: { display: 'Difficulty', values: TIERS }
		});
	});

	it('names a link as not creatable here, with why: it adds a field to the type it links (142)', () => {
		const episode = missingConcepts(mapping).find((m) => m.slot === 'episode')!;
		expect(episode.creatable).toBe(false);
		expect(episode.reason).toMatch(/Episode/);
		expect(episode.dataType).toBeNull();
	});

	it('lists nothing when every concept has a field', () => {
		const full = { shot: { ...mapping.shot, episode: 'sg_episode', type: 'sg_shot_type', difficulty: 'sg_difficulty' }, asset: { ...mapping.asset, difficulty: 'sg_difficulty' } };
		expect(missingConcepts(full)).toEqual([]);
	});
});

describe('startRows', () => {
	it('ticks every creatable concept, with its display name and values; a link gets no row', () => {
		expect(startRows(missingConcepts(mapping))).toEqual([
			{ kind: 'shot', slot: 'type', checked: true, display: 'Shot Type', values: '' },
			{ kind: 'shot', slot: 'difficulty', checked: true, display: 'Difficulty', values: TIERS.join('\n') },
			{ kind: 'asset', slot: 'difficulty', checked: true, display: 'Difficulty', values: TIERS.join('\n') }
		]);
	});
});

describe('planMany', () => {
	const rows = (): ManyRow[] => startRows(missingConcepts(mapping));

	it('plans the ticked rows in order, each as the single create would', () => {
		const ready = rows().map((r) => (r.slot === 'type' ? { ...r, values: '2D\n3D' } : r));
		const plan = planMany(ready, schemas);
		expect(plan.ready).toBe(true);
		expect(plan.creates.map((c) => `${c.entityType}.${c.name}`)).toEqual(['Shot.sg_shot_type', 'Shot.sg_difficulty', 'Asset.sg_difficulty']);
		expect(plan.creates[0].values).toEqual(['2D', '3D']);
	});

	it('leaves an unticked row out and holds none of its problems against the confirm', () => {
		const plan = planMany(rows().map((r) => (r.slot === 'type' ? { ...r, checked: false } : r)), schemas);
		expect(plan.ready).toBe(true);
		expect(plan.creates.map((c) => c.slot)).toEqual(['difficulty', 'difficulty']);
		expect(plan.problems).toEqual({});
	});

	it('holds each row’s own problems on that row: a list with no value, a name the type holds', () => {
		const plan = planMany(
			rows().map((r) => (r.kind === 'asset' ? { ...r, display: 'Description' } : r)),
			schemas
		);
		expect(plan.ready).toBe(false);
		expect(plan.problems['shot:type']).toEqual([{ field: 'values', message: 'Give the list at least one value.' }]);
		expect(plan.problems['asset:difficulty']?.[0].message).toMatch(/already has a field shown as Description/);
	});

	it('refuses two ticked rows that would make the same field on one type', () => {
		const two = rows().map((r) => (r.kind === 'shot' ? { ...r, display: 'Grade', values: 'A' } : r));
		const plan = planMany(two, schemas);
		expect(plan.ready).toBe(false);
		expect(plan.problems['shot:type']?.[0].message).toBe('Two fields here would be named sg_grade. Change one of the names.');
		expect(plan.problems['shot:difficulty']?.[0].message).toBe('Two fields here would be named sg_grade. Change one of the names.');
		expect(plan.problems['asset:difficulty']).toBeUndefined();
	});

	it('is not ready with nothing ticked', () => {
		const plan = planMany(rows().map((r) => ({ ...r, checked: false })), schemas);
		expect(plan.ready).toBe(false);
		expect(plan.creates).toEqual([]);
	});
});

describe('outcomeOf and nextAfter', () => {
	it('reads each answer as created, name taken, refused or failed', () => {
		expect(outcomeOf({ state: 'created', name: 'sg_difficulty' })).toEqual({ state: 'created', name: 'sg_difficulty', words: 'Created sg_difficulty and mapped it.' });
		expect(outcomeOf({ state: 'renamed', name: 'sg_difficulty_1', expected: 'sg_difficulty' })).toMatchObject({ state: 'created', name: 'sg_difficulty_1' });
		expect(outcomeOf({ state: 'exists', name: 'sg_difficulty' })).toMatchObject({ state: 'taken' });
		expect(outcomeOf({ state: 'retired', name: 'sg_difficulty' })).toMatchObject({ state: 'taken' });
		expect(outcomeOf({ state: 'refused' })).toMatchObject({ state: 'refused' });
		expect(outcomeOf({ state: 'failed', status: 503, title: 'Busy' })).toMatchObject({ state: 'failed', words: 'Flow PT answered 503: Busy.' });
	});

	it('stops after a refusal: the right is missing, so every next create would be refused too (132)', () => {
		expect(nextAfter({ state: 'refused' })).toBe('stop');
		for (const answer of [{ state: 'created', name: 'x' }, { state: 'exists', name: 'x' }, { state: 'failed', status: 500, title: 'x' }] as const) {
			expect(nextAfter(answer)).toBe('go');
		}
	});
});

describe('manySummary', () => {
	it('says in one line what happened to each', () => {
		expect(manySummary(['created', 'created', 'taken', 'skipped'])).toBe('2 created and mapped. 1 name taken. 1 not tried.');
		expect(manySummary(['refused', 'skipped', 'skipped'])).toBe('1 refused. 2 not tried.');
		expect(manySummary(['created'])).toBe('1 created and mapped.');
		expect(manySummary(['failed'])).toBe('1 failed.');
	});
});
