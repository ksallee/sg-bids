import { describe, expect, it } from 'vitest';
import { allowedHosts, bearerUser, groupsAnswer, ownGroupCode, productionRoles, projectAnswer, projectsPage, ruleSetAnswer, siteOrigin, tokenAnswer } from './fpt-session';

/** A bearer shaped like the corpus' (027, 052): three segments, the middle one base64url JSON. */
function bearer(claims: Record<string, unknown>): string {
	const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
	return `${part({ alg: 'HS256' })}.${part(claims)}.c2lnbmF0dXJl`;
}

const personClaims = {
	iss: 'studio.example.com',
	aud: 'studio.example.com',
	exp: 1,
	iat: 0,
	jti: 'x',
	user: { type: 'HumanUser', id: 253 },
	sudo_as_login: null,
	auth_type: 'session_token',
	session_uuid: null
};

describe('allowedHosts', () => {
	it('reads a comma list of exact hosts, lower case', () => {
		expect(allowedHosts(' Studio.Example.com, other.example.com ,', undefined)).toEqual(['studio.example.com', 'other.example.com']);
	});

	it('falls back to the host of the default site', () => {
		expect(allowedHosts(undefined, 'https://studio.example.com/')).toEqual(['studio.example.com']);
		expect(allowedHosts('', 'https://studio.example.com')).toEqual(['studio.example.com']);
	});

	it('is empty when neither is set or the default is not a URL', () => {
		expect(allowedHosts(undefined, undefined)).toEqual([]);
		expect(allowedHosts('', 'not a url')).toEqual([]);
	});

	it('keeps a suffix only when written out as `*.` and two labels or more, and drops what is not a host', () => {
		expect(allowedHosts('*.ShotGrid.Autodesk.com, studio.example.com', undefined)).toEqual(['*.shotgrid.autodesk.com', 'studio.example.com']);
		expect(allowedHosts('*, *.com, *.*.example.com, a*.example.com, https://x.example.com, x.example.com:443, ok.example.com', undefined)).toEqual([
			'ok.example.com'
		]);
	});
});

describe('siteOrigin with a suffix', () => {
	const hosts = ['*.shotgrid.autodesk.com'];

	it('allows one label under the suffix, https on the default port', () => {
		expect(siteOrigin('https://mystudio.shotgrid.autodesk.com', hosts)).toEqual({ origin: 'https://mystudio.shotgrid.autodesk.com', host: 'mystudio.shotgrid.autodesk.com' });
		expect(siteOrigin('https://my-studio-2.ShotGrid.autodesk.com/page', hosts)?.host).toBe('my-studio-2.shotgrid.autodesk.com');
	});

	it('holds to the label boundary: not the suffix itself, not two labels, not a look-alike', () => {
		for (const url of [
			'https://shotgrid.autodesk.com',
			'https://a.b.shotgrid.autodesk.com',
			'https://evilshotgrid.autodesk.com',
			'https://x.shotgrid.autodesk.com.evil.net',
			'https://x.shotgrid.autodesk.com.',
			'https://-x.shotgrid.autodesk.com',
			'http://x.shotgrid.autodesk.com',
			'https://x.shotgrid.autodesk.com:8443',
			'https://user:pw@x.shotgrid.autodesk.com',
			'https://169.254.169.254',
			'https://localhost'
		]) {
			expect(siteOrigin(url, hosts), url).toBeNull();
		}
	});
});

describe('siteOrigin', () => {
	const hosts = ['studio.example.com'];

	it('answers the origin and host of an allowed https site', () => {
		expect(siteOrigin('https://studio.example.com', hosts)).toEqual({ origin: 'https://studio.example.com', host: 'studio.example.com' });
		expect(siteOrigin('https://STUDIO.example.com/', hosts)).toEqual({ origin: 'https://studio.example.com', host: 'studio.example.com' });
	});

	it('refuses http, another host, a suffix match, a port or a non-URL (probe 129)', () => {
		expect(siteOrigin('http://studio.example.com', hosts)).toBeNull();
		expect(siteOrigin('https://evil.example.com', hosts)).toBeNull();
		expect(siteOrigin('https://studio.example.com.evil.net', hosts)).toBeNull();
		expect(siteOrigin('https://x.studio.example.com', hosts)).toBeNull();
		expect(siteOrigin('https://studio.example.com:8443', hosts)).toBeNull();
		expect(siteOrigin('https://user@studio.example.com', hosts)).toBeNull();
		expect(siteOrigin('studio.example.com', hosts)).toBeNull();
		expect(siteOrigin(42, hosts)).toBeNull();
	});

	it('refuses every site when nothing is allowed', () => {
		expect(siteOrigin('https://studio.example.com', [])).toBeNull();
	});
});

