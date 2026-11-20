/**
 * The pure half of checking a production session against its Flow PT site. The calls themselves
 * are in `src/lib/server/production.ts`. Facts from `../sg-groundtruth/corpus`:
 *
 * - The server calls only a site host on its allowlist, matched exactly: both Flow PT domains
 *   resolve any name, so a suffix match forwards to hosts no site serves (129).
 * - A session token spends at `POST /api/v1/auth/access_token`, `grant_type=session_token`, for a
 *   600 s bearer (recipe 012, 052). A token the site refuses is 400 code 102 (126).
 * - The bearer's middle segment is base64url JSON with a `user` claim `{type, id}`: `HumanUser`
 *   for a person, `ApiUser` for a script key (027). Read, never verified: the site verifies it.
 * - A bearer the site refuses is 401 code 102 (133).
 * - `GET /entity/projects/<id>` answers the row to a person who may see the project, and 404 to one
 *   who may not (159).
 */

export interface FptUser {
	readonly type: string;
	readonly id: number;
}

function hostOf(url: string): string | null {
	try {
		return new URL(url).hostname.toLowerCase() || null;
	} catch {
		return null;
	}
}

/** The hosts the server may call: a comma list, else the host of the site the sign-in form offers. */
export function allowedHosts(list: string | undefined, defaultSite: string | undefined): string[] {
	const named = (list ?? '')
		.split(',')
		.map((host) => host.trim().toLowerCase())
		.filter(Boolean);
	if (named.length > 0) return named;
	const fallback = defaultSite ? hostOf(defaultSite) : null;
	return fallback ? [fallback] : [];
}

/** The site's origin and host when it is https on the default port, with no credentials, and allowed. */
export function siteOrigin(siteUrl: unknown, allowed: readonly string[]): { origin: string; host: string } | null {
	if (typeof siteUrl !== 'string') return null;
	let url: URL;
	try {
		url = new URL(siteUrl.trim());
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return null;
	const host = url.hostname.toLowerCase();
	if (!allowed.includes(host)) return null;
	return { origin: `https://${host}`, host };
}

/** The bearer's `user` claim, or null when the bearer is not three segments of the right shape. */
export function bearerUser(bearer: string): FptUser | null {
	const parts = bearer.split('.');
	if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
	try {
		const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const claims: unknown = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
		const user = (claims as { user?: unknown } | null)?.user as { type?: unknown; id?: unknown } | undefined;
		if (typeof user?.type !== 'string' || !Number.isSafeInteger(user.id)) return null;
		return { type: user.type, id: user.id as number };
	} catch {
		return null;
	}
}

function errorCode(body: unknown): number | undefined {
	const errors = (body as { errors?: unknown } | null)?.errors;
	if (!Array.isArray(errors)) return undefined;
	const code = (errors[0] as { code?: unknown } | undefined)?.code;
	return typeof code === 'number' ? code : undefined;
}

export type TokenAnswer = { ok: true; bearer: string } | { ok: false; reason: 'session' | 'site' };

/** What the token endpoint said to a session token. */
export function tokenAnswer(status: number, body: unknown): TokenAnswer {
	const token = (body as { access_token?: unknown } | null)?.access_token;
	if (status === 200 && typeof token === 'string' && token !== '') return { ok: true, bearer: token };
	if (status === 400 && errorCode(body) === 102) return { ok: false, reason: 'session' };
	return { ok: false, reason: 'site' };
}

/** What a read of the Project row said: the person sees it, does not, the bearer is bad, or the site failed. */
export function projectAnswer(status: number, body: unknown, projectId: number): 'visible' | 'hidden' | 'bearer' | 'site' {
	if (status === 200) {
		const data = (body as { data?: { type?: unknown; id?: unknown } } | null)?.data;
		return data?.type === 'Project' && data.id === projectId ? 'visible' : 'site';
	}
	if (status === 404) return 'hidden';
	if (status === 401 && errorCode(body) === 102) return 'bearer';
	return 'site';
}
