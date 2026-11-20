import { describe, expect, it } from 'vitest';
import { normalizeFields } from 'sg-widgets-core';
import { SHOT_FIELDS_A } from './fixtures/schema';
import { answerWords, createAnswer, createDraft, createRight, planCreate } from './field-create';

const shot = normalizeFields(SHOT_FIELDS_A);
const TIERS = ['Simple', 'Moderate', 'Complex', 'Hero'];

describe('createDraft', () => {
	it('offers the slot’s display name and values', () => {
		expect(createDraft('shot', 'difficulty')).toEqual({ display: 'Difficulty', values: TIERS });
		expect(createDraft('asset', 'type')).toEqual({ display: 'Asset Type', values: [] });
		expect(createDraft('shot', 'frames')).toEqual({ display: 'Frame Count', values: [] });
	});

	it('offers nothing for a link', () => {
		expect(createDraft('shot', 'sequence')).toBeNull();
		expect(createDraft('shot', 'assets')).toBeNull();
	});
});

describe('planCreate', () => {
	it('plans a list field on Shot with its values, and predicts its API name (117)', () => {
		const plan = planCreate('shot', 'difficulty', { display: 'Difficulty', values: TIERS }, shot);
		expect(plan).toEqual({
			ok: true,
			kind: 'shot',
			slot: 'difficulty',
			entityType: 'Shot',
			name: 'sg_difficulty',
			display: 'Difficulty',
			dataType: 'list',
			values: TIERS,
			body: {
				data_type: 'list',
				properties: [
					{ property_name: 'name', value: 'Difficulty' },
					{ property_name: 'description', value: 'Added by sg-bids for bid requests. How hard the work is.' },
					{ property_name: 'valid_values', value: TIERS }
				]
			}
		});
	});

	it('trims the name, drops blank and repeated values, keeps their order', () => {
		const plan = planCreate('shot', 'difficulty', { display: '  Shot Tier ', values: [' Easy', '', 'Hard', 'Easy', 'Hard '] }, shot);
		expect(plan.ok && [plan.display, plan.name, plan.values]).toEqual(['Shot Tier', 'sg_shot_tier', ['Easy', 'Hard']]);
	});

	it('sends no values for a text or a number field', () => {
		const plan = planCreate('shot', 'frames', { display: 'Frame Count', values: ['x'] }, shot);
		expect(plan.ok && plan.body).toEqual({
			data_type: 'number',
			properties: [
				{ property_name: 'name', value: 'Frame Count' },
				{ property_name: 'description', value: 'Added by sg-bids for bid requests. The cut length in frames.' }
			]
		});
	});

	it('names every problem with the field it is on', () => {
		expect(planCreate('shot', 'difficulty', { display: ' ', values: [] }, shot)).toEqual({
			ok: false,
			problems: [
				{ field: 'display', message: 'Give the field a name.' },
				{ field: 'values', message: 'Give the list at least one value.' }
			]
		});
	});

	it('refuses a name with a character outside plain ASCII: Flow PT would name it sg_list (117)', () => {
		const plan = planCreate('shot', 'difficulty', { display: 'Difficulté', values: TIERS }, shot);
		expect(plan).toEqual({ ok: false, problems: [{ field: 'display', message: 'Use plain letters, digits and spaces. With any other character Flow PT names the field sg_list.' }] });
	});

	it('refuses a name the site already holds: a second create would make sg_cut_duration_1 (019)', () => {
		const plan = planCreate('shot', 'frames', { display: 'Cut Duration', values: [] }, shot);
		expect(plan).toEqual({
			ok: false,
			problems: [{ field: 'display', message: 'Shot already has sg_cut_duration, shown as Cut Duration. Map that one, or pick another name.' }]
		});
	});

	it('refuses a name another field already shows', () => {
		const plan = planCreate('shot', 'description', { display: 'thumbnail', values: [] }, shot);
		expect(plan).toEqual({ ok: false, problems: [{ field: 'display', message: 'Shot already has a field shown as Thumbnail (image). Pick another name.' }] });
	});

	it('refuses a link slot', () => {
		expect(planCreate('shot', 'sequence', { display: 'Seq', values: [] }, shot)).toEqual({
			ok: false,
			problems: [{ field: 'display', message: 'A link field cannot be created here. It also adds a field to the type it links. Ask an admin.' }]
		});
	});
});