describe('bearerUser', () => {
	it('reads the user claim of a person (027, 052)', () => {
		expect(bearerUser(bearer(personClaims))).toEqual({ type: 'HumanUser', id: 253 });
	});

	it('reads a script user too, so the caller can refuse it', () => {
		expect(bearerUser(bearer({ ...personClaims, user: { type: 'ApiUser', id: 298 }, auth_type: 'api_key' }))).toEqual({ type: 'ApiUser', id: 298 });
	});

	it('is null for garbage, without throwing', () => {
		expect(bearerUser('')).toBeNull();
		expect(bearerUser('a.b')).toBeNull();
		expect(bearerUser('a.!!!.c')).toBeNull();
		expect(bearerUser(bearer({ user: 'nobody' }))).toBeNull();
		expect(bearerUser(bearer({ user: { type: 'HumanUser', id: '253' } }))).toBeNull();
	});
});

describe('tokenAnswer', () => {
	it('takes the bearer from a 200 (recipe 012)', () => {
		const body = { token_type: 'Bearer', access_token: 'tok', expires_in: 600, refresh_token: 'r' };
		expect(tokenAnswer(200, body)).toEqual({ ok: true, bearer: 'tok' });
	});

	it('reads 400 code 102 as a session to sign in again (126)', () => {
		const body = {
			errors: [{ id: 'u', status: 400, code: 102, title: "Can't authenticate session token ending with '0000'", source: {}, detail: null, meta: null }]
		};
		expect(tokenAnswer(400, body)).toEqual({ ok: false, reason: 'session' });
	});

	it('reads anything else as the site failing', () => {
		expect(tokenAnswer(200, {})).toEqual({ ok: false, reason: 'site' });
		expect(tokenAnswer(500, null)).toEqual({ ok: false, reason: 'site' });
		expect(tokenAnswer(400, { errors: [{ code: 103 }] })).toEqual({ ok: false, reason: 'site' });
	});
});

describe('projectAnswer', () => {
	it('is visible when the site answers the Project row', () => {
		const body = { data: { type: 'Project', attributes: { name: 'Show' }, id: 70, links: { self: '/api/v1/entity/projects/70' } } };
		expect(projectAnswer(200, body, 70)).toBe('visible');
	});

	it('is hidden on a 404: not a member, or no such project (159)', () => {
		const body = { errors: [{ status: 404, code: 104, title: 'Not Found', detail: 'Project: 70 not found' }] };
		expect(projectAnswer(404, body, 70)).toBe('hidden');
	});

	it('is a bad bearer on 401 code 102 (133)', () => {
		const body = { errors: [{ id: 'u', status: 401, code: 102, title: 'Unauthorized', source: null, detail: 'Token Expired', meta: null }] };
		expect(projectAnswer(401, body, 70)).toBe('bearer');
	});

	it('is the site failing on a 200 for another row, or anything else', () => {
		expect(projectAnswer(200, { data: { type: 'Project', id: 71 } }, 70)).toBe('site');
		expect(projectAnswer(200, { data: { type: 'Shot', id: 70 } }, 70)).toBe('site');
		expect(projectAnswer(500, null, 70)).toBe('site');
	});
});

describe('projectsPage', () => {
	const row = (id: number, name: unknown) => ({ type: 'Project', attributes: { name }, id, links: { self: `/api/v1/entity/projects/${id}` } });

	it('reads a page of the Project rows the bearer may see (027: a lower level reads fewer rows)', () => {
		const body = { data: [row(70, 'Show'), row(91, 'Kids Room')], links: { self: '/api/v1/entity/projects?page[number]=1', next: '/api/v1/entity/projects?page[number]=2' } };
		expect(projectsPage(200, body)).toEqual({ projects: [{ id: 70, name: 'Show' }, { id: 91, name: 'Kids Room' }] });
	});

	it('answers an empty page as the end, whatever links.next says (006)', () => {
		expect(projectsPage(200, { data: [], links: { next: '/api/v1/entity/projects?page[number]=3' } })).toEqual({ projects: [] });
	});

	it('names a project with no name by its id, and drops a row that is not a Project', () => {
		expect(projectsPage(200, { data: [row(5, null), { type: 'Shot', id: 6, attributes: {} }, { type: 'Project', id: 'x' }] })).toEqual({ projects: [{ id: 5, name: 'Project 5' }] });
	});

	it('is a bad bearer on 401 code 102 (133), and the site failing on anything else', () => {
		expect(projectsPage(401, { errors: [{ status: 401, code: 102, title: 'Unauthorized' }] })).toBe('bearer');
		expect(projectsPage(500, null)).toBe('site');
		expect(projectsPage(200, { data: 'nope' })).toBe('site');
		expect(projectsPage(200, null)).toBe('site');
	});
});

describe('productionRoles', () => {
	it('defaults to admin and manager', () => {
		expect(productionRoles(undefined)).toEqual(['admin', 'manager']);
		expect(productionRoles('')).toEqual(['admin', 'manager']);
		expect(productionRoles(' , ')).toEqual(['admin', 'manager']);
	});

	it('reads a comma list of group codes, lower case', () => {
		expect(productionRoles(' Admin, producer_plus ,')).toEqual(['admin', 'producer_plus']);
	});
});

