import { describe, expect, it } from 'vitest';
import { createLimiter } from './rate-limit';

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
