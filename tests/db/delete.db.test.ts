/**
 * Deleting a request (`20261124100000_delete.sql`, `store.deleteRequest`, the `delete` and
 * `delete-check` endpoints): the whole request goes in one transaction, in its own tenant only,
 * never while an award is in Flow PT; the freezes still stop every other delete and update; the
 * public roles cannot call it; the endpoint takes the tenant from the verified claim alone.
 */
import type postgres from 'postgres';
import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashToken } from '$lib/pure/token';
import { createComparison } from '$lib/server/comparison';
import { createRequests } from '$lib/server/requests';
import { draft, draftIn, header, issuedWithTwoVendors, items, refusal, rest, store, superuser, tenant, vendor } from './helpers';

const holder = vi.hoisted(() => ({ verified: null as unknown, claims: [] as unknown[] }));
vi.mock('$lib/server/env', async () => {
	const helpers = await import('./helpers');
	return {
		database: () => helpers.rest('service_role'),
		serverStore: () => helpers.store(),
		verifyProductionClaim: async (claim: unknown) => {
			holder.claims.push(claim);
			if (holder.verified instanceof Error) throw holder.verified;
			return holder.verified;
		}
	};
});

const deleteRoute = await import('../../src/routes/api/production/delete/+server');
const checkRoute = await import('../../src/routes/api/production/delete-check/+server');

const sql = superuser();
const comparison = createComparison(rest('service_role'));
const requests = createRequests(rest('service_role'));

afterAll(async () => {
	await sql.end();
});

/** Every row under the request, per table, and the request itself. */
async function counts(requestId: string): Promise<Record<string, number>> {
	const out: Record<string, number> = {};
	for (const table of ['bid_requests', 'request_items', 'invitations', 'bids', 'bid_lines', 'award_scenarios', 'award_scenario_items', 'awards', 'award_publications', 'bid_rates']) {
		const column = table === 'bid_requests' ? 'id' : 'request_id';
		const [{ n }] = await sql.unsafe(`select count(*)::int as n from public.${table} where ${column} = $1`, [requestId]);
		out[table] = n;
	}
	return out;
}

/** An issued request with everything under it: A submitted twice (one in GBP), B's draft, a rate, a scenario. */
async function full() {
	const ctx = await issuedWithTwoVendors();
	const { s, a, b, production, request } = ctx;
	const first = await s.saveDraftBid(a.token, draftIn('GBP', 100_000));
	await s.submitBid(a.token, first.id);
	const second = await s.saveDraftBid(a.token, draftIn('GBP', 90_000));
	await s.submitBid(a.token, second.id);
	await s.saveDraftBid(b.token, draft(80_000));
	await comparison.setRate(production, request.id, second.id, { rate: '1.25', date: '2026-11-20' });
	await comparison.saveScenario(production, request.id, {
		name: 'All A',
		picks: [{ target: { kind: 'shot', id: 'sh010' }, shares: [{ bidId: second.id, percent: '100' }] }],
		costsLeftOut: []
	});
	return { ...ctx, first, second };
}

async function asService(statement: (tx: postgres.TransactionSql) => Promise<unknown>): Promise<unknown> {
	return sql.begin(async (tx) => {
		await tx`set local role service_role`;
		return statement(tx);
	});
}