/** `GET /entity/human_users/<id>?fields=permission_rule_set`, as a person reads their own row (052, HumanUser card). */
const ownRow = (ruleSet: unknown) => ({
	data: { type: 'HumanUser', id: 253, attributes: {}, relationships: { permission_rule_set: { data: ruleSet, links: {} } }, links: {} }
});

describe('ruleSetAnswer', () => {
	it('reads the permission rule set link off the row', () => {
		expect(ruleSetAnswer(200, ownRow({ id: 8, name: 'Admin', type: 'PermissionRuleSet' }), 253)).toEqual({ id: 8, name: 'Admin' });
	});

	it('takes the link written without `data`, as the HumanUser card prints it', () => {
		const body = { data: { type: 'HumanUser', id: 253, relationships: { permission_rule_set: { id: 8, name: 'Admin', type: 'PermissionRuleSet' } } } };
		expect(ruleSetAnswer(200, body, 253)).toEqual({ id: 8, name: 'Admin' });
	});

	it('is null for another row, an empty link, a refusal or garbage', () => {
		expect(ruleSetAnswer(200, { ...ownRow({ id: 8, name: 'Admin', type: 'PermissionRuleSet' }), data: { type: 'HumanUser', id: 254 } }, 253)).toBeNull();
		expect(ruleSetAnswer(200, ownRow(null), 253)).toBeNull();
		expect(ruleSetAnswer(200, ownRow({ id: 8, name: 'Admin', type: 'Group' }), 253)).toBeNull();
		expect(ruleSetAnswer(404, { errors: [{ status: 404, code: 104 }] }, 253)).toBeNull();
		expect(ruleSetAnswer(200, null, 253)).toBeNull();
	});
});

/** `GET /schema/permission_groups?permission_rule_set_entity_type=HumanUser` (endpoint card, 132, 162). */
const group = (id: string, code: string, display_name: string) => ({ id, code, display_name, entity_type: 'HumanUser', parent_set_id: null, updated_at: 't' });
const ALL = [group('8', 'admin', 'Admin'), group('9', 'manager', 'Manager'), group('10', 'artist', 'Artist'), group('11', 'vendor', 'Vendor'), group('12', 'artist_plus', 'Artist plus')];

describe('groupsAnswer', () => {
	it('reads code, id and display name of each group listed', () => {
		expect(groupsAnswer(200, { data: [group('11', 'vendor', 'Vendor')], links: {} })).toEqual([{ id: '11', code: 'vendor', displayName: 'Vendor' }]);
	});

	it('is null on anything but a 200 with a list', () => {
		expect(groupsAnswer(403, { errors: [] })).toBeNull();
		expect(groupsAnswer(200, { data: {} })).toBeNull();
		expect(groupsAnswer(200, null)).toBeNull();
	});

	it('drops an entry with no code', () => {
		expect(groupsAnswer(200, { data: [{ id: '1', display_name: 'X' }, group('11', 'vendor', 'Vendor')] })).toEqual([{ id: '11', code: 'vendor', displayName: 'Vendor' }]);
	});
});

describe('ownGroupCode', () => {
	const groups = (list: ReturnType<typeof group>[]) => groupsAnswer(200, { data: list })!;

	it('is the one group listed: a person without set_permissions sees only their own (162)', () => {
		expect(ownGroupCode(groups([group('11', 'vendor', 'Vendor')]), null)).toBe('vendor');
		expect(ownGroupCode(groups([group('11', 'vendor', 'Vendor')]), { id: 11, name: 'Vendor' })).toBe('vendor');
	});

	it('picks the person’s own group out of every group an Admin sees, by id or by name', () => {
		expect(ownGroupCode(groups(ALL), { id: 8, name: 'Admin' })).toBe('admin');
		expect(ownGroupCode(groups(ALL), { id: 999, name: 'Manager' })).toBe('manager');
		expect(ownGroupCode(groups(ALL), { id: 11, name: 'Renamed' })).toBe('vendor');
	});

	it('is null when it cannot tell: several groups and no row, no match, two matches, or none listed', () => {
		expect(ownGroupCode(groups(ALL), null)).toBeNull();
		expect(ownGroupCode(groups(ALL), { id: 999, name: 'Nobody' })).toBeNull();
		expect(ownGroupCode(groups([group('8', 'admin', 'Admin'), group('13', 'admin_copy', 'Admin')]), { id: 999, name: 'Admin' })).toBeNull();
		expect(ownGroupCode(groups([group('8', 'admin', 'Admin'), group('9', 'manager', 'Manager')]), { id: 8, name: 'Manager' })).toBeNull();
		expect(ownGroupCode([], { id: 8, name: 'Admin' })).toBeNull();
	});

	it('refuses a single group that is not the row’s', () => {
		expect(ownGroupCode(groups([group('11', 'vendor', 'Vendor')]), { id: 8, name: 'Admin' })).toBeNull();
	});
});
