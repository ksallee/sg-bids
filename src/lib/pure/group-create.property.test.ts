import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createAnswer, groupName, groupRight } from './group-create';

const statusArb = fc.oneof(fc.constantFrom(200, 201, 400, 403, 404, 500, 503), fc.integer({ min: 100, max: 599 }));
const codeArb = fc.oneof(fc.constantFrom(103, 104, 105), fc.integer(), fc.string(), fc.constant(undefined));
const bodyArb = fc.oneof(
	fc.constant(null),
	fc.record({ errors: fc.array(fc.record({ code: codeArb, title: fc.oneof(fc.string(), fc.constant(undefined)) }), { maxLength: 2 }) }),
	fc.record({ data: fc.record({ type: fc.constantFrom('Group', 'HumanUser'), id: fc.oneof(fc.integer({ min: -2, max: 10_000 }), fc.string()), attributes: fc.record({ code: fc.string() }) }) })
);

describe('a create answer, for any status and body', () => {
	it('is a refusal exactly when it is 400 with code 104 first', () => {
		fc.assert(
			fc.property(statusArb, bodyArb, fc.string(), (status, body, name) => {
				const first = (body as { errors?: { code?: unknown }[] } | null)?.errors?.[0];
				expect(createAnswer(status, body, name).state === 'refused').toBe(status === 400 && first?.code === 104);
			})
		);
	});

	it('names a Group only on a 2xx carrying a Group with a positive id', () => {
		fc.assert(
			fc.property(statusArb, bodyArb, fc.string(), (status, body, name) => {
				const answer = createAnswer(status, body, name);
				const data = (body as { data?: { type?: unknown; id?: unknown } } | null)?.data;
				expect(answer.state !== 'created' || (status >= 200 && status < 300 && data?.type === 'Group' && answer.group.id === data.id && answer.group.id > 0)).toBe(true);
			})
		);
	});
});

describe('a Group name, for any text', () => {
	it('is the same once cleaned again, and never blank', () => {
		fc.assert(
			fc.property(fc.string(), (text) => {
				const once = groupName(text);
				if (once.ok) {
					expect(once.name).not.toBe('');
					expect(groupName(once.name)).toEqual(once);
				} else {
					expect(text.trim()).toBe('');
				}
			})
		);
	});
});

describe('the right to create', () => {
	it('is yes for a person only when their group allows create', () => {
		fc.assert(
			fc.property(fc.option(fc.string({ minLength: 1 }), { nil: null }), fc.option(fc.dictionary(fc.constantFrom('read', 'create', 'update'), fc.constantFrom('allowed', 'denied', 'x')), { nil: null }), (code, actions) => {
				const right = groupRight({ type: 'HumanUser', id: 1 }, code, actions);
				expect(right.state === 'yes').toBe(code !== null && actions?.create === 'allowed');
			})
		);
	});
});
