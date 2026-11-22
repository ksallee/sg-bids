import { describe, expect, it } from 'vitest';
import type { EntityRow } from 'sg-widgets-core';
import {
	answerWords,
	clashWords,
	createAnswer,
	groupActions,
	groupMatches,
	groupName,
	groupRight,
	readBackAnswer,
	ruleSetCode
} from './group-create';

const person = { type: 'HumanUser', id: 88 };

/** `GET /schema/permission_groups/<code>/entity_types/Group`, as a Manager reads it (168). */
const managerRights = {
	data: {
		actions: {
			read: { access: 'allowed' },
			create: { access: 'allowed' },
			update: { access: 'allowed' },
			retire: { access: 'allowed' },
			delete: { access: 'allowed' }
		}
	}
};
const vendorRights = {
	data: {
		actions: {
			read: { access: 'allowed' },
			create: { access: 'denied' },
			update: { access: 'denied' },
			retire: { access: 'denied' },
			delete: { access: 'denied' }
		}
	}
};

/** The 400 body a Vendor or an Artist gets on `POST /entity/groups` (168). */
const refusal = { errors: [{ status: 400, code: 104, title: 'Entity of type Group cannot be created by this user.', source: null, detail: null, meta: null }] };

function group(id: number, code: unknown): EntityRow {
	return { type: 'Group', id, attributes: { code }, relationships: {} } as unknown as EntityRow;
}

describe('the person’s permission group code', () => {
	it('comes off the rule set row (recipe 030)', () => {
		const body = { data: { type: 'PermissionRuleSet', id: 9, attributes: { code: 'manager' } } };
		expect(ruleSetCode(200, body, 9)).toBe('manager');
	});

	it('is null for another row, no code, or an error', () => {
		expect(ruleSetCode(200, { data: { type: 'PermissionRuleSet', id: 10, attributes: { code: 'manager' } } }, 9)).toBeNull();
		expect(ruleSetCode(200, { data: { type: 'PermissionRuleSet', id: 9, attributes: { code: '' } } }, 9)).toBeNull();
		expect(ruleSetCode(404, { errors: [{ code: 104 }] }, 9)).toBeNull();
		expect(ruleSetCode(200, null, 9)).toBeNull();
	});
});

describe('the rights on Group', () => {
	it('reads each action’s access', () => {
		expect(groupActions(200, managerRights)).toEqual({ read: 'allowed', create: 'allowed', update: 'allowed', retire: 'allowed', delete: 'allowed' });
		expect(groupActions(200, vendorRights)?.create).toBe('denied');
	});

	it('is null when the call did not answer them', () => {
		expect(groupActions(404, { errors: [{ title: 'Unknown permission group code' }] })).toBeNull();
		expect(groupActions(200, { data: {} })).toBeNull();
	});
});

describe('who may create a Group', () => {
	it('a person whose group allows create (Manager, Admin)', () => {
		expect(groupRight(person, 'manager', groupActions(200, managerRights))).toEqual({ state: 'yes', reason: 'Your permission group, manager, may create Groups.' });
	});

	it('not a person whose group denies it (Artist, Vendor)', () => {
		expect(groupRight(person, 'vendor', groupActions(200, vendorRights))).toEqual({ state: 'no', reason: 'Your permission group, vendor, may not create Groups in Flow PT.' });
	});

	it('the script key, which creates Groups (168)', () => {
		expect(groupRight({ type: 'ApiUser', id: 3 }, null, null).state).toBe('yes');
	});

	it('nobody when the read did not settle it', () => {
		expect(groupRight(person, null, null)).toEqual({ state: 'no', reason: 'Your rights on Group could not be read.' });
		expect(groupRight(person, 'manager', null).state).toBe('no');
		expect(groupRight(null, 'manager', groupActions(200, managerRights)).state).toBe('no');
		expect(groupRight(person, 'manager', { read: 'allowed' }).state).toBe('no');
	});
});

