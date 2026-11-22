import { describe, expect, it } from 'vitest';
import { connectHref, movedRequestPath, projectParam, requestHref, safeNext } from './routes';

describe('safeNext', () => {
	it('keeps a path of this app, with its query', () => {
		expect(safeNext('/requests')).toBe('/requests');
		expect(safeNext('/bids')).toBe('/bids');
		expect(safeNext('/requests')).toBe('/requests');
		expect(safeNext('/requests/new?id=abc&step=vendors')).toBe('/requests/new?id=abc&step=vendors');
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
			expect(safeNext(value), value).toBe('/requests');
		}
	});

	it('refuses a path outside the signed-in app: home, connect itself, the vendor pages, the api', () => {
		for (const value of ['/', '/connect', '/connect?next=/bids', '/v', '/v/open', '/api/production/list', '/live/dev-token', '/how']) {
			expect(safeNext(value), value).toBe('/requests');
		}
	});

	it('falls back for nothing at all', () => {
		expect(safeNext(null)).toBe('/requests');
		expect(safeNext(undefined)).toBe('/requests');
		expect(safeNext('')).toBe('/requests');
	});
});

describe('connectHref', () => {
	it('sends to connect with the page to come back to', () => {
		expect(connectHref('/bids/new?id=abc')).toBe('/connect?next=%2Fbids%2Fnew%3Fid%3Dabc');
	});

	it('drops a page it would not come back to', () => {
		expect(connectHref('/requests')).toBe('/connect');
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
	it('opens every request on its one page, with its project', () => {
		expect(requestHref({ id: 'r1', projectId: 70 })).toBe('/requests/r1?project=70');
		expect(requestHref({ id: 'r2', status: 'issued', projectId: 91 })).toBe('/requests/r2?project=91');
	});
});

describe('movedRequestPath', () => {
	it('sends the old addresses of a request to its page, with the query', () => {
		expect(movedRequestPath('/bids/r1/compare', '?project=70')).toBe('/requests/r1/compare?project=70');
		expect(movedRequestPath('/bids/r1/publish', '')).toBe('/requests/r1/publish');
		expect(movedRequestPath('/bids/new', '?id=r1&project=70')).toBe('/requests/r1?project=70');
		expect(movedRequestPath('/requests/new', '?id=r1&project=70')).toBe('/requests/r1?project=70');
		expect(movedRequestPath('/bids/r1', '?project=70', true)).toBe('/requests/r1?project=70');
	});

	it('sends the Bids pages and the old new request page to the Requests list', () => {
		expect(movedRequestPath('/bids', '')).toBe('/requests');
		expect(movedRequestPath('/bids/', '?project=70')).toBe('/requests');
		expect(movedRequestPath('/bids/new', '?project=70')).toBe('/requests?new=1');
		expect(movedRequestPath('/requests/new', '')).toBe('/requests?new=1');
		expect(movedRequestPath('/bids/b1', '?project=70')).toBe('/requests');
	});

	it('leaves every other path where it is', () => {
		expect(movedRequestPath('/requests', '')).toBeNull();
		expect(movedRequestPath('/requests/r1', '')).toBeNull();
	});
});