describe('sg_delete_request', () => {
	it('deletes an issued request and every row under it, in one call, and says what went', async () => {
		const { s, production, request, a, b } = await full();
		const before = await counts(request.id);
		expect(before).toMatchObject({ bid_requests: 1, request_items: 3, invitations: 2, bids: 3, bid_lines: 9, award_scenarios: 1, award_scenario_items: 1, bid_rates: 1 });

		const deleted = await s.deleteRequest(production, request.id, 'BR-1');
		expect(deleted).toEqual({ code: 'BR-1', round: 1, status: 'issued', items: 3, invitations: 2, bids: 2, drafts: 1, lines: 9, scenarios: 1, rates: 1 });
		expect(Object.values(await counts(request.id)).every((n) => n === 0)).toBe(true);

		// The links are kept as hashes alone, so a dead link can say the request was withdrawn.
		const kept = await sql`select token_hash from public.withdrawn_links where token_hash in ${sql([hashToken(a.token), hashToken(b.token)])}`;
		expect(kept).toHaveLength(2);
		expect(await s.wasWithdrawn(a.token)).toBe(true);
		expect(await s.wasWithdrawn('Q'.repeat(42) + 'E')).toBe(false);
	});

	it('deletes a draft, with an invitation made before the issue', async () => {
		const s = store();
		const production = tenant();
		const request = await s.createDraftRequest(production, { code: 'D-1', header: header(), items: items() });
		const invited = await s.inviteVendor(production, request.id, vendor('Early'));
		const deleted = await s.deleteRequest(production, request.id, 'D-1');
		expect(deleted).toMatchObject({ status: 'draft', items: 3, invitations: 1, bids: 0 });
		expect(Object.values(await counts(request.id)).every((n) => n === 0)).toBe(true);
		expect(await s.wasWithdrawn(invited.token)).toBe(true);
	});

	it('keeps a replaced token too, so an old cookie hears the same', async () => {
		const { s, production, request, a } = await issuedWithTwoVendors();
		const next = await requests.reissueInvitation(production, a.invitation.id);
		await s.deleteRequest(production, request.id, 'BR-1');
		expect(await s.wasWithdrawn(a.token)).toBe(true);
		expect(await s.wasWithdrawn(next.token)).toBe(true);
	});

	it('reaches no other tenant: another host, another project and a missing id answer the same 404', async () => {
		const { s, production, request } = await full();
		const before = await counts(request.id);
		const answers: string[] = [];
		for (const [who, id] of [
			[tenant(production.siteHost), request.id],
			[tenant(undefined, production.projectId), request.id],
			[production, '00000000-0000-4000-8000-000000000000']
		] as const) {
			const error = await refusal(() => s.deleteRequest(who, id, 'BR-1'));
			expect(error.status).toBe(404);
			answers.push(error.message);
		}
		expect(new Set(answers)).toEqual(new Set(['No such request.']));
		// In SQL, past the store: the function filters on the tenant itself.
		for (const [host, project] of [
			[production.siteHost, production.projectId + 1],
			['other.example.com', production.projectId]
		] as const) {
			const error = await refusal(() => asService((tx) => tx`select public.sg_delete_request(${request.id}, ${host}, ${project})`));
			expect(error.message).toBe('No such request.');
		}
		expect(await counts(request.id)).toEqual(before);
	});

	it('wants the request’s code typed', async () => {
		const { s, production, request } = await issuedWithTwoVendors();
		const error = await refusal(() => s.deleteRequest(production, request.id, 'BR-2'));
		expect(error.status).toBe(422);
		expect((await counts(request.id)).bid_requests).toBe(1);
	});

	it('is refused while an award is in Flow PT, published, partial or part undone, and deletes nothing', async () => {
		for (const state of ['published', 'partial', 'undo_partial']) {
			const { s, production, request } = await full();
			await sql`insert into public.award_publications (request_id, site_host, project_id, state, site, written, published_by)
				values (${request.id}, ${production.siteHost}, ${production.projectId}, ${state}, '{}', '{}', '{}')`;
			const before = await counts(request.id);
			const error = await refusal(() => s.deleteRequest(production, request.id, 'BR-1'));
			expect(error.status, state).toBe(409);
			expect(error.message).toBe('The award is in Flow PT. Undo the award first.');
			expect(await counts(request.id)).toEqual(before);
			const [{ n }] = await sql`select count(*)::int as n from public.withdrawn_links w join public.invitations i on i.token_hash = w.token_hash where i.request_id = ${request.id}`;
			expect(n).toBe(0);
		}
	});

	it('cannot be called by anon or authenticated', async () => {
		const { production, request } = await issuedWithTwoVendors();
		for (const role of ['anon', 'authenticated'] as const) {
			const call = await rest(role).rpc('sg_delete_request', { p_request_id: request.id, p_site_host: production.siteHost, p_project_id: production.projectId });
			expect(call.error, role).not.toBeNull();
			const [{ can }] = await sql`select has_function_privilege(${role}, 'public.sg_delete_request(uuid, text, bigint)', 'execute') as can`;
			expect(can).toBe(false);
		}
		expect((await counts(request.id)).bid_requests).toBe(1);
	});
});

