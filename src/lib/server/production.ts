/**
 * Production's principal, from a Flow PT session the site itself accepted.
 *
 * The browser sends the site, the project and its credential: the approved session token, or a
 * bearer it minted from it. The server calls only an allowlisted site host (probe 129), follows no
 * redirect (a site answers at its own host, 129; a redirect would carry the bearer elsewhere), mints a
 * bearer from a session token as the browser does (`grant_type=session_token`, recipe 012), reads
 * the person from the bearer's `user` claim (027), and reads the Project row with that bearer: a
 * 404 means the person may not see the project (159). Seeing the project is not enough: a Vendor
 * person sees a project they are assigned to. So the person's permission group code must be in the
 * allowlist (`FPT_PRODUCTION_ROLES`, default admin and manager), read with their own bearer from
 * `/schema/permission_groups` and their HumanUser row (027, 052, 132, 162). When those answers do
 * not settle the group, the person is refused. Only then is the tenant `{siteHost, projectId}`
 * handed to the data layer. Nothing the client sends is used as a filter unchecked.
 *
 * Every call asks the site again. Nothing is cached, so a revoked session stops at once.
 */

import type { ProductionPrincipal } from '$lib/pure/access';
import {
	bearerUser,
	DEFAULT_PRODUCTION_ROLES,
	groupsAnswer,
	ownGroupCode,
	projectAnswer,
	ruleSetAnswer,
	siteOrigin,
	tokenAnswer,
	type FptUser
} from '$lib/pure/fpt-session';
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
	/** Accept a script key's bearer. Dev only, for the `/live/dev-token` path. It skips the role check. */
	readonly allowScript?: boolean;
	/** Permission group codes allowed as production. Default admin and manager. */
	readonly productionRoles?: readonly string[];
}

export interface VerifiedProduction extends ProductionPrincipal {
	readonly user: FptUser;
	/** The person's permission group code. `script` for the dev key. */
	readonly role: string;
}

async function body(res: Response): Promise<unknown> {
	return res.json().catch(() => null);
}

async function mint(origin: string, sessionToken: string, fetcher: typeof fetch): Promise<string> {
	let res: Response;
	try {
		res = await fetcher(`${origin}/api/v1/auth/access_token`, {
			method: 'POST',
			redirect: 'error',
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

async function read(url: string, bearer: string, fetcher: typeof fetch): Promise<{ status: number; body: unknown }> {
	let res: Response;
	try {
		res = await fetcher(url, { redirect: 'error', headers: { Accept: 'application/json', Authorization: `Bearer ${bearer}` } });
	} catch (error) {
		throw new StoreError(502, 'Flow PT did not answer.', { cause: error });
	}
	return { status: res.status, body: await body(res) };
}

/** The person's permission group code, read with their own bearer. Throws a refusal unless it is allowed. */
async function role(origin: string, bearer: string, userId: number, options: VerifyOptions): Promise<string> {
	const [groups, own] = await Promise.all([
		read(`${origin}/api/v1/schema/permission_groups?permission_rule_set_entity_type=HumanUser`, bearer, options.fetch),
		read(`${origin}/api/v1/entity/human_users/${userId}?fields=permission_rule_set`, bearer, options.fetch)
	]);
	const listed = groupsAnswer(groups.status, groups.body);
	const code = listed && ownGroupCode(listed, ruleSetAnswer(own.status, own.body, userId));
	if (!code) throw new StoreError(403, 'Your Flow PT permission group could not be read. Production needs an Admin or a Manager.');
	const allowed = options.productionRoles ?? DEFAULT_PRODUCTION_ROLES;
	if (!allowed.includes(code.toLowerCase())) {
		throw new StoreError(403, 'Your Flow PT permission group cannot run bids. Ask your Flow PT admin.');
	}
	return code;
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
			redirect: 'error',
			headers: { Accept: 'application/json', Authorization: `Bearer ${bearer}` }
		});
	} catch (error) {
		throw new StoreError(502, 'Flow PT did not answer.', { cause: error });
	}
	switch (projectAnswer(res.status, await body(res), projectId)) {
		case 'visible':
			break;
		case 'hidden':
			throw new StoreError(403, 'You cannot see this project in Flow PT.');
		case 'bearer':
			throw new StoreError(401, 'Flow PT refused the session. Sign in again.');
		default:
			throw new StoreError(502, 'Flow PT did not answer as expected.');
	}

	const code = user.type === 'ApiUser' ? 'script' : await role(site.origin, bearer, user.id, options);
	return { kind: 'production', siteHost: site.host, projectId, user, role: code };
}
