/**
 * One browser, two vendors' links. Vendor B gets vendor A to open B's link while A has its own bid
 * open. B's link must not quietly take A's browser over: A is asked, by name, and only a same-origin
 * post switches. And when the browser does switch, A's tab still open on A's bid writes nothing
 * into B's: every write names the invitation and bid the page loaded, and a mismatch is a 409.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Store } from '$lib/server/store';
import { draft, forVendor, issuedWithTwoVendors, store, superuser, vendorIds } from './helpers';
import { browser, type Handler } from './vendor-browser';

const holder = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('$lib/server/env', () => ({ serverStore: () => holder.store }));

const openRoute = await import('../../src/routes/v/[token]/+server');
const openPage = await import('../../src/routes/v/open/+page.server');
const requestRoute = await import('../../src/routes/v/api/request/+server');
const bidRoute = await import('../../src/routes/v/api/bid/+server');
const submitRoute = await import('../../src/routes/v/api/bid/submit/+server');
const withdrawRoute = await import('../../src/routes/v/api/bid/withdraw/+server');
const reviseRoute = await import('../../src/routes/v/api/bid/revise/+server');

const sql = superuser();
const COOKIE = 'sg_bids_vendor';

/** A draft as the vendor's page would send it for this request: lines on the vendor's item ids. */
async function drafts(requestId: string) {
	const ids = await vendorIds(sql, requestId);
	return Object.assign((total: number) => forVendor(draft(total), ids), { ids });
}

beforeAll(() => {
	holder.store = store();
});

afterAll(async () => {
	await sql.end();
});

