/**
 * The requests list endpoint across a site, end to end but for the database: a POST with a claim,
 * the real check against a fake site (shaped as the corpus' answers: 006, 027, 133, 162), and a
 * list that records what it was asked for. What the site lists for the person is the only filter.
 */
import { describe, expect, it } from 'vitest';
import type { SitePrincipal } from '$lib/pure/access';
import { verifyProductionSite } from './production';
import type { SiteRequestOverview } from './requests';
import { listRequestsAcross, siteRoute } from './site-route';

const SITE = 'https://studio.example.com';
const hosts = ['studio.example.com'];

function bearer(user: { type: string; id: number }): string {
	const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
	return `${part({ alg: 'HS256' })}.${part({ iss: 'studio.example.com', user, auth_type: 'session_token', sudo_as_login: null })}.sig`;
}
const person = bearer({ type: 'HumanUser', id: 253 });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const group = (id: string, code: string, display_name: string) => ({ id, code, display_name, entity_type: 'HumanUser' });

/** A site where the person is in `code`'s group and may read `readable`, a page of 500 at a time. */
function site(readable: { id: number; name: string }[], code = 'admin') {
	return (async (input: string | URL | Request) => {
		const url = new URL(String(input));
		if (url.pathname === '/api/v1/schema/permission_groups') return json(200, { data: [group('8', code, code)] });
		if (url.pathname === '/api/v1/entity/human_users/253') {
			return json(200, { data: { type: 'HumanUser', id: 253, relationships: { permission_rule_set: { data: { type: 'PermissionRuleSet', id: 8, name: code } } } } });
		}
		if (url.pathname === '/api/v1/entity/projects') {
			const page = Number(url.searchParams.get('page[number]'));
			const rows = readable.slice((page - 1) * 500, page * 500);
			return json(200, { data: rows.map((r) => ({ type: 'Project', id: r.id, attributes: { name: r.name } })), links: { next: `/api/v1/entity/projects?page[number]=${page + 1}` } });
		}
		throw new Error(`unexpected call ${url}`);
	}) as typeof fetch;
}

/** Every request on the site, in three projects; the store would filter them by the principal. */
const ON_SITE: SiteRequestOverview[] = [70, 91, 99].map((projectId, i) => ({
	id: `r${projectId}`,
	projectId,
	code: `C-${i}`,
	title: `Request in ${projectId}`,
	round: 1,
	status: 'issued',
	dueDate: null,
	issuedAt: null,
	invited: 1,
	submitted: 0,
	bids: ['Bid 01'],
	shots: 2,
	assets: 1
}));

function endpoint(readable: { id: number; name: string }[], code = 'admin') {
	const asked: SitePrincipal[] = [];
	const list = async (principal: SitePrincipal) => {
		asked.push(principal);
		return ON_SITE.filter((r) => principal.projectIds.includes(r.projectId));
	};
	const handler = siteRoute((claim) => verifyProductionSite(claim, { fetch: site(readable, code), allowedHosts: hosts }), listRequestsAcross(list));
	const post = (body: unknown) => handler({ request: new Request('http://localhost/api/production/requests', { method: 'POST', body: JSON.stringify(body) }) });
	return { post, asked };
}

describe('POST /api/production/requests', () => {
	it('lists the requests of the projects the site lists for the person, and names those projects', async () => {
		const { post, asked } = endpoint([
			{ id: 70, name: 'Show' },
			{ id: 91, name: 'Kids Room' },
			{ id: 120, name: 'Empty' }
		]);
		const res = await post({ claim: { siteUrl: SITE, bearer: person } });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.requests.map((r: SiteRequestOverview) => r.projectId)).toEqual([70, 91]);
		expect(body.projects).toEqual([
			{ id: 70, name: 'Show' },
			{ id: 91, name: 'Kids Room' }
		]);
		expect(asked).toEqual([{ kind: 'production-site', siteHost: 'studio.example.com', projectIds: [70, 91, 120] }]);
	});

	it('never lists a project the person cannot read, and ignores every project list the client sends', async () => {
		const { post, asked } = endpoint([{ id: 70, name: 'Show' }]);
		const res = await post({
			claim: { siteUrl: SITE, bearer: person, projectId: 99, projectIds: [99], projects: [{ id: 99, name: 'Hidden' }] },
			projectId: 99,
			projectIds: [99, 91],
			projects: [99]
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.requests.map((r: SiteRequestOverview) => r.id)).toEqual(['r70']);
		expect(body.projects).toEqual([{ id: 70, name: 'Show' }]);
		expect(asked[0].projectIds).toEqual([70]);
	});

	it('holds the role allowlist: an Artist or a Vendor who reads projects is refused, and nothing is listed', async () => {
		for (const code of ['artist', 'vendor']) {
			const { post, asked } = endpoint([{ id: 70, name: 'Show' }], code);
			const res = await post({ claim: { siteUrl: SITE, bearer: person } });
			expect(res.status).toBe(403);
			expect(asked).toEqual([]);
		}
	});

	it('refuses a body with no credential, another site, or no JSON, before listing anything', async () => {
		const { post, asked } = endpoint([{ id: 70, name: 'Show' }]);
		expect((await post({ claim: { siteUrl: SITE } })).status).toBe(401);
		expect((await post({ claim: { siteUrl: 'https://evil.example.com', bearer: person } })).status).toBe(403);
		expect((await post('nope')).status).toBe(400);
		expect(asked).toEqual([]);
	});
});