describe('createAnswer', () => {
	const self = (name: string) => ({ data: {}, links: { self: `/api/v1/schema/Shot/fields/${name}` } });

	it('reads the name from links.self (019)', () => {
		expect(createAnswer(201, self('sg_difficulty'), 'sg_difficulty')).toEqual({ state: 'created', name: 'sg_difficulty' });
	});

	it('reports a 201 under another name, never hides it (117)', () => {
		expect(createAnswer(201, self('sg_difficulty_1'), 'sg_difficulty')).toEqual({ state: 'renamed', name: 'sg_difficulty_1', expected: 'sg_difficulty' });
	});

	it('reads a retired name from the 400 code 105 (119)', () => {
		const body = {
			errors: [
				{
					status: 400,
					code: 105,
					title: 'API schema_field_create() failed, there is a retired field with the same field_name: sg_difficulty. Delete the retired field forever from the Trash Page in Shotgun and try again.',
					source: { field_name: 'there is a retired field with the same field_name: sg_difficulty' }
				}
			]
		};
		expect(createAnswer(400, body, 'sg_difficulty')).toEqual({ state: 'retired', name: 'sg_difficulty' });
	});

	it('reads a refusal of the right to create fields, a 500 code 105 (132)', () => {
		const body = { errors: [{ status: 500, code: 105, title: "API schema_field_create() RuntimeError: User doesn't have permission to create a Field" }] };
		expect(createAnswer(500, body, 'sg_difficulty')).toEqual({ state: 'refused' });
	});

	it('keeps anything else as a failure with its title', () => {
		expect(createAnswer(400, { errors: [{ title: 'Request Parameters invalid.' }] }, 'sg_x')).toEqual({ state: 'failed', status: 400, title: 'Request Parameters invalid.' });
		expect(createAnswer(502, null, 'sg_x')).toEqual({ state: 'failed', status: 502, title: 'HTTP 502' });
	});
});

describe('createRight', () => {
	it('knows the script key and an Admin may create fields (019, 132)', () => {
		expect(createRight({ type: 'ApiUser', id: 1 }, null).state).toBe('yes');
		expect(createRight({ type: 'HumanUser', id: 2 }, 'admin').state).toBe('yes');
	});

	it('knows an Artist may not (132)', () => {
		expect(createRight({ type: 'HumanUser', id: 2 }, 'artist')).toEqual({ state: 'no', reason: 'Your permission group, artist, may not create fields in Flow PT. Ask an admin.' });
	});

	it('does not guess for any other group: only Admin was measured', () => {
		expect(createRight({ type: 'HumanUser', id: 2 }, 'manager')).toEqual({
			state: 'unknown',
			reason: 'Only admins are known to have this right. Flow PT may refuse. Then nothing is created.'
		});
		expect(createRight(null, null).state).toBe('unknown');
	});
});

describe('answerWords', () => {
	it('says what happened and what to do next', () => {
		expect(answerWords({ state: 'created', name: 'sg_difficulty' }, 'Shot')).toBe('Created sg_difficulty on Shot. It is mapped.');
		expect(answerWords({ state: 'renamed', name: 'sg_difficulty_1', expected: 'sg_difficulty' }, 'Shot')).toBe(
			'Flow PT named it sg_difficulty_1, not sg_difficulty. It is mapped as sg_difficulty_1.'
		);
		expect(answerWords({ state: 'exists', name: 'sg_difficulty' }, 'Shot')).toBe('Shot has sg_difficulty now. Nothing was created. Map it from the list.');
		expect(answerWords({ state: 'retired', name: 'sg_difficulty' }, 'Shot')).toBe(
			'A retired field holds the name sg_difficulty. Pick another name, or empty the field trash in Flow PT: open the admin menu, then Trash, then Fields.'
		);
		expect(answerWords({ state: 'refused' }, 'Shot')).toBe('Flow PT refused: you may not create fields. Ask an admin, or set it per item in the request.');
		expect(answerWords({ state: 'failed', status: 500, title: 'Boom' }, 'Shot')).toBe('Flow PT answered 500: Boom. A 500 can be a refusal of the right to create fields.');
		expect(answerWords({ state: 'failed', status: 400, title: 'Bad' }, 'Shot')).toBe('Flow PT answered 400: Bad.');
	});
});
