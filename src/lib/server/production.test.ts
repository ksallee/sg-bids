/**
 * The production check against a fake site. Every answer is shaped like the corpus' (recipe 012,
 * findings 027, 126, 133, 159). No network, no database.
 */
import { describe, expect, it } from 'vitest';
import { StoreError } from './errors';
import { verifyProduction } from './production';

const SITE = 'https://studio.example.com';
const hosts = ['studio.example.com'];

function bearer(user: { type: string; id: number }): string {
	const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
	return `${part({ alg: 'HS256' })}.${part({ iss: 'studio.example.com', user, auth_type: 'session_token', sudo_as_login: null })}.sig`;
}

const person = bearer({ type: 'HumanUser', id: 253 });
const script = bearer({ type: 'ApiUser', id: 298 });

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const refusedSession = json(400, {
	errors: [{ id: 'u', status: 400, code: 102, title: "Can't authenticate session token ending with 'abcd'", source: {}, detail: null, meta: null }]
});
const expired = json(401, { errors: [{ id: 'u', status: 401, code: 102, title: 'Unauthorized', source: null, detail: 'Token Expired', meta: null }] });
const hidden = json(404, { errors: [{ status: 404, code: 104, title: 'Not Found', detail: 'Project: 70 not found' }] });
const project = (id: number) => json(200, { data: { type: 'Project', attributes: { name: 'Show' }, id, links: { self: `/api/v1/entity/projects/${id}` } } });

interface Call {
	url: string;
	init?: RequestInit;
}

const group = (id: string, code: string, display_name: string) => ({ id, code, display_name, entity_type: 'HumanUser', parent_set_id: null, updated_at: 't' });
/** `GET /schema/permission_groups?permission_rule_set_entity_type=HumanUser`: an Admin sees every group, anyone else their own (132, 162). */
const everyGroup = () =>
	json(200, { data: [group('8', 'admin', 'Admin'), group('9', 'manager', 'Manager'), group('10', 'artist', 'Artist'), group('11', 'vendor', 'Vendor')], links: {} });
const onlyGroup = (id: string, code: string, name: string) => json(200, { data: [group(id, code, name)], links: {} });
/** `GET /entity/human_users/<id>?fields=permission_rule_set` with the person's own bearer (052). */
const row = (id: number, ruleSet: { id: number; name: string }) =>
	json(200, { data: { type: 'HumanUser', attributes: {}, relationships: { permission_rule_set: { data: { ...ruleSet, type: 'PermissionRuleSet' } } }, id, links: {} } });
const notFound = () => json(404, { errors: [{ status: 404, code: 104, title: 'Not Found', detail: 'HumanUser: 253 not found' }] });

interface Answers {
	token?: Response;
	project?: Response;
	groups?: Response;
	user?: Response;
}

/** A site that answers the token endpoint, the Project read and the role reads from a script of answers. An Admin unless told otherwise. */
function site(answers: Answers) {
	const calls: Call[] = [];
	const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		if (url.endsWith('/api/v1/auth/access_token')) return answers.token ?? json(500, null);
		if (url.includes('/api/v1/entity/projects/')) return answers.project ?? json(500, null);
		if (url.includes('/api/v1/schema/permission_groups')) return answers.groups ?? everyGroup();
		if (url.includes('/api/v1/entity/human_users/')) return answers.user ?? row(253, { id: 8, name: 'Admin' });
		throw new Error(`unexpected call ${url}`);
	}) as typeof fetch;
	return { fetcher, calls };
}

async function refusal(promise: Promise<unknown>): Promise<StoreError> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof StoreError) return error;
		throw error;
	}
	throw new Error('expected a refusal');
}

