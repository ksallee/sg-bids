/**
 * The calls behind creating a vendor's Group from its row, as the signed-in person. Thin: every
 * decision is in `src/lib/pure/group-create.ts`. Recipe 030 of `../sg-groundtruth/corpus`:
 *
 * - The right is read before the control shows: the person's `permission_rule_set`, its `code`,
 *   then the rights call on Group. The script key needs no read (168).
 * - The name is searched first: `code` is not unique, and a second Group of a live name is a 201.
 *   The search and the create are two calls, so two people creating one name at once can still make
 *   two Groups.
 * - The Group is created with its `code` alone: no member. It is read back by id, never trusted on
 *   its status (024, 028).
 */
import { bearerUser, ruleSetAnswer } from '../pure/fpt-session';
import { createAnswer, groupActions, groupMatches, groupRight, readBackAnswer, ruleSetCode, type GroupAnswer, type GroupRef, type GroupRight } from '../pure/group-create';
import type { FptApi } from './fpt-api';
import { searchAll } from './reads';

/** Whether the caller behind `bearer` may create a Group. */
export async function readGroupRight(api: FptApi, bearer: string): Promise<GroupRight> {
	const user = bearerUser(bearer);
	if (!user || user.type !== 'HumanUser') return groupRight(user, null, null);
	const own = await api.raw('GET', `/entity/human_users/${user.id}?fields=permission_rule_set`);
	const set = ruleSetAnswer(own.status, own.body, user.id);
	if (!set) return groupRight(user, null, null);
	const row = await api.raw('GET', `/entity/permission_rule_sets/${set.id}?fields=code`);
	const code = ruleSetCode(row.status, row.body, set.id);
	if (!code) return groupRight(user, null, null);
	const rights = await api.raw('GET', `/schema/permission_groups/${encodeURIComponent(code)}/entity_types/Group`);
	return groupRight(user, code, groupActions(rights.status, rights.body));
}

/** The live Groups of that name. Text filters ignore case, so another case comes back too. */
export async function findGroups(api: FptApi, name: string): Promise<GroupRef[]> {
	return groupMatches(await searchAll(api.client, 'Group', { logical_operator: 'and', conditions: [['code', 'is', name]] }, ['code']));
}

/** Create an empty Group of that name, unless a live one holds it. `name` is trimmed already. */
export async function createGroup(api: FptApi, name: string): Promise<GroupAnswer> {
	const matches = await findGroups(api, name);
	if (matches.length > 0) return { state: 'exists', name, matches };
	const made = await api.raw('POST', '/entity/groups', { code: name });
	const answer = createAnswer(made.status, made.body, name);
	if (answer.state !== 'created') return answer;
	const back = await api.raw('GET', `/entity/groups/${answer.group.id}?fields=code,users`);
	return readBackAnswer(back.status, back.body, answer.group.id, name);
}
