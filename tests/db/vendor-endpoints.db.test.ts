/**
 * Every vendor endpoint, called as SvelteKit calls it, for a request with two vendors. Vendor A
 * walks every endpoint; nothing of vendor B may appear in any answer: no name, address, id,
 * amount, text or count. The store is the test database's; only `$lib/server/env` is swapped.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashToken } from '$lib/pure/token';
import { createRequests } from '$lib/server/requests';
import type { Store } from '$lib/server/store';
import { draft, issuedWithTwoVendors, rest, store, superuser } from './helpers';
import { browser, jarCookies, keys, type Handler } from './vendor-browser';

const holder = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('$lib/server/env', () => ({ serverStore: () => holder.store }));

const open = await import('../../src/routes/v/[token]/+server');
const openPage = await import('../../src/routes/v/open/+page.server');
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
		const opened = await A.open(open, openPage, a.token);
		expect(opened.status).toBe(303);
		expect(opened.headers.get('location')).toBe('/v');
		expect(A.jar.get('sg_bids_vendor')).toEqual({ value: `${a.invitation.id}.${a.token}`, options: expect.objectContaining({ path: '/v', httpOnly: true, sameSite: 'lax' }) });
		expect(A.jar.has('sg_bids_vendor_open')).toBe(false);

		const request = await A.call(requestRoute.GET as Handler, 'GET', '/v/api/request');
		expect(request.status).toBe(200);
		expect(request.json.shots.map((x: { code: string }) => x.code)).toEqual(['SH010', 'SH020']);
		expect(request.json.vendorName).toBe('Vendor A');
		const me = request.json.invitationId as string;
		expect(me).toBe(a.invitation.id);

		expect((await A.call(bidRoute.GET as Handler, 'GET', '/v/api/bid')).json).toEqual({ bid: null, versions: [] });
		const saved = await A.call(bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { invitationId: me, bidId: null, draft: draft(100_000) });
		expect(saved.status).toBe(200);
		const aBid = saved.json.bid.id as string;
		await A.call(bidRoute.GET as Handler, 'GET', '/v/api/bid');
		expect((await A.call(submitRoute.POST as Handler, 'POST', '/v/api/bid/submit', { invitationId: me, bidId: aBid })).json.bid.status).toBe('submitted');
		expect((await A.call(withdrawRoute.POST as Handler, 'POST', '/v/api/bid/withdraw', { invitationId: me, bidId: aBid })).json.bid.status).toBe('withdrawn');
		const revised = await A.call(reviseRoute.POST as Handler, 'POST', '/v/api/bid/revise', { invitationId: me, bidId: aBid });
		expect(revised.json.bid.version).toBe(2);
		expect(revised.json.versions).toHaveLength(2);
		const v2 = revised.json.bid.id as string;
		await A.call(bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { invitationId: me, bidId: v2, draft: draft(90_000) });

		// A reaching for B's bids by id, and errors of every kind.
		expect((await A.call(submitRoute.POST as Handler, 'POST', '/v/api/bid/submit', { invitationId: me, bidId: b2.id })).status).toBe(404);
		expect((await A.call(withdrawRoute.POST as Handler, 'POST', '/v/api/bid/withdraw', { invitationId: me, bidId: b1.id })).status).toBe(404);
		expect((await A.call(reviseRoute.POST as Handler, 'POST', '/v/api/bid/revise', { invitationId: me, bidId: v2 })).status).toBe(409);
		expect((await A.call(bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { invitationId: me, bidId: v2, draft: { nonsense: true } })).status).toBe(400);
		const smuggled = { invitationId: me, bidId: v2, draft: { ...draft(1), lines: [{ ...draft(1).lines[0], id: b2.id }] } };
		expect((await A.call(bidRoute.PUT as Handler, 'PUT', '/v/api/bid', smuggled)).status).toBe(200);
		const final = await A.call(submitRoute.POST as Handler, 'POST', '/v/api/bid/submit', { invitationId: me, bidId: v2 });
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

		// No list of vendors, no vendor or request id, no count of anything vendor shaped. A's own
		// invitation id goes out once, in the request, for the page to send back.
		const seen = new Set<string>();
		for (const answer of A.answers) keys(answer.json, seen);
		for (const key of ['vendors', 'vendorId', 'vendor', 'invitation', 'requestId', 'projectRef', 'fpt', 'email', 'tokenHash']) {
			expect(seen.has(key), key).toBe(false);
		}
		expect(A.answers.filter((x) => x.text.includes(a.invitation.id))).toEqual([request]);

		// Every API answer is uncacheable and sends no referrer (the hook adds the same to the link routes).
		for (const answer of A.answers.slice(2)) {
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
		const opened = await bad.open(open, openPage, 'not-a-token');
		expect(opened.headers.get('location')).toBe('/v?link=invalid');
		expect(bad.jar.has('sg_bids_vendor')).toBe(false);

		// A token of the right shape that no invitation holds: no cookie, and it counts as a miss.
		const guesser = browser('203.0.113.11');
		const wrong = 'A'.repeat(42) + 'E';
		for (let i = 0; i < 10; i++) {
			const miss = await guesser.open(open, openPage, wrong);
			expect(miss.headers.get('location')).toBe('/v?link=invalid');
		}
		expect(guesser.jar.has('sg_bids_vendor')).toBe(false);
		// A forged cookie misses too.
		guesser.jar.set('sg_bids_vendor', { value: wrong, options: {} });
		for (let i = 0; i < 10; i++) expect((await guesser.call(requestRoute.GET as Handler, 'GET', '/v/api/request')).status).toBe(401);
		const blocked = await guesser.call(requestRoute.GET as Handler, 'GET', '/v/api/request');
		expect(blocked.status).toBe(429);
		expect(blocked.json).toEqual({ error: 'Too many tries. Wait a few minutes.' });
		const held = await guesser.open(open, openPage, wrong);
		expect(held.headers.get('location')).toBe('/v?link=wait');

		// Another address is not held back.
		expect((await bad.call(requestRoute.GET as Handler, 'GET', '/v/api/request')).status).toBe(401);
	});

	it('tell a vendor whose link production replaced, and open its bids with the new link', async () => {
		const { production, a, b } = await issuedWithTwoVendors();
		const A = browser('203.0.113.13');
		await A.open(open, openPage, a.token);
		const me = a.invitation.id;
		const first = await A.call(bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { invitationId: me, bidId: null, draft: draft(100_000) });
		await A.call(submitRoute.POST as Handler, 'POST', '/v/api/bid/submit', { invitationId: me, bidId: first.json.bid.id });
		const revised = await A.call(reviseRoute.POST as Handler, 'POST', '/v/api/bid/revise', { invitationId: me, bidId: first.json.bid.id });
		const second = await A.call(bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { invitationId: me, bidId: revised.json.bid.id, draft: draft(95_000) });
		expect(second.json.bid.version).toBe(2);

		// Production's "New link", the builder's reissue.
		const next = await createRequests(rest('service_role')).reissueInvitation(production, a.invitation.id);

		// The old cookie: every endpoint says the link was replaced, and nothing is written.
		const replaced = 'This link was replaced. Open the newest link production sent you. Your bid is kept.';
		const calls: [Handler, string, string, unknown][] = [
			[requestRoute.GET as Handler, 'GET', '/v/api/request', undefined],
			[bidRoute.GET as Handler, 'GET', '/v/api/bid', undefined],
			[bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { invitationId: me, bidId: second.json.bid.id, draft: draft(1) }],
			[submitRoute.POST as Handler, 'POST', '/v/api/bid/submit', { invitationId: me, bidId: second.json.bid.id }]
		];
		for (const [handler, method, path, body] of calls) {
			const answer = await A.call(handler, method, path, body);
			expect(answer.status, path).toBe(410);
			expect(answer.json).toEqual({ error: replaced });
		}
		// The old link itself no longer opens anything.
		const old = await A.open(open, openPage, a.token);
		expect(old.headers.get('location')).toBe('/v?link=invalid');

		// The new link, in the same browser: the draft and the submitted version are there.
		const opened = await A.open(open, openPage, next.token);
		expect(opened.headers.get('location')).toBe('/v');
		const bid = await A.call(bidRoute.GET as Handler, 'GET', '/v/api/bid');
		expect(bid.json.bid).toMatchObject({ id: second.json.bid.id, version: 2, status: 'draft' });
		expect(bid.json.versions.map((v: { status: string }) => v.status)).toEqual(['submitted', 'draft']);
		expect(bid.json.bid.lines.find((l: { target: { id: string } }) => l.target.id === 'sh010').total.minor).toBe(95_000);

		// A forged cookie naming another vendor's invitation with a dead token learns nothing of it.
		const forger = browser('203.0.113.14');
		forger.jar.set('sg_bids_vendor', { value: `${b.invitation.id}.${a.token}`, options: {} });
		const probe = await forger.call(requestRoute.GET as Handler, 'GET', '/v/api/request');
		expect(probe.status).toBe(410);
		expect(probe.text).not.toContain(b.invitation.name);
		expect(probe.text).not.toContain(b.invitation.id);
	});

	it('refuse a write that is not JSON', async () => {
		const { a } = await issuedWithTwoVendors();
		const A = browser('203.0.113.12');
		await A.open(open, openPage, a.token);
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
