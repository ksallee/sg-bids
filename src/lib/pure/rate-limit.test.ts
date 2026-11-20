import { describe, expect, it } from 'vitest';
import { createGate, createLimiter } from './rate-limit';

const GOOD = 'a'.repeat(64);
const guess = (i: number) => i.toString(16).padEnd(64, 'f');

describe('createGate', () => {
	it('holds back a client after its failed lookups, but never a token that worked here', () => {
		const gate = createGate({ limit: 3, windowMs: 1000 });
		expect(gate.allowed('10.0.0.1', GOOD, 0)).toBe(true);
		gate.pass(GOOD);
		// A guesser behind the same address fails three times.
		for (let i = 0; i < 3; i++) {
			expect(gate.allowed('10.0.0.1', guess(i), 0)).toBe(true);
			gate.fail('10.0.0.1', guess(i), 0);
		}
		expect(gate.allowed('10.0.0.1', guess(99), 10)).toBe(false);
		// The vendor behind the same address still gets in with its link.
		expect(gate.allowed('10.0.0.1', GOOD, 10)).toBe(true);
		// Another address is not held back, and the window ends.
		expect(gate.allowed('10.0.0.2', guess(99), 10)).toBe(true);
		expect(gate.allowed('10.0.0.1', guess(99), 1000)).toBe(true);
	});

	it('holds back one token tried and failed from many addresses', () => {
		const gate = createGate({ limit: 3, windowMs: 1000 });
		for (let i = 0; i < 3; i++) gate.fail(`10.0.1.${i}`, guess(7), 0);
		expect(gate.allowed('10.0.2.1', guess(7), 1)).toBe(false);
		expect(gate.allowed('10.0.2.1', guess(8), 1)).toBe(true);
	});

	it('forgets a token that failed later, and keeps a bounded number', () => {
		const gate = createGate({ limit: 1, windowMs: 1000, maxKnown: 2 });
		gate.pass(GOOD);
		gate.fail('10.0.0.1', GOOD, 0);
		expect(gate.allowed('10.0.0.1', GOOD, 1)).toBe(false);
		gate.pass(guess(1));
		gate.pass(guess(2));
		gate.pass(guess(3));
		expect(gate.known()).toBe(2);
	});
});

describe('createLimiter', () => {
	it('blocks a key after the limit of failures in the window, and lets it go after', () => {
		const limiter = createLimiter({ limit: 3, windowMs: 1000 });
		for (let i = 0; i < 3; i++) {
			expect(limiter.blocked('1.2.3.4', 0)).toBe(false);
			limiter.fail('1.2.3.4', 0);
		}
		expect(limiter.blocked('1.2.3.4', 999)).toBe(true);
		expect(limiter.blocked('5.6.7.8', 999)).toBe(false);
		expect(limiter.blocked('1.2.3.4', 1000)).toBe(false);
	});

	it('starts a new window once the old one ends', () => {
		const limiter = createLimiter({ limit: 2, windowMs: 1000 });
		limiter.fail('k', 0);
		limiter.fail('k', 1500);
		expect(limiter.blocked('k', 1600)).toBe(false);
		limiter.fail('k', 1700);
		expect(limiter.blocked('k', 1800)).toBe(true);
	});

	it('holds a bounded number of keys, dropping the oldest', () => {
		const limiter = createLimiter({ limit: 1, windowMs: 10_000, maxKeys: 2 });
		limiter.fail('a', 0);
		limiter.fail('b', 1);
		limiter.fail('c', 2);
		expect(limiter.size()).toBe(2);
		expect(limiter.blocked('a', 3)).toBe(false);
		expect(limiter.blocked('c', 3)).toBe(true);
	});
});
