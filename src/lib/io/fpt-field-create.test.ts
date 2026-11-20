import { describe, expect, it } from 'vitest';
import type { RestClient } from 'sg-widgets-core';
import { createField, createMany, readCreateRight } from './fpt-field-create';
import type { FptApi, RawAnswer } from './fpt-api';
import type { PlannedCreate } from '../pure/field-create';

const PLAN: PlannedCreate = {
	ok: true,
	kind: 'shot',
	slot: 'difficulty',
	entityType: 'Shot',
	name: 'sg_difficulty',
	display: 'Difficulty',
	dataType: 'list',
	values: ['Simple', 'Hero'],
	body: { data_type: 'list', properties: [{ property_name: 'name', value: 'Difficulty' }] }
};

function fake(answers: Record<string, RawAnswer>): FptApi & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		client: {} as RestClient,
		async raw(method, path) {
			calls.push(`${method} ${path}`);
			return answers[`${method} ${path}`] ?? { status: 404, body: null };
		}
	};
}

/** A bearer whose middle segment carries the `user` claim, as the site's does (027). */
function bearer(user: { type: string; id: number }): string {
	const b64 = btoa(JSON.stringify({ user })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
	return `h.${b64}.s`;
}

describe('createField', () => {
	it('reads the field again, then creates it', async () => {
		const api = fake({ 'POST /schema/Shot/fields': { status: 201, body: { links: { self: '/api/v1/schema/Shot/fields/sg_difficulty' } } } });
		expect(await createField(api, PLAN)).toEqual({ state: 'created', name: 'sg_difficulty' });
		expect(api.calls).toEqual(['GET /schema/Shot/fields/sg_difficulty', 'POST /schema/Shot/fields']);
	});

	it('sends nothing when the field is live already: the create would make sg_difficulty_1 (019)', async () => {
		const api = fake({ 'GET /schema/Shot/fields/sg_difficulty': { status: 200, body: { data: {} } } });
		expect(await createField(api, PLAN)).toEqual({ state: 'exists', name: 'sg_difficulty' });
		expect(api.calls).toEqual(['GET /schema/Shot/fields/sg_difficulty']);
	});

	it('sends nothing when the read fails for another reason', async () => {
		const api = fake({ 'GET /schema/Shot/fields/sg_difficulty': { status: 503, body: { errors: [{ title: 'Busy' }] } } });
		expect(await createField(api, PLAN)).toEqual({ state: 'failed', status: 503, title: 'Busy' });
		expect(api.calls).toHaveLength(1);
	});
});

describe('readCreateRight', () => {
	it('needs no read for the script key', async () => {
		const api = fake({});
		expect((await readCreateRight(api, bearer({ type: 'ApiUser', id: 7 }))).state).toBe('yes');
		expect(api.calls).toEqual([]);
	});

	it("reads a person's group with their own bearer", async () => {
		const api = fake({
			'GET /schema/permission_groups?permission_rule_set_entity_type=HumanUser': { status: 200, body: { data: [{ id: 8, code: 'artist', display_name: 'Artist' }] } },
			'GET /entity/human_users/42?fields=permission_rule_set': {
				status: 200,
				body: { data: { type: 'HumanUser', id: 42, relationships: { permission_rule_set: { data: { type: 'PermissionRuleSet', id: 8, name: 'Artist' } } } } }
			}
		});
		expect((await readCreateRight(api, bearer({ type: 'HumanUser', id: 42 }))).state).toBe('no');
	});
});

describe('createMany', () => {
	const ASSET_PLAN: PlannedCreate = { ...PLAN, kind: 'asset', entityType: 'Asset' };
	const TYPE_PLAN: PlannedCreate = { ...PLAN, slot: 'type', name: 'sg_shot_type', display: 'Shot Type' };

	it('creates the planned fields one after the other, each read again first, and answers each in order', async () => {
		const api = fake({
			'POST /schema/Shot/fields': { status: 201, body: { links: { self: '/api/v1/schema/Shot/fields/sg_difficulty' } } },
			'POST /schema/Asset/fields': { status: 201, body: { links: { self: '/api/v1/schema/Asset/fields/sg_difficulty' } } }
		});
		const seen: string[] = [];
		const answers = await createMany(api, [PLAN, ASSET_PLAN], (i, answer) => seen.push(`${i}:${answer.state}`));
		expect(answers.map((a) => a.state)).toEqual(['created', 'created']);
		expect(seen).toEqual(['0:created', '1:created']);
		expect(api.calls).toEqual(['GET /schema/Shot/fields/sg_difficulty', 'POST /schema/Shot/fields', 'GET /schema/Asset/fields/sg_difficulty', 'POST /schema/Asset/fields']);
	});

	it('goes on past a taken name, and stops at a refusal: the rest are not tried (132)', async () => {
		const api = fake({
			'GET /schema/Shot/fields/sg_difficulty': { status: 200, body: { data: {} } },
			'POST /schema/Shot/fields': { status: 500, body: { errors: [{ code: 105, title: "User doesn't have permission to create a Field" }] } }
		});
		const answers = await createMany(api, [PLAN, TYPE_PLAN, ASSET_PLAN]);
		expect(answers.map((a) => a.state)).toEqual(['exists', 'refused']);
		expect(api.calls.some((c) => c.includes('/Asset/'))).toBe(false);
	});
});