describe('verifyProduction', () => {
	it('mints a bearer from the session token, reads the project, and answers the tenant', async () => {
		const { fetcher, calls } = site({ token: json(200, { token_type: 'Bearer', access_token: person, expires_in: 600, refresh_token: 'r' }), project: project(70) });
		const principal = await verifyProduction({ siteUrl: SITE, projectId: 70, sessionToken: 'sess' }, { fetch: fetcher, allowedHosts: hosts });
		expect(principal).toEqual({ kind: 'production', siteHost: 'studio.example.com', projectId: 70, user: { type: 'HumanUser', id: 253 }, role: 'admin' });

		expect(calls[0].url).toBe('https://studio.example.com/api/v1/auth/access_token');
		expect(calls[0].init?.method).toBe('POST');
		expect(new Headers(calls[0].init?.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
		expect(String(calls[0].init?.body)).toBe('grant_type=session_token&session_token=sess');
		expect(calls[1].url).toBe('https://studio.example.com/api/v1/entity/projects/70?fields=name');
		expect(new Headers(calls[1].init?.headers).get('authorization')).toBe(`Bearer ${person}`);
		const roleCalls = calls.slice(2).map((call) => call.url).sort();
		expect(roleCalls).toEqual([
			'https://studio.example.com/api/v1/entity/human_users/253?fields=permission_rule_set',
			'https://studio.example.com/api/v1/schema/permission_groups?permission_rule_set_entity_type=HumanUser'
		]);
		for (const call of calls.slice(2)) expect(new Headers(call.init?.headers).get('authorization')).toBe(`Bearer ${person}`);
	});

	it('takes a bearer the browser minted, without a token call', async () => {
		const { fetcher, calls } = site({ project: project(70) });
		const principal = await verifyProduction({ siteUrl: SITE, projectId: 70, bearer: person }, { fetch: fetcher, allowedHosts: hosts });
		expect(principal.siteHost).toBe('studio.example.com');
		expect(calls.filter((call) => call.url.endsWith('/auth/access_token'))).toHaveLength(0);
	});

	it('calls no site that is not allowlisted, and none at all for a bad project id', async () => {
		const { fetcher, calls } = site({});
		expect((await refusal(verifyProduction({ siteUrl: 'https://evil.example.com', projectId: 70, bearer: person }, { fetch: fetcher, allowedHosts: hosts }))).status).toBe(403);
		expect((await refusal(verifyProduction({ siteUrl: 'http://studio.example.com', projectId: 70, bearer: person }, { fetch: fetcher, allowedHosts: hosts }))).status).toBe(403);
		expect((await refusal(verifyProduction({ siteUrl: SITE, projectId: '70', bearer: person }, { fetch: fetcher, allowedHosts: hosts }))).status).toBe(400);
		expect((await refusal(verifyProduction({ siteUrl: SITE, projectId: 70 }, { fetch: fetcher, allowedHosts: hosts }))).status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	it('refuses a session token the site refuses (126)', async () => {
		const { fetcher } = site({ token: refusedSession });
		const error = await refusal(verifyProduction({ siteUrl: SITE, projectId: 70, sessionToken: 'old' }, { fetch: fetcher, allowedHosts: hosts }));
		expect(error.status).toBe(401);
	});

	it('refuses an expired bearer (133)', async () => {
		const { fetcher } = site({ project: expired });
		const error = await refusal(verifyProduction({ siteUrl: SITE, projectId: 70, bearer: person }, { fetch: fetcher, allowedHosts: hosts }));
		expect(error.status).toBe(401);
	});

	it('refuses a person who cannot see the project (159)', async () => {
		const { fetcher } = site({ project: hidden });
		const error = await refusal(verifyProduction({ siteUrl: SITE, projectId: 70, bearer: person }, { fetch: fetcher, allowedHosts: hosts }));
		expect(error.status).toBe(403);
	});

	it('refuses a 200 for another project', async () => {
		const { fetcher } = site({ project: project(71) });
		const error = await refusal(verifyProduction({ siteUrl: SITE, projectId: 70, bearer: person }, { fetch: fetcher, allowedHosts: hosts }));
		expect(error.status).toBe(502);
	});

	it('refuses a script key unless dev allows it (027)', async () => {
		const { fetcher, calls } = site({ project: project(70) });
		expect((await refusal(verifyProduction({ siteUrl: SITE, projectId: 70, bearer: script }, { fetch: fetcher, allowedHosts: hosts }))).status).toBe(403);
		expect(calls).toHaveLength(0);
		const principal = await verifyProduction({ siteUrl: SITE, projectId: 70, bearer: script }, { fetch: fetcher, allowedHosts: hosts, allowScript: true });
		expect(principal.user).toEqual({ type: 'ApiUser', id: 298 });
		// The script reads no HumanUser group (162): dev skips the role reads.
		expect(calls.some((call) => call.url.includes('permission_groups') || call.url.includes('human_users'))).toBe(false);
	});

	it('refuses garbage for a bearer before calling the site', async () => {
		const { fetcher, calls } = site({ project: project(70) });
		expect((await refusal(verifyProduction({ siteUrl: SITE, projectId: 70, bearer: 'garbage' }, { fetch: fetcher, allowedHosts: hosts }))).status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	describe('by permission group, default deny', () => {
		const as = (answers: Answers, roles?: readonly string[]) => {
			const { fetcher } = site({ project: project(70), ...answers });
			return verifyProduction({ siteUrl: SITE, projectId: 70, bearer: person }, { fetch: fetcher, allowedHosts: hosts, productionRoles: roles });
		};

		it('refuses a Vendor person who can read the project: their only group is vendor (162)', async () => {
			const error = await refusal(as({ groups: onlyGroup('11', 'vendor', 'Vendor'), user: row(253, { id: 11, name: 'Vendor' }) }));
			expect(error.status).toBe(403);
			expect(error.message).toMatch(/permission group/);
		});

		it('refuses a Vendor even when their own row cannot be read', async () => {
			expect((await refusal(as({ groups: onlyGroup('11', 'vendor', 'Vendor'), user: notFound() }))).status).toBe(403);
		});

		it('refuses an Artist, and anyone whose group is not listed in the env', async () => {
			expect((await refusal(as({ groups: onlyGroup('10', 'artist', 'Artist'), user: row(253, { id: 10, name: 'Artist' }) }))).status).toBe(403);
			expect((await refusal(as({}, ['producer'])))).toBeInstanceOf(StoreError);
		});

		it('lets a Manager in by default, and the groups the env names', async () => {
			expect((await as({ groups: onlyGroup('9', 'manager', 'Manager'), user: row(253, { id: 9, name: 'Manager' }) })).role).toBe('manager');
			expect((await as({ groups: onlyGroup('10', 'artist', 'Artist'), user: notFound() }, ['artist'])).role).toBe('artist');
		});

		it('finds an Admin’s own group among every group they see, by the row', async () => {
			expect((await as({})).role).toBe('admin');
			expect((await as({ user: row(253, { id: 999, name: 'Manager' }) })).role).toBe('manager');
			// An Admin-like person whose row says Vendor is a vendor.
			expect((await refusal(as({ user: row(253, { id: 11, name: 'Vendor' }) }))).status).toBe(403);
		});

		it('refuses when the group cannot be told: several groups and no row, no list, an empty list', async () => {
			for (const answers of [{ user: notFound() }, { groups: json(403, { errors: [{ status: 403, code: 102 }] }) }, { groups: json(200, { data: [] }) }]) {
				const error = await refusal(as(answers));
				expect(error.status).toBe(403);
				expect(error.message).toMatch(/could not be read/);
			}
		});

		it('answers 502 when the site fails on a role read', async () => {
			const { fetcher } = site({ project: project(70) });
			const failing = (async (input: string | URL | Request, init?: RequestInit) => {
				if (String(input).includes('/schema/permission_groups')) throw new TypeError('fetch failed');
				return fetcher(input, init);
			}) as typeof fetch;
			const error = await refusal(verifyProduction({ siteUrl: SITE, projectId: 70, bearer: person }, { fetch: failing, allowedHosts: hosts }));
			expect(error.status).toBe(502);
		});
	});

	it('answers 502 when the site does not answer', async () => {
		const fetcher = (async () => {
			throw new TypeError('fetch failed');
		}) as typeof fetch;
		expect((await refusal(verifyProduction({ siteUrl: SITE, projectId: 70, bearer: person }, { fetch: fetcher, allowedHosts: hosts }))).status).toBe(502);
	});
});
