/**
 * The two launcher endpoints take no sign-in, so they call only an allowlisted Flow PT host, the
 * same list the production check uses, and follow no redirect. The site is faked; no network.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/env', () => ({ fptSiteHosts: () => ['studio.example.com', '*.shotgrid.autodesk.com'] }));

const request = await import('./session-request/+server');
const poll = await import('./session-poll/+server');

const calls: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
	calls.length = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(input), init });
			if (init?.method === 'POST') return Response.json({ sessionRequestId: 'abc', url: 'https://studio.example.com/app_session_request/abc' });
			return Response.json({ approved: false });
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function post(handler: unknown, body: unknown): Promise<Response> {
	const req = new Request('http://localhost:5181/live/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	return (handler as (event: RequestEvent) => Promise<Response>)({ request: req } as RequestEvent);
}

const refused = [
	'https://169.254.169.254',
	'https://localhost',
	'https://evil.example.com',
	'https://studio.example.com:8443',
	'https://studio.example.com.evil.net',
	'https://a.b.shotgrid.autodesk.com',
	'http://studio.example.com'
];

describe('the launcher endpoints', () => {
	it('forward to an allowed site, and refuse to follow a redirect', async () => {
		expect((await post(request.POST, { siteUrl: 'https://studio.example.com' })).status).toBe(200);
		expect((await post(poll.POST, { siteUrl: 'https://mystudio.shotgrid.autodesk.com', id: 'abc' })).status).toBe(200);
		expect(calls.map((c) => c.url)).toEqual([
			'https://studio.example.com/internal_api/app_session_request',
			'https://mystudio.shotgrid.autodesk.com/internal_api/app_session_request/abc'
		]);
		for (const call of calls) expect(call.init?.redirect, call.url).toBe('error');
	});

	it.each(refused)('call nothing for %s', async (siteUrl) => {
		const a = await post(request.POST, { siteUrl });
		const b = await post(poll.POST, { siteUrl, id: 'abc' });
		expect(a.status).toBe(403);
		expect(b.status).toBe(403);
		expect(await a.json()).toEqual({ message: 'This app does not serve that site.' });
		expect(calls).toHaveLength(0);
	});
});
