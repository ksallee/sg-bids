/**
 * The award's record (`src/lib/server/awards.ts`, `20261122100000_award.sql`): a published run
 * replaces the award rows, marks the request awarded and locks the rates; a partial run records what
 * landed and changes no award row; publishing again does not add rows; the undo clears it all, or
 * keeps what is left; a tenant reaches none of another's; a vendor is told bidding is closed.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { bidKey, lineKey, type Written } from '$lib/pure/fpt-award';
import type { AwardRecordWire } from '$lib/pure/award-wire';
import { createAwards } from '$lib/server/awards';
import { createComparison } from '$lib/server/comparison';
import type { VerifiedProduction } from '$lib/server/production';
import { draft, draftIn, issuedWithTwoVendors, refusal, rest, superuser, tenant } from './helpers';

const sql = superuser();
const comparison = createComparison(rest('service_role'));
const awards = createAwards(rest('service_role'), comparison);

afterAll(async () => {
	await sql.end();
});

const verified = (p: { kind: 'production'; siteHost: string; projectId: number }): VerifiedProduction => ({ ...p, user: { type: 'HumanUser', id: 42 }, role: 'admin' });

/** A in dollars, B in pounds with a rate; a chosen scenario: sh010 to A, hero split. */
async function setup() {
	const ctx = await issuedWithTwoVendors();
	const { s, a, b, production, request } = ctx;
	const bidA = await s.saveDraftBid(a.token, draft(100_000));
	await s.submitBid(a.token, bidA.id);
	const bidB = await s.saveDraftBid(b.token, draftIn('GBP', 80_000));
	await s.submitBid(b.token, bidB.id);
	await comparison.setRate(production, request.id, bidB.id, { rate: '1.25', date: '2026-11-20' });
	const scenario = await comparison.saveScenario(production, request.id, {
		name: 'Split',
		picks: [
			{ target: { kind: 'shot', id: 'sh010' }, shares: [{ bidId: bidA.id, percent: '100' }] },
			{
				target: { kind: 'asset', id: 'hero' },
				shares: [
					{ bidId: bidA.id, percent: '50' },
					{ bidId: bidB.id, percent: '50' }
				]
			}
		],
		costsLeftOut: []
	});
	await comparison.chooseScenario(production, request.id, scenario.id);
	const keyA = bidKey(request.id, a.invitation.id, 1);
	const keyB = bidKey(request.id, b.invitation.id, 1);
	const written: Written = {
		bids: [
			{ key: keyA, id: 5001, created: true },
			{ key: keyB, id: 5002, created: true }
		],
		lines: [
			{ key: lineKey(keyA, { kind: 'shot', id: 'sh010' }), id: 6001, created: true },
			{ key: lineKey(keyA, { kind: 'asset', id: 'hero' }), id: 6002, created: true },
			{ key: lineKey(keyB, { kind: 'asset', id: 'hero' }), id: 6003, created: true }
		],
		groups: [{ itemType: 'Shot', id: 101, field: 'sg_vendor_groups', groups: [38] }],
		attachments: [{ key: keyA, id: 77 }]
	};
	const record = (extra: Partial<AwardRecordWire> = {}): AwardRecordWire => ({
		requestId: request.id,
		scenarioId: scenario.id,
		state: 'published',
		site: { projectId: production.projectId, bidType: 'CustomEntity14', lineType: 'CustomEntity15', vendorField: { Shot: 'sg_vendor_groups' }, statuses: {} },
		written,
		options: { allLines: false, groups: {} },
		problems: [],
		error: null,
		exposure: null,
		byName: 'Pat Producer',
		...extra
	});
	return { ...ctx, bidA, bidB, scenario, written, record, me: verified(production) };
}

