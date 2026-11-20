/**
 * A vendor's link token: 32 random bytes, written base64url with no padding (43 characters).
 * The token is shown once, in the link. Only its SHA-256 hash is stored.
 *
 * The random bytes come from the caller (`src/lib/server/store.ts`), so everything here is pure.
 * Hashing runs on `node:crypto`: this module is for the server only.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

export const TOKEN_BYTES = 32;

/** 32 bytes in base64url is 43 characters. The last one carries 2 spare bits, always zero. */
const SHAPE = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const HASH = /^[0-9a-f]{64}$/;

export function encodeToken(bytes: Uint8Array): string {
	if (bytes.length !== TOKEN_BYTES) throw new Error(`A token is ${TOKEN_BYTES} bytes; got ${bytes.length}.`);
	return Buffer.from(bytes).toString('base64url');
}

/** The token as sent, when it has a token's shape. Null otherwise: never throw on what a stranger sends. */
export function parseToken(value: unknown): string | null {
	return typeof value === 'string' && SHAPE.test(value) ? value : null;
}

/** SHA-256 of the token text, lower-case hex. What the database holds. */
export function hashToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Compares two hex hashes in constant time. False for anything that is not a hash. */
export function sameHash(a: string, b: string): boolean {
	if (!HASH.test(a) || !HASH.test(b)) return false;
	return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
