import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encodeToken, hashToken, parseToken, sameHash, TOKEN_BYTES } from './token';

const bytes = (fill: number) => new Uint8Array(TOKEN_BYTES).fill(fill);

describe('encodeToken', () => {
	it('writes 32 bytes as 43 base64url characters, no padding', () => {
		const token = encodeToken(bytes(0xff));
		expect(token).toBe('_'.repeat(42) + '8');
		expect(token).toHaveLength(43);
		expect(encodeToken(bytes(0))).toBe('A'.repeat(43));
	});

	it('uses the url-safe alphabet', () => {
		const token = encodeToken(new Uint8Array(32).map((_, i) => i * 8 + 3));
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it('refuses anything but 32 bytes', () => {
		expect(() => encodeToken(new Uint8Array(31))).toThrow();
		expect(() => encodeToken(new Uint8Array(33))).toThrow();
	});
});

describe('parseToken', () => {
	it('takes back what encodeToken wrote', () => {
		const token = encodeToken(new Uint8Array(32).map((_, i) => i * 7));
		expect(parseToken(token)).toBe(token);
	});

	it('refuses the wrong length, padding, or another alphabet', () => {
		expect(parseToken('A'.repeat(42))).toBeNull();
		expect(parseToken('A'.repeat(44))).toBeNull();
		expect(parseToken('A'.repeat(42) + '=')).toBeNull();
		expect(parseToken('A'.repeat(42) + '+')).toBeNull();
		expect(parseToken('A'.repeat(42) + '/')).toBeNull();
		expect(parseToken('')).toBeNull();
		expect(parseToken(undefined)).toBeNull();
		expect(parseToken(42)).toBeNull();
	});

	it('refuses a last character that carries bits 32 bytes do not have', () => {
		// 43 characters hold 258 bits; the last two must be zero.
		expect(parseToken('A'.repeat(42) + 'B')).toBeNull();
		expect(parseToken('A'.repeat(42) + 'E')).toBe('A'.repeat(42) + 'E');
	});
});

describe('hashToken', () => {
	it('is the SHA-256 of the token text, lower-case hex', () => {
		const token = encodeToken(bytes(7));
		expect(hashToken(token)).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
		expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
	});

	it('never returns the token', () => {
		const token = encodeToken(bytes(1));
		expect(hashToken(token)).not.toContain(token);
	});
});

describe('sameHash', () => {
	it('is true for the same hash only', () => {
		const a = hashToken(encodeToken(bytes(1)));
		const b = hashToken(encodeToken(bytes(2)));
		expect(sameHash(a, a)).toBe(true);
		expect(sameHash(a, b)).toBe(false);
	});

	it('is false for a different length or a malformed hash, without throwing', () => {
		const a = hashToken(encodeToken(bytes(1)));
		expect(sameHash(a, a.slice(1))).toBe(false);
		expect(sameHash(a, a.toUpperCase())).toBe(false);
		expect(sameHash('', '')).toBe(false);
	});
});