describe('the freezes, after the delete migration', () => {
	it('still stop a direct delete or update of an issued request, its items, a submitted bid and its lines', async () => {
		const { request, second } = await full();
		const before = await counts(request.id);
		for (const statement of [
			(tx: postgres.TransactionSql) => tx`delete from public.bid_requests where id = ${request.id}`,
			(tx: postgres.TransactionSql) => tx`delete from public.request_items where request_id = ${request.id}`,
			(tx: postgres.TransactionSql) => tx`delete from public.bids where id = ${second.id}`,
			(tx: postgres.TransactionSql) => tx`delete from public.bid_lines where bid_id = ${second.id}`,
			(tx: postgres.TransactionSql) => tx`update public.bids set currency = 'EUR' where id = ${second.id}`,
			(tx: postgres.TransactionSql) => tx`update public.request_items set code = 'X' where request_id = ${request.id}`
		]) {
			await refusal(() => asService(statement));
		}
		expect(await counts(request.id)).toEqual(before);
	});

	it('let a delete through for the request being deleted only, and never an update', async () => {
		const { request, second } = await full();
		const other = await full();
		const before = await counts(request.id);
		// The setting names another request: this one's rows stay frozen.
		await refusal(() =>
			asService(async (tx) => {
				await tx`select set_config('sg.delete_request', ${other.request.id}, true)`;
				await tx`delete from public.bids where id = ${second.id}`;
			})
		);
		// It names this request: an update is still refused.
		const updated = await refusal(() =>
			asService(async (tx) => {
				await tx`select set_config('sg.delete_request', ${request.id}, true)`;
				await tx`update public.bids set currency = 'EUR' where id = ${second.id}`;
			})
		);
		expect(updated.message).toMatch(/submitted bid/);
		expect(await counts(request.id)).toEqual(before);
	});
});

describe('the delete endpoints', () => {
	beforeAll(() => {
		holder.claims = [];
	});

	async function post(route: { POST: unknown }, path: string, body: unknown): Promise<{ status: number; json: any }> {
		const url = new URL(`http://localhost:5181/api/production/${path}`);
		const event = { request: new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), url } as unknown as RequestEvent;
		const res = await (route.POST as (e: RequestEvent) => Promise<Response>)(event);
		return { status: res.status, json: await res.json() };
	}

	it('take the tenant from the verified claim, never from the body, and answer what went', async () => {
		const { production, request } = await full();
		const claim = { siteUrl: `https://${production.siteHost}`, projectId: production.projectId, sessionToken: 'x' };

		// Another tenant, verified: the body names this request and this tenant, and reaches nothing.
		holder.verified = { ...tenant(), user: { type: 'HumanUser', id: 1 }, role: 'admin' };
		const smuggled = { claim, id: request.id, code: 'BR-1', siteHost: production.siteHost, projectId: production.projectId };
		expect((await post(checkRoute, 'delete-check', smuggled)).status).toBe(404);
		expect((await post(deleteRoute, 'delete', smuggled)).status).toBe(404);
		expect((await counts(request.id)).bid_requests).toBe(1);

		holder.verified = { ...production, user: { type: 'HumanUser', id: 1 }, role: 'admin' };
		const check = await post(checkRoute, 'delete-check', { claim, id: request.id });
		expect(check.status).toBe(200);
		expect(check.json.facts).toEqual({
			id: request.id,
			code: 'BR-1',
			title: null,
			round: 1,
			status: 'issued',
			shots: 2,
			assets: 1,
			invitations: 2,
			bids: 2,
			vendors: ['Vendor A'],
			scenarios: 1,
			rates: 1,
			award: null
		});
		expect((await post(deleteRoute, 'delete', { claim, id: request.id })).status).toBe(422);
		expect((await post(deleteRoute, 'delete', { claim, id: 'nope', code: 'BR-1' })).status).toBe(422);
		const done = await post(deleteRoute, 'delete', { claim, id: request.id, code: 'BR-1' });
		expect(done.status).toBe(200);
		expect(done.json.deleted).toMatchObject({ code: 'BR-1', invitations: 2, bids: 2 });
		expect(Object.values(await counts(request.id)).every((n) => n === 0)).toBe(true);
		expect(holder.claims.every((c) => JSON.stringify(c) === JSON.stringify({ siteUrl: claim.siteUrl, projectId: claim.projectId, sessionToken: 'x', bearer: undefined }))).toBe(true);
	});

	it('refuse a session the check refuses', async () => {
		const { StoreError } = await import('$lib/server/errors');
		holder.verified = new StoreError(403, 'Your Flow PT permission group cannot run bids. Ask your Flow PT admin.');
		const answer = await post(deleteRoute, 'delete', { claim: {}, id: '00000000-0000-4000-8000-000000000000', code: 'X' });
		expect(answer.status).toBe(403);
	});
});
