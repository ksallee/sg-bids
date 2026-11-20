/**
 * Every vendor endpoint, called as SvelteKit calls it, for a request with two vendors. Vendor A
 * walks every endpoint; nothing of vendor B may appear in any answer: no name, address, id,
 * amount, text or count. The store is the test database's; only `$lib/server/env` is swapped.
 */
import { isRedirect, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashToken } from '$lib/pure/token';
import type { Store } from '$lib/server/store';
import { draft, issuedWithTwoVendors, store, superuser } from './helpers';

const holder = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('$lib/server/env', () => ({ serverStore: () => holder.store }));

const open = await import('../../src/routes/v/[token]/+server');
const requestRoute = await import('../../src/routes/v/api/request/+server');
const bidRoute = await import('../../src/routes/v/api/bid/+server');
const submitRoute = await import('../../src/routes/v/api/bid/submit/+server');
const withdrawRoute = await import('../../src/routes/v/api/bid/withdraw/+server');
const reviseRoute = await import('../../src/routes/v/api/bid/revise/+server');

const sql = superuser();

beforeAll(() => {
	holder.store = store();
});

afterAll(async () => {
	await sql.end();
});

type Handler = (event: RequestEvent) => Response | Promise<Response>;

function jarCookies(jar: Map<string, { value: string; options: Record<string, unknown> }>): Cookies {
	return {
		get: (name: string) => jar.get(name)?.value,
		getAll: () => [...jar].map(([name, { value }]) => ({ name, value })),
		set: (name: string, value: string, options: Record<string, unknown>) => void jar.set(name, { value, options }),
		delete: (name: string) => void jar.delete(name),
		serialize: () => ''
	} as unknown as Cookies;
}

interface Answer {
	status: number;
	headers: Headers;
	text: string;
	json: any;
}

/** One vendor's browser: a cookie jar and an address. */
function browser(address = '203.0.113.1') {
	const jar = new Map<string, { value: string; options: Record<string, unknown> }>();
	const answers: Answer[] = [];

	async function call(handler: Handler, method: string, path: string, body?: unknown, params: Record<string, string> = {}): Promise<Answer> {
		const url = new URL(`http://localhost:5181${path}`);
		const init: RequestInit = { method };
		if (body !== undefined) {
			init.headers = { 'content-type': 'application/json' };
			init.body = JSON.stringify(body);
		}
		const event = { request: new Request(url, init), url, params, cookies: jarCookies(jar), getClientAddress: () => address } as unknown as RequestEvent;
		let res: Response;
		try {
			res = await handler(event);
		} catch (thrown) {
			if (!isRedirect(thrown)) throw thrown;
			res = new Response(null, { status: thrown.status, headers: { location: thrown.location } });
		}
		const text = await res.text();
		const answer = { status: res.status, headers: res.headers, text, json: text ? JSON.parse(text) : null };
		answers.push(answer);
		return answer;
	}

	return { jar, answers, call };
}

/** Every key anywhere in a JSON value. */
function keys(value: unknown, into = new Set<string>()): Set<string> {
	if (Array.isArray(value)) value.forEach((v) => keys(v, into));
	else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			into.add(k);
			keys(v, into);
		}
	}
	return into;
}

