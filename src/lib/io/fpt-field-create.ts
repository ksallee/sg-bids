/**
 * The calls behind creating a Shot or Asset field from the mapping, as the signed-in person. The
 * decisions are in `src/lib/pure/field-create.ts`. One field per call; nothing here renames,
 * retires or revives a field.
 *
 * The right is read, not tried: no call answers "may I create a field" without creating one
 * (132). So the person's permission group is read with their own bearer, as the production check
 * reads it (`src/lib/server/production.ts`), and the pure rule says what that group is known to
 * be allowed.
 */
import { createAnswer, createRight, type CreateAnswer, type CreateRight, type PlannedCreate } from '../pure/field-create';
import { nextAfter } from '../pure/field-create-many';
import { bearerUser, groupsAnswer, ownGroupCode, ruleSetAnswer } from '../pure/fpt-session';
import { errorTitle, type FptApi } from './fpt-api';

/** Whether the person behind `bearer` may create a field. The script key needs no read. */
export async function readCreateRight(api: FptApi, bearer: string): Promise<CreateRight> {
	const user = bearerUser(bearer);
	if (!user || user.type !== 'HumanUser') return createRight(user, null);
	const [groups, own] = await Promise.all([
		api.raw('GET', '/schema/permission_groups?permission_rule_set_entity_type=HumanUser'),
		api.raw('GET', `/entity/human_users/${user.id}?fields=permission_rule_set`)
	]);
	const listed = groupsAnswer(groups.status, groups.body);
	return createRight(user, listed ? ownGroupCode(listed, ruleSetAnswer(own.status, own.body, user.id)) : null);
}

/**
 * Create the planned field. The field is read again first: a live one of that name would make the
 * create a second field named `<name>_1`, at 201 (019). A 404 is a name never used or retired;
 * only the create tells them apart (119).
 */
export async function createField(api: FptApi, plan: PlannedCreate): Promise<CreateAnswer> {
	const now = await api.raw('GET', `/schema/${plan.entityType}/fields/${plan.name}`);
	if (now.status === 200) return { state: 'exists', name: plan.name };
	if (now.status !== 404) return { state: 'failed', status: now.status, title: errorTitle(now) };
	const answer = await api.raw('POST', `/schema/${plan.entityType}/fields`, plan.body);
	return createAnswer(answer.status, answer.body, plan.name);
}

/**
 * Create the planned fields in order, one at a time, each as `createField` does. A refusal stops
 * the run (`nextAfter`): the answers stop there, and the rest were not tried.
 */
export async function createMany(api: FptApi, plans: readonly PlannedCreate[], onEach?: (index: number, answer: CreateAnswer) => void): Promise<CreateAnswer[]> {
	const answers: CreateAnswer[] = [];
	for (const [index, plan] of plans.entries()) {
		const answer = await createField(api, plan);
		answers.push(answer);
		onEach?.(index, answer);
		if (nextAfter(answer) === 'stop') break;
	}
	return answers;
}
