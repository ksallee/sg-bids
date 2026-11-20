/**
 * Production's principal, from a Flow PT session the site itself accepted.
 *
 * The browser sends the site, the project and its credential: the approved session token, or a
 * bearer it minted from it. The server calls only an allowlisted site host (probe 129), mints a
 * bearer from a session token as the browser does (`grant_type=session_token`, recipe 012), reads
 * the person from the bearer's `user` claim (027), and reads the Project row with that bearer: a
 * 404 means the person may not see the project (159). Only then is the tenant `{siteHost,
 * projectId}` handed to the data layer. Nothing the client sends is used as a filter unchecked.
 *
 * Every call asks the site again. Nothing is cached, so a revoked session stops at once.
 */

import type { ProductionPrincipal } from '$lib/pure/access';
import { bearerUser, projectAnswer, siteOrigin, tokenAnswer, type FptUser } from '$lib/pure/fpt-session';
import { StoreError } from './errors';

export interface ProductionClaim {
	readonly siteUrl: unknown;
	readonly projectId: unknown;
	/** The session token the person approved. Preferred: the server mints its own bearer. */
	readonly sessionToken?: unknown;
	/** Or a bearer the browser minted from it. */
	readonly bearer?: unknown;
}

export interface VerifyOptions {
	readonly fetch: typeof fetch;
	readonly allowedHosts: readonly string[];
	/** Accept a script key's bearer. Dev only, for the `/live/dev-token` path. */
	readonly allowScript?: boolean;
}

export interface VerifiedProduction extends ProductionPrincipal {
	readonly user: FptUser;
}

async function body(res: Response): Promise<unknown> {
	return res.json().catch(() => null);
}

async function mint(origin: string, sessionToken: string, fetcher: typeof fetch): Promise<string> {
	let res: Response;
	try {
		res = await fetcher(`${origin}/api/v1/auth/access_token`, {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ grant_type: 'session_token', session_token: sessionToken }).toString()
		});
	} catch (error) {
		throw new StoreError(502, 'Flow PT did not answer.', { cause: error });
	}
	const answer = tokenAnswer(res.status, await body(res));
	if (answer.ok) return answer.bearer;
	if (answer.reason === 'session') throw new StoreError(401, 'Flow PT refused the session. Sign in again.');
	throw new StoreError(502, 'Flow PT did not return a token.');
}

export async function verifyProduction(claim: ProductionClaim, options: VerifyOptions): Promise<VerifiedProduction> {
	const site = siteOrigin(claim.siteUrl, options.allowedHosts);
	if (!site) throw new StoreError(403, 'This app does not serve that site.');
	const projectId = claim.projectId;
	if (typeof projectId !== 'number' || !Number.isSafeInteger(projectId) || projectId <= 0) {
		throw new StoreError(400, 'Name the project by its Flow PT id.');
	}

	let bearer: string;
	if (typeof claim.sessionToken === 'string' && claim.sessionToken !== '') {
		bearer = await mint(site.origin, claim.sessionToken, options.fetch);
	} else if (typeof claim.bearer === 'string' && claim.bearer !== '') {
		bearer = claim.bearer;
	} else {
		throw new StoreError(401, 'Sign in to Flow PT.');
	}

	const user = bearerUser(bearer);
	if (!user) throw new StoreError(401, 'Sign in to Flow PT.');
	if (user.type !== 'HumanUser' && !(options.allowScript && user.type === 'ApiUser')) {
		throw new StoreError(403, 'Sign in to Flow PT as a person.');
	}

	let res: Response;
	try {
		res = await options.fetch(`${site.origin}/api/v1/entity/projects/${projectId}?fields=name`, {
			headers: { Accept: 'application/json', Authorization: `Bearer ${bearer}` }
		});
	} catch (error) {
		throw new StoreError(502, 'Flow PT did not answer.', { cause: error });
	}
	switch (projectAnswer(res.status, await body(res), projectId)) {
		case 'visible':
			return { kind: 'production', siteHost: site.host, projectId, user };
		case 'hidden':
			throw new StoreError(403, 'You cannot see this project in Flow PT.');
		case 'bearer':
			throw new StoreError(401, 'Flow PT refused the session. Sign in again.');
		default:
			throw new StoreError(502, 'Flow PT did not answer as expected.');
	}
}
