/**
 * Creating a vendor's Flow PT Group from its row: who may, the name, a Group of the same name, and
 * what the site answered. Pure, no I/O: the calls are in `src/lib/io/fpt-group.ts`. Facts from
 * `../sg-groundtruth/corpus`, finding 168 and recipe 030:
 *
 * - Whether a person may create a Group is their permission group's rule on Group. Read it before
 *   showing the control: the person's own `permission_rule_set`, that rule set's `code`, then
 *   `actions.create.access` from `GET /schema/permission_groups/<code>/entity_types/Group`. An Admin
 *   lists every group, so the listing alone does not name theirs. On the probed site Manager and
 *   Admin are `allowed`, Artist and Vendor `denied`.
 * - The script key creates Groups (168, probe 150).
 * - A refusal is 400 code 104, `Entity of type Group cannot be created by this user.`, with no
 *   `source` or `detail`.
 * - `code` is neither required nor unique: a second Group of a live Group's code is a 201. So the
 *   name is searched first, and a live match is offered instead. Text filters ignore case.
 * - The Group is made with a `code` alone, so it is empty. Adding people stays in Flow PT.
 */

import type { EntityRow } from 'sg-widgets-core';
import type { FptUser } from './fpt-session';

export type GroupRight = { readonly state: 'yes' | 'no'; readonly reason: string };

export interface GroupRef {
	readonly id: number;
	readonly name: string;
}

export type GroupAnswer =
	| { readonly state: 'created'; readonly group: GroupRef }
	/** A live Group holds the name, found just before the create: none was sent. */
	| { readonly state: 'exists'; readonly name: string; readonly matches: readonly GroupRef[] }
	| { readonly state: 'refused'; readonly title: string }
	| { readonly state: 'failed'; readonly status: number; readonly title: string }
	/** The create answered 201, and the Group did not read back as sent. */
	| { readonly state: 'unconfirmed'; readonly id: number; readonly name: string };

type Data = { type?: unknown; id?: unknown; attributes?: Record<string, unknown> } | null | undefined;

function dataOf(body: unknown): Data {
	return (body as { data?: Data } | null)?.data;
}

function firstError(body: unknown): { code?: unknown; title?: unknown } | undefined {
	const errors = (body as { errors?: unknown } | null)?.errors;
	return Array.isArray(errors) ? (errors[0] as { code?: unknown; title?: unknown } | undefined) : undefined;
}

/** The `code` off `GET /entity/permission_rule_sets/<id>?fields=code`, or null. */
export function ruleSetCode(status: number, body: unknown, setId: number): string | null {
	if (status !== 200) return null;
	const data = dataOf(body);
	const code = data?.attributes?.code;
	return data?.type === 'PermissionRuleSet' && data.id === setId && typeof code === 'string' && code !== '' ? code : null;
}

/** Each action's access off the rights call on Group, or null when it answered none. */
export function groupActions(status: number, body: unknown): Record<string, string> | null {
	if (status !== 200) return null;
	const actions = (dataOf(body) as { actions?: unknown } | null | undefined)?.actions;
	if (!actions || typeof actions !== 'object') return null;
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(actions as Record<string, { access?: unknown } | null>)) {
		if (typeof value?.access === 'string') out[name] = value.access;
	}
	return Object.keys(out).length > 0 ? out : null;
}

/** Whether the signed-in caller may create a Group. Anything the reads did not settle is no. */
export function groupRight(user: FptUser | null, code: string | null, actions: Readonly<Record<string, string>> | null): GroupRight {
	if (user?.type === 'ApiUser') return { state: 'yes', reason: 'The script key may create Groups.' };
	if (user?.type !== 'HumanUser') return { state: 'no', reason: 'The session names no person.' };
	if (code === null || actions === null) return { state: 'no', reason: 'Your rights on Group could not be read.' };
	if (actions.create === 'allowed') return { state: 'yes', reason: `Your permission group, ${code}, may create Groups.` };
	return { state: 'no', reason: `Your permission group, ${code}, may not create Groups in Flow PT.` };
}

/** The name as sent: trimmed. A blank one is a problem. */
export function groupName(text: string): { readonly ok: true; readonly name: string } | { readonly ok: false; readonly problem: string } {
	const name = text.trim();
	return name === '' ? { ok: false, problem: 'Give the Group a name.' } : { ok: true, name };
}

/** The live Groups a search by name found. */
export function groupMatches(rows: readonly EntityRow[]): GroupRef[] {
	return rows.map((row) => {
		const code = (row.attributes as Record<string, unknown>).code;
		return { id: row.id, name: typeof code === 'string' && code.trim() !== '' ? code : `Group ${row.id}` };
	});
}

/** The warning when Groups of the name are there already. */
export function clashWords(name: string, matches: readonly GroupRef[]): string {
	return matches.length === 1
		? `A Group named ${matches[0].name} is in Flow PT already. Names are not unique there, so use that one.`
		: `${matches.length} Groups named ${name} are in Flow PT already. Names are not unique there, so use one of them.`;
}

/** What `POST /entity/groups` answered. */
export function createAnswer(status: number, body: unknown, name: string): GroupAnswer {
	const error = firstError(body);
	if (status === 400 && error?.code === 104) {
		return { state: 'refused', title: typeof error.title === 'string' ? error.title : 'Refused.' };
	}
	if (status >= 200 && status < 300) {
		const data = dataOf(body);
		if (data?.type !== 'Group' || !Number.isSafeInteger(data.id) || (data.id as number) <= 0) return { state: 'failed', status, title: 'The answer named no Group.' };
		const code = data.attributes?.code;
		return { state: 'created', group: { id: data.id as number, name: typeof code === 'string' && code !== '' ? code : name } };
	}
	return { state: 'failed', status, title: typeof error?.title === 'string' ? error.title : `HTTP ${status}` };
}

/** The Group read again after the create: there by its id, with the name sent. */
export function readBackAnswer(status: number, body: unknown, id: number, name: string): GroupAnswer {
	const data = dataOf(body);
	if (status === 200 && data?.type === 'Group' && data.id === id && data.attributes?.code === name) return { state: 'created', group: { id, name } };
	return { state: 'unconfirmed', id, name };
}

/** The answer in words, with what to do next. */
export function answerWords(answer: GroupAnswer): string {
	switch (answer.state) {
		case 'created':
			return `Created ${answer.group.name} in Flow PT. It is empty. Add its people in Flow PT.`;
		case 'exists':
			return clashWords(answer.name, answer.matches);
		case 'refused':
			return 'Flow PT refused. Your permission group may not create Groups. Pick a Group that exists, or ask an admin to make one.';
		case 'failed':
			return `Flow PT answered ${answer.status}: ${answer.title.replace(/\.$/, '')}. No Group was made.`;
		case 'unconfirmed':
			return `Flow PT took the Group, but it did not read back. Look for ${answer.name} in Flow PT before you try again.`;
	}
}