describe('a vendor link opened where another vendor bid is open', () => {
	it('opens at once in a browser with no link, and names the vendor on the form', async () => {
		const { a } = await issuedWithTwoVendors();
		const A = browser('203.0.113.40');
		const opened = await A.open(openRoute, openPage, a.token);
		expect(opened.status).toBe(303);
		expect(opened.headers.get('location')).toBe('/v');
		expect(A.jar.get(COOKIE)?.value).toBe(`${a.invitation.id}.${a.token}`);
		const request = await A.call(requestRoute.GET as Handler, 'GET', '/v/api/request');
		expect(request.json.vendorName).toBe('Vendor A');
		expect(request.json.invitationId).toBe(a.invitation.id);
		// Opening the same link again asks nothing.
		expect((await A.open(openRoute, openPage, a.token)).headers.get('location')).toBe('/v');
	});

	it('touches nothing before it is asked: the link route does no lookup and sets no vendor cookie', async () => {
		const { a } = await issuedWithTwoVendors();
		const A = browser('203.0.113.41');
		const first = await A.call(openRoute.GET as Handler, 'GET', `/v/${a.token}`, undefined, { token: a.token });
		expect(first.status).toBe(303);
		expect(first.headers.get('location')).toBe('/v/open');
		expect(A.jar.has(COOKIE)).toBe(false);
		const [row] = await sql`select last_opened_at from public.invitations where id = ${a.invitation.id}`;
		expect(row.last_opened_at).toBeNull();
	});

	it('asks before B replaces A, keeps A on a cross-site post or on keep, and switches on a same-origin post', async () => {
		const { a, b } = await issuedWithTwoVendors();
		const A = browser('203.0.113.42');
		await A.open(openRoute, openPage, a.token);
		const mine = `${a.invitation.id}.${a.token}`;

		// B's link in A's browser: a question naming both, and A's cookie as it was.
		const asked = await A.open(openRoute, openPage, b.token);
		expect(asked.status).toBe(200);
		expect(asked.json).toEqual({ next: 'Vendor B', current: 'Vendor A' });
		expect(A.jar.get(COOKIE)?.value).toBe(mine);

		// A post from another site, or with no origin, changes nothing.
		expect((await A.action(openPage.actions.switch, '/v/open?/switch', 'https://evil.example.com')).status).toBe(403);
		expect((await A.action(openPage.actions.switch, '/v/open?/switch', null)).status).toBe(403);
		expect(A.jar.get(COOKIE)?.value).toBe(mine);

		// Keep: A stays, the pending link is dropped.
		const kept = await A.action(openPage.actions.keep, '/v/open?/keep');
		expect(kept.headers.get('location')).toBe('/v');
		expect(A.jar.get(COOKIE)?.value).toBe(mine);
		expect((await A.action(openPage.actions.switch, '/v/open?/switch')).headers.get('location')).toBe('/v');
		expect(A.jar.get(COOKIE)?.value).toBe(mine);

		// Asked again, A says yes, from this origin: now B's bid is open.
		await A.open(openRoute, openPage, b.token);
		const switched = await A.action(openPage.actions.switch, '/v/open?/switch');
		expect(switched.headers.get('location')).toBe('/v');
		expect(A.jar.get(COOKIE)?.value).toBe(`${b.invitation.id}.${b.token}`);
	});

	it('does not ask when the link open in the browser no longer works', async () => {
		const { a, b } = await issuedWithTwoVendors();
		const A = browser('203.0.113.43');
		A.jar.set(COOKIE, { value: `${a.invitation.id}.${'A'.repeat(42)}E`, options: {} });
		expect((await A.open(openRoute, openPage, b.token)).headers.get('location')).toBe('/v');
		expect(A.jar.get(COOKIE)?.value).toBe(`${b.invitation.id}.${b.token}`);
	});

	it('refuses every write from A’s tab once the browser holds B’s link, and leaves B’s bid as it was', async () => {
		const { a, b, request } = await issuedWithTwoVendors();
		const vd = await drafts(request.id);
		const s = holder.store as Store;
		const bDraft = await s.saveDraftBid(b.token, draft(500_000));

		// A's tab: loaded on A's link, with A's draft saved.
		const tab = browser('203.0.113.44');
		await tab.open(openRoute, openPage, a.token);
		const page = (await tab.call(requestRoute.GET as Handler, 'GET', '/v/api/request')).json;
		const saved = await tab.call(bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { invitationId: page.invitationId, bidId: null, draft: vd(100_000) });
		expect(saved.status).toBe(200);
		const aBid = saved.json.bid.id as string;

		// The browser now holds B's link (B tricked A into switching).
		await tab.open(openRoute, openPage, b.token);
		await tab.action(openPage.actions.switch, '/v/open?/switch');

		// A's tab keeps going with what it loaded: every write is refused, with a reason.
		const writes: [Handler, string, string, unknown][] = [
			[bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { invitationId: page.invitationId, bidId: aBid, draft: vd(1) }],
			[bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { invitationId: page.invitationId, bidId: bDraft.id, draft: vd(1) }],
			[submitRoute.POST as Handler, 'POST', '/v/api/bid/submit', { invitationId: page.invitationId, bidId: aBid }],
			[submitRoute.POST as Handler, 'POST', '/v/api/bid/submit', { invitationId: page.invitationId, bidId: bDraft.id }],
			[withdrawRoute.POST as Handler, 'POST', '/v/api/bid/withdraw', { invitationId: page.invitationId, bidId: bDraft.id }],
			[reviseRoute.POST as Handler, 'POST', '/v/api/bid/revise', { invitationId: page.invitationId, bidId: aBid }]
		];
		for (const [handler, method, path, body] of writes) {
			const answer = await tab.call(handler, method, path, body);
			expect(answer.status, path).toBe(409);
			expect(answer.json).toEqual({ error: 'Another bid is open in this browser now. Reload the page to see whose.', reason: 'session' });
		}
		// A write that names no invitation is refused too.
		expect((await tab.call(bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { draft: vd(1) })).status).toBe(400);
		expect((await tab.call(submitRoute.POST as Handler, 'POST', '/v/api/bid/submit', { bidId: bDraft.id })).status).toBe(400);

		// B's draft is as B left it, still a draft, with B's amounts.
		const [row] = await sql`select status, updated_at from public.bids where id = ${bDraft.id}`;
		expect(row.status).toBe('draft');
		const lines = await sql`select total_minor from public.bid_lines where bid_id = ${bDraft.id} and item_key = 'sh010'`;
		expect(Number(lines[0].total_minor)).toBe(500_000);
		// And a reload shows B's name, so the switch is plain to see.
		expect((await tab.call(requestRoute.GET as Handler, 'GET', '/v/api/request')).json.vendorName).toBe('Vendor B');
	});

	it('refuses a write for a bid the page did not load: another tab moved on', async () => {
		const { a, request } = await issuedWithTwoVendors();
		const vd = await drafts(request.id);
		const A = browser('203.0.113.45');
		await A.open(openRoute, openPage, a.token);
		const page = (await A.call(requestRoute.GET as Handler, 'GET', '/v/api/request')).json;
		const first = await A.call(bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { invitationId: page.invitationId, bidId: null, draft: vd(100_000) });
		const v1 = first.json.bid.id as string;
		// A tab that loaded before the first save still says no bid: refused.
		const stale = await A.call(bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { invitationId: page.invitationId, bidId: null, draft: vd(1) });
		expect(stale.status).toBe(409);
		expect(stale.json.reason).toBe('bid');
		await A.call(submitRoute.POST as Handler, 'POST', '/v/api/bid/submit', { invitationId: page.invitationId, bidId: v1 });
		// After the submit, a save naming v1 would open a version the page never saw: refused.
		expect((await A.call(bidRoute.PUT as Handler, 'PUT', '/v/api/bid', { invitationId: page.invitationId, bidId: v1, draft: vd(1) })).status).toBe(409);
		const revised = await A.call(reviseRoute.POST as Handler, 'POST', '/v/api/bid/revise', { invitationId: page.invitationId, bidId: v1 });
		expect(revised.status).toBe(200);
		expect(revised.json.bid.version).toBe(2);
		// Revise again from the same stale page: v2 is the latest now.
		expect((await A.call(reviseRoute.POST as Handler, 'POST', '/v/api/bid/revise', { invitationId: page.invitationId, bidId: v1 })).status).toBe(409);
	});
});
