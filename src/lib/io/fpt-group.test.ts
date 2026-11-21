import { describe, expect, it } from 'vitest';
import type { EntityRow, RestClient } from 'sg-widgets-core';
import { createGroup, findGroups, readGroupRight } from './fpt-group';
import type { FptApi, RawAnswer } from './fpt-api';

/** A bearer whose middle segment carries the `user` claim, as the site's does (027). */
function bearer(user: { type: string; id: number }): string {
	const b64 = btoa(JSON.stringify({ user })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
	return `h.${b64}.s`;
}

function fake(answers: Record<string, RawAnswer>, groups: EntityRow[] = []): FptApi & { calls: string[]; searches: unknown[] } {
	const calls: string[] = [];
	const searches: unknown[] = [];
	const client = {
		async search(type: string, query: unknown) {
			calls.push(`search ${type}`);
			searches.push(query);
			return { data: groups, hasMore: false };
		}
	} as unknown as RestClient;
	return {
		calls,
		searches,
		client,
		async raw(method, path, body) {
			calls.push(`${method} ${path}${body === undefined ? '' : ` ${JSON.stringify(body)}`}`);
			return answers[`${method} ${path}`] ?? { status: 404, body: null };
		}
	};
}

const group = (id: number, code: string) => ({ type: 'Group', id, attributes: { code }, relationships: {} }) as unknown as EntityRow;

describe('readGroupRight', () => {
	it('reads the person’s rule set, its code, then the rights on Group (recipe 030)', async () => {
		const api = fake({
			'GET /entity/human_users/88?fields=permission_rule_set': {
				status: 200,
				body: { data: { type: 'HumanUser', id: 88, relationships: { permission_rule_set: { data: { type: 'PermissionRuleSet', id: 9, name: 'Manager' } } } } }
			},
			'GET /entity/permission_rule_sets/9?fields=code': { status: 200, body: { data: { type: 'PermissionRuleSet', id: 9, attributes: { code: 'manager' } } } },
			'GET /schema/permission_groups/manager/entity_types/Group': { status: 200, body: { data: { actions: { create: { access: 'allowed' } } } } }
		});
		expect(await readGroupRight(api, bearer({ type: 'HumanUser', id: 88 }))).toEqual({ state: 'yes', reason: 'Your permission group, manager, may create Groups.' });
		expect(api.calls).toEqual([
			'GET /entity/human_users/88?fields=permission_rule_set',
			'GET /entity/permission_rule_sets/9?fields=code',
			'GET /schema/permission_groups/manager/entity_types/Group'
		]);
	});

	it('is no when a read fails, and stops there', async () => {
		const api = fake({});
		expect((await readGroupRight(api, bearer({ type: 'HumanUser', id: 88 }))).state).toBe('no');
		expect(api.calls).toEqual(['GET /entity/human_users/88?fields=permission_rule_set']);
	});

	it('needs no read for the script key', async () => {
		const api = fake({});
		expect((await readGroupRight(api, bearer({ type: 'ApiUser', id: 7 }))).state).toBe('yes');
		expect(api.calls).toEqual([]);
	});
});

describe('findGroups', () => {
	it('searches Groups by code', async () => {
		const api = fake({}, [group(41, 'Studio North')]);
		expect(await findGroups(api, 'Studio North')).toEqual([{ id: 41, name: 'Studio North' }]);
		expect(api.searches[0]).toMatchObject({ filters: { logical_operator: 'and', conditions: [['code', 'is', 'Studio North']] }, fields: ['code'] });
	});
});

describe('createGroup', () => {
	it('looks for the name, creates the Group with its code alone, and reads it back', async () => {
		const api = fake({
			'POST /entity/groups': { status: 201, body: { data: { type: 'Group', id: 501, attributes: { code: 'Studio North' } } } },
			'GET /entity/groups/501?fields=code,users': { status: 200, body: { data: { type: 'Group', id: 501, attributes: { code: 'Studio North' }, relationships: { users: { data: [] } } } } }
		});
		expect(await createGroup(api, 'Studio North')).toEqual({ state: 'created', group: { id: 501, name: 'Studio North' } });
		expect(api.calls).toEqual(['search Group', 'POST /entity/groups {"code":"Studio North"}', 'GET /entity/groups/501?fields=code,users']);
	});

	it('sends nothing when a Group holds the name', async () => {
		const api = fake({}, [group(41, 'Studio North')]);
		expect(await createGroup(api, 'Studio North')).toEqual({ state: 'exists', name: 'Studio North', matches: [{ id: 41, name: 'Studio North' }] });
		expect(api.calls).toEqual(['search Group']);
	});

	it('answers a refusal, and reads nothing back', async () => {
		const api = fake({ 'POST /entity/groups': { status: 400, body: { errors: [{ status: 400, code: 104, title: 'Entity of type Group cannot be created by this user.' }] } } });
		expect((await createGroup(api, 'Studio North')).state).toBe('refused');
		expect(api.calls).toHaveLength(2);
	});
});
