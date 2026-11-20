/**
 * A fixed window count of failures per key, in memory, and the vendor routes' gate built on it.
 *
 * It lives in one server instance. On Vercel each instance keeps its own count, so this slows a
 * guesser down and caps the database calls one instance makes; it is not a global limit. The real
 * guard is the token: 32 random bytes.
 */

export interface Limiter {
	blocked(key: string, now: number): boolean;
	fail(key: string, now: number): void;
	size(): number;
}

export function createLimiter(options: { limit: number; windowMs: number; maxKeys?: number }): Limiter {
	const maxKeys = options.maxKeys ?? 10_000;
	const windows = new Map<string, { count: number; resetAt: number }>();

	function prune(now: number): void {
		for (const [key, entry] of windows) if (entry.resetAt <= now) windows.delete(key);
		while (windows.size > maxKeys) windows.delete(windows.keys().next().value as string);
	}

	return {
		blocked(key, now) {
			const entry = windows.get(key);
			return entry !== undefined && entry.resetAt > now && entry.count >= options.limit;
		},
		fail(key, now) {
			const entry = windows.get(key);
			if (entry && entry.resetAt > now) entry.count++;
			else {
				windows.delete(key);
				windows.set(key, { count: 1, resetAt: now + options.windowMs });
			}
			if (windows.size > maxKeys) prune(now);
		},
		size: () => windows.size
	};
}

export interface Gate {
	/** Whether to look the token up for this client: no when the client or the token failed too often. */
	allowed(client: string, tokenHash: string, now: number): boolean;
	/** A lookup that failed: counted for the client and for the token. */
	fail(client: string, tokenHash: string, now: number): void;
	/** A lookup that worked: the token passes from here, whatever its client's count. */
	pass(tokenHash: string): void;
	known(): number;
}

/**
 * The vendor routes' gate. Only failed lookups count, per client address and per token (the first
 * 16 hex of its hash), so one bad client behind a shared address does not lock out the vendors
 * beside it: a token that worked on this instance passes even when its address is held back. An
 * unknown token from a held back address is refused before any database call.
 */
export function createGate(options: { limit: number; windowMs: number; maxKeys?: number; maxKnown?: number }): Gate {
	const failures = createLimiter(options);
	const maxKnown = options.maxKnown ?? 10_000;
	const good = new Set<string>();
	const tokenKey = (hash: string) => `token:${hash.slice(0, 16)}`;
	const clientKey = (client: string) => `client:${client}`;
	return {
		allowed(client, tokenHash, now) {
			if (good.has(tokenHash)) return true;
			return !failures.blocked(clientKey(client), now) && !failures.blocked(tokenKey(tokenHash), now);
		},
		fail(client, tokenHash, now) {
			good.delete(tokenHash);
			failures.fail(clientKey(client), now);
			failures.fail(tokenKey(tokenHash), now);
		},
		pass(tokenHash) {
			good.delete(tokenHash);
			good.add(tokenHash);
			while (good.size > maxKnown) good.delete(good.values().next().value as string);
		},
		known: () => good.size
	};
}