describe('the vendor endpoints', () => {
	it('answer vendor A with nothing of vendor B, through every endpoint and every state', async () => {
		const { a, b } = await issuedWithTwoVendors();
		const s = holder.store as Store;

		// Vendor B bids with amounts, texts and versions of its own.
		const bOnly = {
			...draft(7_777_777),
			number: 'B-SECRET-NUMBER',
			assumptions: ['B secret assumption'],
			lines: draft(7_777_777).lines.map((l) => ({ ...l, notes: 'B secret note', methodology: 'B secret method' }))
		};
		const b1 = await s.saveDraftBid(b.token, bOnly);
		await s.submitBid(b.token, b1.id);
		const b2 = await s.saveDraftBid(b.token, { ...bOnly, lines: bOnly.lines.map((l) => ({ ...l, total: { ...l.total, minor: 6_666_666 } })) });
		const bLines = (await sql`select id from public.bid_lines where invitation_id = ${b.invitation.id}`).map((r) => r.id as string);

		// Vendor A walks every endpoint.
		const A = browser();
		const opened = await A.call(open.GET as Handler, 'GET', `/v/${a.token}`, undefined, { token: a.token });
		expect(opened.status).toBe(303);
		expect(opened.headers.get('location')).toBe('/v');
		expect(A.jar.get('sg_bids_vendor')).toEqual({ value: a.token, options: expect.objectContaining({ path: '/v', httpOnly: true, sameSite: 'lax' }) });

		const request = await A.call(requestRoute.GET as Handler, 'GET', '/v/api/request');
		expect(request.status).toBe(200);
		expect(request.json.shots.map((x: { id: string }) => x.id)).toEqual(['sh010', 'sh020']);

		expect((await A.call(bidRoute.GET as Handler, 'GET', '/v/api/bid')).json).toEqual({ bid: null, versions: [] });
		const saved = await A.call(bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { draft: draft(100_000) });
		expect(saved.status).toBe(200);
		const aBid = saved.json.bid.id as string;
		await A.call(bidRoute.GET as Handler, 'GET', '/v/api/bid');
		expect((await A.call(submitRoute.POST as Handler, 'POST', '/v/api/bid/submit', { bidId: aBid })).json.bid.status).toBe('submitted');
		expect((await A.call(withdrawRoute.POST as Handler, 'POST', '/v/api/bid/withdraw', { bidId: aBid })).json.bid.status).toBe('withdrawn');
		const revised = await A.call(reviseRoute.POST as Handler, 'POST', '/v/api/bid/revise', {});
		expect(revised.json.bid.version).toBe(2);
		expect(revised.json.versions).toHaveLength(2);
		await A.call(bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { draft: draft(90_000) });

		// A reaching for B's bids by id, and errors of every kind.
		expect((await A.call(submitRoute.POST as Handler, 'POST', '/v/api/bid/submit', { bidId: b2.id })).status).toBe(404);
		expect((await A.call(withdrawRoute.POST as Handler, 'POST', '/v/api/bid/withdraw', { bidId: b1.id })).status).toBe(404);
		expect((await A.call(reviseRoute.POST as Handler, 'POST', '/v/api/bid/revise', {})).status).toBe(409);
		expect((await A.call(bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { draft: { nonsense: true } })).status).toBe(400);
		const smuggled = { draft: { ...draft(1), lines: [{ ...draft(1).lines[0], id: b2.id }] } };
		expect((await A.call(bidRoute.PUT as Handler, 'PUT', '/v/api/bid', smuggled)).status).toBe(200);
		const final = await A.call(submitRoute.POST as Handler, 'POST', '/v/api/bid/submit', { bidId: revised.json.bid.id });
		expect(final.json.bid.status).toBe('submitted');

		// Nothing of B anywhere: names, addresses, ids, amounts, texts, the token and its hash.
		const secrets = [
			b.invitation.id,
			b.invitation.name,
			b.invitation.email,
			b.token,
			hashToken(b.token),
			b1.id,
			b2.id,
			...bLines,
			'7777777',
			'6666666',
			'15555554',
			'13333332',
			'B-SECRET-NUMBER',
			'B secret'
		];
		const everything = A.answers.map((x) => `${x.text}\n${[...x.headers].join('\n')}`).join('\n');
		for (const secret of secrets) expect(everything, secret).not.toContain(secret);

		// No list of vendors, no vendor or request id, no invitation id, no count of anything vendor shaped.
		const seen = new Set<string>();
		for (const answer of A.answers) keys(answer.json, seen);
		for (const key of ['vendors', 'vendorId', 'vendor', 'invitationId', 'invitation', 'requestId', 'projectRef', 'fpt', 'email', 'tokenHash']) {
			expect(seen.has(key), key).toBe(false);
		}
		expect(everything).not.toContain(a.invitation.id);

		// Every answer is uncacheable and sends no referrer.
		for (const answer of A.answers.slice(1)) {
			expect(answer.headers.get('cache-control')).toBe('no-store');
			expect(answer.headers.get('referrer-policy')).toBe('no-referrer');
		}

		// And B's rows are as B left them.
		const [row] = await sql`select status from public.bids where id = ${b2.id}`;
		expect(row.status).toBe('draft');
	});

	it('refuse a browser with no link, a bad link, and a guesser after twenty misses', async () => {
		const none = browser('203.0.113.9');
		expect((await none.call(requestRoute.GET as Handler, 'GET', '/v/api/request')).status).toBe(401);

		const bad = browser('203.0.113.10');
		const opened = await bad.call(open.GET as Handler, 'GET', '/v/not-a-token', undefined, { token: 'not-a-token' });
		expect(opened.headers.get('location')).toBe('/v?link=invalid');
		expect(bad.jar.has('sg_bids_vendor')).toBe(false);

		const guesser = browser('203.0.113.11');
		const wrong = 'A'.repeat(42) + 'E';
		await guesser.call(open.GET as Handler, 'GET', `/v/${wrong}`, undefined, { token: wrong });
		for (let i = 0; i < 20; i++) expect((await guesser.call(requestRoute.GET as Handler, 'GET', '/v/api/request')).status).toBe(401);
		const blocked = await guesser.call(requestRoute.GET as Handler, 'GET', '/v/api/request');
		expect(blocked.status).toBe(429);
		expect(blocked.json).toEqual({ error: 'Too many tries. Wait a few minutes.' });

		// Another address is not held back.
		expect((await bad.call(requestRoute.GET as Handler, 'GET', '/v/api/request')).status).toBe(401);
	});

	it('refuse a write that is not JSON', async () => {
		const { a } = await issuedWithTwoVendors();
		const A = browser('203.0.113.12');
		await A.call(open.GET as Handler, 'GET', `/v/${a.token}`, undefined, { token: a.token });
		const url = new URL('http://localhost:5181/v/api/bid');
		const event = {
			request: new Request(url, { method: 'PUT', body: 'draft=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
			url,
			params: {},
			cookies: jarCookies(A.jar),
			getClientAddress: () => '203.0.113.12'
		} as unknown as RequestEvent;
		expect((await (bidRoute.PUT as Handler)(event)).status).toBe(415);
	});
});
