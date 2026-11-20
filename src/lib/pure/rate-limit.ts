/**
 * A fixed window count of failures per key, in memory. The vendor routes count the link lookups
 * that fail per client address and refuse that address for the rest of the window.
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
