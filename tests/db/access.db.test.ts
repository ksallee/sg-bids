/**
 * Every data-access function, held to its principal: a tenant reaches only its own rows, a vendor
 * token only its own invitation, the frozen request and its own bids.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { TABLES } from '$lib/pure/access';
import { hashToken } from '$lib/pure/token';
import { draft, header, issuedWithTwoVendors, items, refusal, store, superuser, tenant, vendor } from './helpers';

const sql = superuser();

afterAll(async () => {
	await sql.end();
});

describe('a tenant', () => {
	it('reaches none of another tenant’s rows through any function', async () => {
		const { s, production, request, a } = await issuedWithTwoVendors();
		const bid = await s.saveDraftBid(a.token, draft(100_000));
		await s.submitBid(a.token, bid.id);
		const draftRequest = await s.createDraftRequest(production, { code: 'BR-2', header: header(), items: items() });

		const otherProject = tenant(production.siteHost);
		const otherSite = tenant(undefined, production.projectId);
		for (const other of [otherProject, otherSite]) {
			expect(await s.listRequests(other)).toEqual([]);
			expect((await refusal(() => s.getRequest(other, request.id))).status).toBe(404);
			expect((await refusal(() => s.listBids(other, request.id))).status).toBe(404);
			expect((await refusal(() => s.updateDraftRequest(other, draftRequest.id, { header: header({ title: 'STOLEN' }) }))).status).toBe(404);
			expect((await refusal(() => s.updateDraftRequest(other, draftRequest.id, { items: { shots: [], assets: [] } }))).status).toBe(404);
			expect((await refusal(() => s.issueRequest(other, draftRequest.id))).status).toBe(404);
			expect((await refusal(() => s.inviteVendor(other, request.id, vendor('Intruder')))).status).toBe(404);
			expect((await refusal(() => s.revokeInvitation(other, a.invitation.id))).status).toBe(404);
			const scenario = await refusal(() =>
				s.saveScenario(other, request.id, { name: 'Stolen', picks: [{ target: { kind: 'shot', id: 'sh010' }, shares: [{ bidId: bid.id, percent: '100' }] }] })
			);
			expect(scenario.status).toBe(404);
		}

		// Untouched.
		const mine = await s.getRequest(production, draftRequest.id);
		expect(mine.shots).toHaveLength(2);
		expect((await s.listRequests(production)).map((r) => r.code).sort()).toEqual(['BR-1', 'BR-2']);
		const [{ n }] = await sql`select count(*)::int as n from public.invitations where request_id = ${request.id} and revoked_at is null`;
		expect(n).toBe(2);
	});

	it('cannot hang a row under another tenant’s parent, even with the secret key', async () => {
		const { production, request } = await issuedWithTwoVendors();
		const other = tenant();
		const error = await refusal(
			() => sql`insert into public.award_scenarios (request_id, site_host, project_id, name)
				values (${request.id}, ${other.siteHost}, ${other.projectId}, 'cross')`
		);
		expect((error as { code?: string }).code).toBe('23503');
		expect(production.siteHost).not.toBe(other.siteHost);
	});
});

describe('a vendor token', () => {
	it('opens its own invitation, the frozen request and its own bids, nothing of the other vendor', async () => {
		const { s, a, b } = await issuedWithTwoVendors();
		const bidA = await s.saveDraftBid(a.token, draft(100_000));
		await s.submitBid(a.token, bidA.id);
		const bidB = await s.saveDraftBid(b.token, draft(90_000));
		await s.submitBid(b.token, bidB.id);

		const view = await s.openInvitation(a.token);
		expect(view.invitation.id).toBe(a.invitation.id);
		expect(view.invitation.name).toBe('Vendor A');
		expect(view.request.vendors).toEqual([view.invitation]);
		expect(view.request.shots.map((shot) => shot.id)).toEqual(['sh010', 'sh020']);
		expect(view.bids.map((bid) => bid.id)).toEqual([bidA.id]);
		expect(view.bids.every((bid) => bid.vendorId === a.invitation.id)).toBe(true);

		// Not a name, an id, an address or an amount of B's anywhere in what A gets.
		const text = JSON.stringify(view);
		for (const secret of [b.invitation.id, b.invitation.name, b.invitation.email, bidB.id, b.token, '90000', '180000', hashToken(b.token)]) {
			expect(text).not.toContain(secret);
		}
		expect(text).not.toContain(hashToken(a.token));
	});

	it('cannot submit, or reach through a save, the other vendor’s bid', async () => {
		const { s, a, b } = await issuedWithTwoVendors();
		const bidB = await s.saveDraftBid(b.token, draft(90_000));
		const before = await sql`select * from public.bids where id = ${bidB.id}`;

		expect((await refusal(() => s.submitBid(a.token, bidB.id))).status).toBe(404);
		const saved = await s.saveDraftBid(a.token, { ...draft(1), number: 'A' });
		expect(saved.id).not.toBe(bidB.id);
		expect(saved.vendorId).toBe(a.invitation.id);

		expect(await sql`select * from public.bids where id = ${bidB.id}`).toEqual(before);
		const [{ n }] = await sql`select count(*)::int as n from public.bid_lines where bid_id = ${bidB.id} and total_minor = 90000`;
		expect(n).toBe(1);
	});

	it('opens a new version after a submit, and production sees only submitted bids', async () => {
		const { s, production, request, a, b } = await issuedWithTwoVendors();
		const first = await s.saveDraftBid(a.token, draft(100_000));
		await s.submitBid(a.token, first.id);
		const second = await s.saveDraftBid(a.token, draft(95_000));
		expect(second.id).not.toBe(first.id);
		const [{ version }] = await sql`select version from public.bids where id = ${second.id}`;
		expect(version).toBe(2);
		await s.saveDraftBid(b.token, draft(80_000));

		const seen = await s.listBids(production, request.id);
		expect(seen.map((x) => [x.vendor.name, x.bid.id, x.bid.status])).toEqual([['Vendor A', first.id, 'submitted']]);
	});

	it('is refused before the request is issued', async () => {
		const s = store();
		const production = tenant();
		const request = await s.createDraftRequest(production, { code: 'BR-1', header: header(), items: items() });
		const invited = await s.inviteVendor(production, request.id, vendor('Early'));
		expect((await refusal(() => s.openInvitation(invited.token))).status).toBe(403);
		expect((await refusal(() => s.saveDraftBid(invited.token, draft(1)))).status).toBe(403);
	});

	it('is refused once expired, through every vendor function', async () => {
		const s = store();
		const production = tenant();
		const request = await s.createDraftRequest(production, { code: 'BR-1', header: header(), items: items() });
		const live = await s.inviteVendor(production, request.id, vendor('Live'));
		const old = await s.inviteVendor(production, request.id, vendor('Old'), new Date(Date.now() - 1000));
		await s.issueRequest(production, request.id);
		const bid = await s.saveDraftBid(live.token, draft(1));

		expect((await refusal(() => s.openInvitation(old.token))).status).toBe(403);
		expect((await refusal(() => s.saveDraftBid(old.token, draft(1)))).status).toBe(403);

		// The clock moves past the live one's expiry: refused too.
		const later = store({ now: () => new Date(Date.parse(live.expiresAt) + 1) });
		expect((await refusal(() => later.openInvitation(live.token))).status).toBe(403);
		expect((await refusal(() => later.submitBid(live.token, bid.id))).status).toBe(403);
	});

	it('is refused once revoked, and the database refuses its writes too', async () => {
		const { s, production, a } = await issuedWithTwoVendors();
		const bid = await s.saveDraftBid(a.token, draft(1));
		await s.revokeInvitation(production, a.invitation.id);
		expect((await refusal(() => s.openInvitation(a.token))).status).toBe(403);
		expect((await refusal(() => s.saveDraftBid(a.token, draft(2)))).status).toBe(403);
		expect((await refusal(() => s.submitBid(a.token, bid.id))).status).toBe(403);
		const error = await refusal(() => sql`update public.bids set status = 'submitted' where id = ${bid.id}`);
		expect(error.message).toMatch(/revoked or expired/);
	});

	it('is refused when malformed or unknown, with one answer', async () => {
		const s = store();
		for (const token of ['', 'short', 'A'.repeat(42) + 'B', 'A'.repeat(43), undefined, 42]) {
			const error = await refusal(() => s.openInvitation(token));
			expect(error.status).toBe(401);
			expect(error.message).toBe('This link is not valid.');
		}
	});

	it('is stored as its SHA-256 hash only, never as the token', async () => {
		const { a, b } = await issuedWithTwoVendors();
		for (const invited of [a, b]) {
			const [row] = await sql`select token_hash from public.invitations where id = ${invited.invitation.id}`;
			expect(row.token_hash).toBe(hashToken(invited.token));
			expect(row.token_hash).not.toBe(invited.token);
			for (const table of TABLES) {
				const [{ n }] = await sql.unsafe(`select count(*)::int as n from public.${table} t where t::text like '%' || $1 || '%'`, [invited.token]);
				expect(n, table).toBe(0);
			}
		}
	});
});
