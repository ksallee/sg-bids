/**
 * Production's overview reads and the link re-issue (`src/lib/server/requests.ts`): counts per
 * request, invitation states, a new link that retires the old one and keeps the bids, and none of
 * it across tenants.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createRequests } from '$lib/server/requests';
import { draft, header, issuedWithTwoVendors, items, refusal, rest, store, superuser, tenant } from './helpers';

const sql = superuser();
const requests = () => createRequests(rest('service_role'));

afterAll(async () => {
	await sql.end();
});

describe('listOverview', () => {
	it('lists the project’s requests with live invitations and vendors who submitted', async () => {
		const { s, production, request, a, b } = await issuedWithTwoVendors();
		const bid = await s.saveDraftBid(a.token, draft(100_000));
		await s.submitBid(a.token, bid.id);
		await s.saveDraftBid(b.token, draft(90_000));
		await s.revokeInvitation(production, b.invitation.id);
		const second = await s.createDraftRequest(production, { code: 'BR-2', header: header({ title: 'Second' }), items: items() });

		const overview = await requests().listOverview(production);
		expect(overview.map((r) => r.code)).toEqual(['BR-2', 'BR-1']);
		const first = overview.find((r) => r.id === request.id)!;
		expect(first).toMatchObject({ status: 'issued', round: 1, dueDate: '2026-12-15', invited: 1, submitted: 1 });
		expect(first.issuedAt).not.toBeNull();
		expect(overview.find((r) => r.id === second.id)).toMatchObject({ status: 'draft', title: 'Second', invited: 0, submitted: 0 });
	});

	it('shows another tenant nothing', async () => {
		const { production } = await issuedWithTwoVendors();
		expect(await requests().listOverview(tenant(production.siteHost))).toEqual([]);
		expect(await requests().listOverview(tenant(undefined, production.projectId))).toEqual([]);
	});
});

describe('requestMeta', () => {
	it('gives the status, the code and the issue stamp, to its own tenant only', async () => {
		const { production, request } = await issuedWithTwoVendors();
		const meta = await requests().requestMeta(production, request.id);
		expect(meta.status).toBe('issued');
		// The next round keeps the code: it is on the row, never in the stored header.
		expect(meta.code).toBe('BR-1');
		expect(meta.issuedAt).not.toBeNull();
		expect((await refusal(() => requests().requestMeta(tenant(production.siteHost), request.id))).status).toBe(404);
	});
});

describe('listInvitations', () => {
	it('gives each invitation its state; a vendor’s draft reads as opened', async () => {
		const { s, production, request, a, b } = await issuedWithTwoVendors();
		await s.openInvitation(b.token);
		await s.saveDraftBid(b.token, draft(90_000));
		const bid = await s.saveDraftBid(a.token, draft(100_000));
		await s.submitBid(a.token, bid.id);

		const list = await requests().listInvitations(production, request.id);
		expect(list.map((i) => i.vendor.name)).toEqual(['Vendor A', 'Vendor B']);
		expect(list[0].state).toMatchObject({ kind: 'submitted', version: 1 });
		expect(list[1].state.kind).toBe('opened');
		expect(list[0].vendor.fpt).toEqual({ type: 'Group', id: 7 });
	});

	it('refuses another tenant', async () => {
		const { production, request } = await issuedWithTwoVendors();
		expect((await refusal(() => requests().listInvitations(tenant(production.siteHost), request.id))).status).toBe(404);
	});
});

describe('reissueInvitation', () => {
	it('retires the old link, works on a revoked invitation, and keeps the vendor’s bids', async () => {
		const { s, production, a } = await issuedWithTwoVendors();
		const bid = await s.saveDraftBid(a.token, draft(100_000));
		await s.revokeInvitation(production, a.invitation.id);

		const next = await requests().reissueInvitation(production, a.invitation.id);
		expect(next.token).not.toBe(a.token);
		expect((await refusal(() => s.openInvitation(a.token))).status).toBe(401);
		const view = await s.openInvitation(next.token);
		expect(view.bids.map((b) => b.id)).toEqual([bid.id]);

		const [row] = await sql`select token_hash, revoked_at from public.invitations where id = ${a.invitation.id}`;
		expect(row.revoked_at).toBeNull();
		expect(row.token_hash).not.toContain(next.token);
	});

	it('refuses another tenant and a closed request', async () => {
		const { production, request, a } = await issuedWithTwoVendors();
		expect((await refusal(() => requests().reissueInvitation(tenant(production.siteHost), a.invitation.id))).status).toBe(404);
		await sql`update public.bid_requests set status = 'closed' where id = ${request.id}`;
		expect((await refusal(() => requests().reissueInvitation(production, a.invitation.id))).status).toBe(409);
	});

	it('leaves a draft request’s invitations reissuable too', async () => {
		const s = store();
		const production = tenant();
		const request = await s.createDraftRequest(production, { code: 'BR-9', header: header(), items: items() });
		const invited = await s.inviteVendor(production, request.id, { name: 'C', email: 'c@x.test', ndaExecuted: false });
		const next = await requests().reissueInvitation(production, invited.invitation.id);
		expect(next.token).toHaveLength(43);
	});
});
