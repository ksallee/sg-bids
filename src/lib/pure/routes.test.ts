import { describe, expect, it } from 'vitest';
import { connectHref, projectParam, requestHref, safeNext } from './routes';

describe('safeNext', () => {
	it('keeps a path of this app, with its query', () => {
		expect(safeNext('/bids')).toBe('/bids');
		expect(safeNext('/bids/new?id=abc&view=review')).toBe('/bids/new?id=abc&view=review');
		expect(safeNext('/bids/0de1a1c9-5c87-415a-ba7e-8b15f91ccbd4/compare?project=70')).toBe('/bids/0de1a1c9-5c87-415a-ba7e-8b15f91ccbd4/compare?project=70');
		expect(safeNext('/dev/fpt')).toBe('/dev/fpt');
	});

	it('refuses anything that could leave the site: another origin, a scheme, a protocol-relative or backslash path', () => {
		for (const value of [
			'https://evil.example.com/bids',
			'//evil.example.com/bids',
			'/\\evil.example.com',
			'\\\\evil.example.com',
			'javascript:alert(1)',
			'data:text/html,hi',
			' /bids',
			'/bids\n//evil.example.com',
			'/%2F%2Fevil.example.com',
			'/bids/../../evil'
		]) {
			expect(safeNext(value), value).toBe('/bids');
		}
	});

	it('refuses a path outside the signed-in app: home, connect itself, the vendor pages, the api', () => {
		for (const value of ['/', '/connect', '/connect?next=/bids', '/v', '/v/open', '/api/production/list', '/live/dev-token', '/how']) {
			expect(safeNext(value), value).toBe('/bids');
		}
	});

	it('falls back for nothing at all', () => {
		expect(safeNext(null)).toBe('/bids');
		expect(safeNext(undefined)).toBe('/bids');
		expect(safeNext('')).toBe('/bids');
	});
});

describe('connectHref', () => {
	it('sends to connect with the page to come back to', () => {
		expect(connectHref('/bids/new?id=abc')).toBe('/connect?next=%2Fbids%2Fnew%3Fid%3Dabc');
	});

	it('drops a page it would not come back to', () => {
		expect(connectHref('/bids')).toBe('/connect');
		expect(connectHref('https://evil.example.com')).toBe('/connect');
	});
});

describe('projectParam', () => {
	it('reads a Flow PT project id from the address', () => {
		expect(projectParam(new URLSearchParams('project=70'))).toBe(70);
	});

	it('is null for anything that is not one', () => {
		for (const query of ['', 'project=', 'project=0', 'project=-3', 'project=7.5', 'project=70abc', 'project=1e3', 'project=99999999999999999999']) {
			expect(projectParam(new URLSearchParams(query)), query).toBeNull();
		}
	});
});

describe('requestHref', () => {
	it('opens a draft in the builder and anything else on its page, with its project', () => {
		expect(requestHref({ id: 'r1', status: 'draft', projectId: 70 })).toBe('/bids/new?id=r1&project=70');
		expect(requestHref({ id: 'r2', status: 'issued', projectId: 91 })).toBe('/bids/r2?project=91');
		expect(requestHref({ id: 'r3', status: 'awarded', projectId: 91 })).toBe('/bids/r3?project=91');
	});
});