describe('a Group name', () => {
	it('is trimmed, and a blank one is a problem', () => {
		expect(groupName('  Studio North ')).toEqual({ ok: true, name: 'Studio North' });
		expect(groupName('   ')).toEqual({ ok: false, problem: 'Give the Group a name.' });
	});
});

describe('Groups of the same name', () => {
	it('are the live Groups the search found, by id and name', () => {
		expect(groupMatches([group(41, 'Studio North'), group(57, 'studio north')])).toEqual([
			{ id: 41, name: 'Studio North' },
			{ id: 57, name: 'studio north' }
		]);
		expect(groupMatches([group(41, null)])).toEqual([{ id: 41, name: 'Group 41' }]);
	});

	it('are said in words, one or several', () => {
		expect(clashWords('Studio North', [{ id: 41, name: 'Studio North' }])).toBe('A Group named Studio North is in Flow PT already. Names are not unique there, so use that one.');
		expect(clashWords('Studio North', [
			{ id: 41, name: 'Studio North' },
			{ id: 57, name: 'studio north' }
		])).toBe('2 Groups named Studio North are in Flow PT already. Names are not unique there, so use one of them.');
	});
});

describe('what the create answered', () => {
	it('201: the new Group, by id', () => {
		const body = { data: { type: 'Group', id: 501, attributes: { code: 'Studio North' } } };
		expect(createAnswer(201, body, 'Studio North')).toEqual({ state: 'created', group: { id: 501, name: 'Studio North' } });
	});

	it('400 code 104: refused', () => {
		expect(createAnswer(400, refusal, 'Studio North')).toEqual({ state: 'refused', title: 'Entity of type Group cannot be created by this user.' });
	});

	it('anything else: failed, with the site’s words', () => {
		expect(createAnswer(400, { errors: [{ code: 103, title: 'Bad field' }] }, 'X')).toEqual({ state: 'failed', status: 400, title: 'Bad field' });
		expect(createAnswer(503, null, 'X')).toEqual({ state: 'failed', status: 503, title: 'HTTP 503' });
		expect(createAnswer(201, { data: { type: 'Group' } }, 'X')).toEqual({ state: 'failed', status: 201, title: 'The answer named no Group.' });
	});
});

describe('the read back', () => {
	it('confirms the Group by its id and name, with no member', () => {
		const body = { data: { type: 'Group', id: 501, attributes: { code: 'Studio North' }, relationships: { users: { data: [] } } } };
		expect(readBackAnswer(200, body, 501, 'Studio North')).toEqual({ state: 'created', group: { id: 501, name: 'Studio North' } });
	});

	it('leaves it unconfirmed when the row does not read back as sent', () => {
		expect(readBackAnswer(404, null, 501, 'Studio North')).toEqual({ state: 'unconfirmed', id: 501, name: 'Studio North' });
		expect(readBackAnswer(200, { data: { type: 'Group', id: 501, attributes: { code: 'Other' } } }, 501, 'Studio North').state).toBe('unconfirmed');
	});
});

describe('the answer in words', () => {
	it('says each one plainly', () => {
		expect(answerWords({ state: 'created', group: { id: 501, name: 'Studio North' } })).toBe('Created Studio North in Flow PT. It is empty. Add its people in Flow PT.');
		expect(answerWords({ state: 'exists', name: 'Studio North', matches: [{ id: 41, name: 'Studio North' }] })).toBe(
			'A Group named Studio North is in Flow PT already. Names are not unique there, so use that one.'
		);
		expect(answerWords({ state: 'refused', title: 'Entity of type Group cannot be created by this user.' })).toBe(
			'Flow PT refused. Your permission group may not create Groups. Pick a Group that exists, or ask an admin to make one.'
		);
		expect(answerWords({ state: 'failed', status: 503, title: 'Service unavailable.' })).toBe('Flow PT answered 503: Service unavailable. No Group was made.');
		expect(answerWords({ state: 'unconfirmed', id: 501, name: 'Studio North' })).toBe(
			'Flow PT took the Group, but it did not read back. Look for Studio North in Flow PT before you try again.'
		);
	});
});
