import { describe, expect, it } from 'vitest';
import { allowedHosts, bearerUser, projectAnswer, siteOrigin, tokenAnswer } from './fpt-session';

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