describe('recordAward', () => {
	it('writes the award rows from the stored scenario, marks the request awarded and locks the rates', async () => {
		const { production, request, bidB, record, me } = await setup();
		const publication = await awards.recordAward(me, record({ exposure: { state: 'unknown', lines: ['Could not read.'] } }));
		expect(publication.state).toBe('published');
		expect(publication.publishedBy).toEqual({ type: 'HumanUser', id: 42, name: 'Pat Producer' });
		expect(publication.exposure).toMatchObject({ state: 'unknown', lines: ['Could not read.'] });
		expect(publication.exposure?.acceptedAt).toMatch(/^\d{4}-/);
		expect(publication.summary).toMatchObject({ baseCurrency: 'USD', shots: 1, assets: 1, split: 1, total: { minor: 100_000 + 100_000 + 100_000, currency: 'USD' } });
		const rows = await sql`select item_kind, item_key, share_percent, fpt_bid_id, fpt_line_id, written_to_fpt_at is not null as written from public.awards where request_id = ${request.id} order by item_key, share_percent`;
		expect(rows.map((r) => [r.item_key, r.share_percent, Number(r.fpt_bid_id), Number(r.fpt_line_id), r.written])).toEqual([
			['hero', '50', 5001, 6002, true],
			['hero', '50', 5002, 6003, true],
			['sh010', '100', 5001, 6001, true]
		]);
		const c = await comparison.loadComparison(production, request.id);
		expect(c.status).toBe('awarded');
		expect(c.awarded).toBe(true);
		expect(c.publication?.written.bids).toHaveLength(2);
		expect((await refusal(() => comparison.setRate(production, request.id, bidB.id, { rate: '1.3', date: '2026-11-21' }))).message).toContain('locked');
	});

	it('replaces the rows when published again, never adds to them', async () => {
		const { production, request, bidA, scenario, record, me } = await setup();
		await awards.recordAward(me, record());
		await comparison.saveScenario(production, request.id, { id: scenario.id, name: 'All A', picks: [{ target: { kind: 'shot', id: 'sh010' }, shares: [{ bidId: bidA.id, percent: '100' }] }], costsLeftOut: [] });
		await awards.recordAward(me, record());
		const rows = await sql`select item_key from public.awards where request_id = ${request.id}`;
		expect(rows.map((r) => r.item_key)).toEqual(['sh010']);
		const [{ n }] = await sql`select count(*)::int as n from public.award_publications where request_id = ${request.id}`;
		expect(n).toBe(1);
	});

	it('records a partial run with what landed and changes no award row', async () => {
		const { production, request, record, me, written } = await setup();
		const landed = { ...written, lines: [], groups: [], attachments: [] };
		const publication = await awards.recordAward(me, record({ state: 'partial', written: landed, error: 'Bid Lines and vendor Groups: 400 Value is not legal.' }));
		expect(publication).toMatchObject({ state: 'partial', error: 'Bid Lines and vendor Groups: 400 Value is not legal.' });
		expect(publication.written.bids).toHaveLength(2);
		const [{ n }] = await sql`select count(*)::int as n from public.awards where request_id = ${request.id}`;
		expect(n).toBe(0);
		expect((await comparison.loadComparison(production, request.id)).status).toBe('issued');
	});

	it('refuses a scenario that is not the chosen one', async () => {
		const { production, request, scenario, record, me } = await setup();
		await comparison.chooseScenario(production, request.id, null);
		expect((await refusal(() => awards.recordAward(me, record({ scenarioId: scenario.id })))).status).toBe(409);
	});

	it('is reached by no other tenant', async () => {
		const { request, record } = await setup();
		const other = verified(tenant());
		expect((await refusal(() => awards.recordAward(other, record()))).status).toBe(404);
		expect(await awards.loadPublication(other, request.id)).toBeNull();
	});
});

describe('clearAward', () => {
	it('keeps what is left after a stopped undo, then clears it all: issued again, the rates unlocked', async () => {
		const { production, request, bidB, record, me, written } = await setup();
		await awards.recordAward(me, record());
		const left = { ...written, lines: [], groups: [] };
		const kept = await awards.clearAward(production, { requestId: request.id, remaining: left, error: 'Batch refused.' });
		expect(kept).toMatchObject({ state: 'undo_partial', error: 'Batch refused.' });
		expect(kept?.written.lines).toEqual([]);
		expect((await comparison.loadComparison(production, request.id)).status).toBe('awarded');

		expect(await awards.clearAward(production, { requestId: request.id, remaining: null, error: null })).toBeNull();
		const c = await comparison.loadComparison(production, request.id);
		expect(c.status).toBe('issued');
		expect(c.awarded).toBe(false);
		expect(c.publication).toBeNull();
		const [{ n }] = await sql`select count(*)::int as n from public.awards where request_id = ${request.id}`;
		expect(n).toBe(0);
		expect(await comparison.setRate(production, request.id, bidB.id, { rate: '1.3', date: '2026-11-21' })).toMatchObject({ rate: { rate: '1.3' } });
	});
});

describe('the awarded request', () => {
	it('tells a vendor bidding is closed, never who won, and takes no change from it', async () => {
		const { s, a, record, me } = await setup();
		await awards.recordAward(me, record());
		const view = await s.openInvitation(a.token);
		expect(view.status).toBe('closed');
		expect(JSON.stringify(view)).not.toContain('awarded');
		expect((await refusal(() => s.saveDraftBid(a.token, draft(1)))).status).toBe(409);
	});

	it('is awarded only with award rows, and goes back to issued only without them', async () => {
		const { request, record, me } = await setup();
		expect((await refusal(() => sql`update public.bid_requests set status = 'awarded' where id = ${request.id}`)).message).toContain('award rows');
		await awards.recordAward(me, record());
		expect((await refusal(() => sql`update public.bid_requests set status = 'issued' where id = ${request.id}`)).message).toContain('Undo the award');
	});

	it('refuses a new vendor until the award is undone', async () => {
		const { s, production, request, record, me } = await setup();
		await awards.recordAward(me, record());
		expect((await refusal(() => s.inviteVendor(production, request.id, { name: 'C', email: 'c@example.com', ndaExecuted: false }))).status).toBe(409);
	});
});
