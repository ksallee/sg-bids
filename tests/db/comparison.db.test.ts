/**
 * The comparison data layer (`src/lib/server/comparison.ts`): production reads submitted bids only,
 * the latest version per vendor unless it asks for another; its rate per bid applies until the
 * award and is locked by the database after; scenarios save, rename, delete and one is chosen; a
 * tenant reaches none of another's rows.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createComparison } from '$lib/server/comparison';
import { draft, draftIn, issuedWithTwoVendors, refusal, rest, superuser, tenant } from './helpers';

const sql = superuser();
const comparison = createComparison(rest('service_role'), { page: 2 });

afterAll(async () => {
	await sql.end();
});

const pick = (id: string, bidId: string) => ({ target: { kind: 'shot' as const, id }, shares: [{ bidId, percent: '100' }] });

/** A in dollars with two versions, B in pounds; B keeps a draft too. */
async function setup() {
	const ctx = await issuedWithTwoVendors();
	const { s, a, b } = ctx;
	const a1 = await s.saveDraftBid(a.token, draft(100_000));
	await s.submitBid(a.token, a1.id);
	const a2 = await s.saveDraftBid(a.token, draft(95_000));
	await s.submitBid(a.token, a2.id);
	const b1 = await s.saveDraftBid(b.token, draftIn('GBP', 70_000));
	await s.submitBid(b.token, b1.id);
	const b2 = await s.saveDraftBid(b.token, draftIn('GBP', 60_000));
	return { ...ctx, a1, a2, b1, b2 };
}

describe('loadComparison', () => {
	it('shows the latest submitted version per vendor and never a draft', async () => {
		const { production, request, a2, b1, b2 } = await setup();
		const c = await comparison.loadComparison(production, request.id);
		expect(c.bids.map((bid) => bid.id)).toEqual([a2.id, b1.id]);
		expect(c.versions.map((v) => [v.version, v.status])).toEqual([
			[1, 'submitted'],
			[2, 'submitted'],
			[1, 'submitted']
		]);
		expect(c.versions.some((v) => v.bidId === b2.id)).toBe(false);
		expect(c.request.shots.map((shot) => shot.id)).toEqual(['sh010', 'sh020']);
		expect(c.request.vendors).toHaveLength(2);
		expect(c.status).toBe('issued');
		expect(c.awarded).toBe(false);
	});

	it('reads every line, a page at a time', async () => {
		const { production, request, a2 } = await setup();
		const c = await comparison.loadComparison(production, request.id);
		expect(c.bids.find((bid) => bid.id === a2.id)!.lines.map((line) => line.target.id).sort()).toEqual(['hero', 'sh010', 'sh020']);
	});

	it('shows an earlier version when asked, and refuses a draft asked for', async () => {
		const { production, request, a1, b1, b2 } = await setup();
		const c = await comparison.loadComparison(production, request.id, [a1.id, b2.id]);
		expect(c.bids.map((bid) => bid.id)).toEqual([a1.id, b1.id]);
	});

	it('answers a bid in another currency with no rate until production sets one', async () => {
		const { production, request, b1 } = await setup();
		const before = await comparison.loadComparison(production, request.id);
		expect(before.bids[1].rate).toBeNull();
		await comparison.setRate(production, request.id, b1.id, { rate: '1.2712', date: '2026-11-20' });
		const after = await comparison.loadComparison(production, request.id);
		expect(after.bids[1].rate).toEqual({ from: 'GBP', to: 'USD', rate: '1.2712', date: '2026-11-20' });
		expect(after.rates.map((r) => r.bidId)).toEqual([b1.id]);
	});

	it('is a 404 for another tenant', async () => {
		const { request } = await setup();
		expect((await refusal(() => comparison.loadComparison(tenant(), request.id))).status).toBe(404);
	});
});

describe('setRate', () => {
	it('changes the rate and its date, and clears it', async () => {
		const { production, request, b1 } = await setup();
		await comparison.setRate(production, request.id, b1.id, { rate: '1.27', date: '2026-11-20' });
		const changed = await comparison.setRate(production, request.id, b1.id, { rate: '1.25', date: '2026-11-21' });
		expect(changed?.rate.rate).toBe('1.25');
		const rows = await sql`select rate, rate_date::text as day from public.bid_rates where bid_id = ${b1.id}`;
		expect(rows).toEqual([{ rate: '1.25', day: '2026-11-21' }]);
		expect(await comparison.setRate(production, request.id, b1.id, null)).toBeNull();
		expect(await sql`select 1 from public.bid_rates where bid_id = ${b1.id}`).toHaveLength(0);
	});

	it('refuses a bid in the base currency, a draft, a bad rate and another tenant', async () => {
		const { production, request, a2, b2, b1 } = await setup();
		expect((await refusal(() => comparison.setRate(production, request.id, a2.id, { rate: '1', date: '2026-11-20' }))).status).toBe(422);
		expect((await refusal(() => comparison.setRate(production, request.id, b2.id, { rate: '1.2', date: '2026-11-20' }))).status).toBe(404);
		expect((await refusal(() => comparison.setRate(production, request.id, b1.id, { rate: '0', date: '2026-11-20' }))).status).toBe(422);
		expect((await refusal(() => comparison.setRate(tenant(), request.id, b1.id, { rate: '1.2', date: '2026-11-20' }))).status).toBe(404);
	});

	it('is locked once the request has an award, even in SQL', async () => {
		const { production, request, a2, b1 } = await setup();
		await comparison.setRate(production, request.id, b1.id, { rate: '1.27', date: '2026-11-20' });
		const [line] = await sql`select id from public.bid_lines where bid_id = ${a2.id} and item_key = 'sh010'`;
		await sql`insert into public.awards (request_id, site_host, project_id, item_kind, item_key, bid_line_id, share_percent)
			values (${request.id}, ${production.siteHost}, ${production.projectId}, 'shot', 'sh010', ${line.id}, '100')`;
		const refused = await refusal(() => comparison.setRate(production, request.id, b1.id, { rate: '1.3', date: '2026-11-21' }));
		expect(refused.status).toBe(409);
		expect(refused.message).toMatch(/locked/);
		const direct = await refusal(() => sql`update public.bid_rates set rate = '2' where bid_id = ${b1.id}`);
		expect(direct.message).toMatch(/locked/);
		expect(await refusal(() => sql`delete from public.bid_rates where bid_id = ${b1.id}`)).toBeTruthy();
		expect((await comparison.loadComparison(production, request.id)).awarded).toBe(true);
	});

	it('cannot be written in SQL on a draft or a base currency bid, or moved', async () => {
		const { production, request, a2, b1, b2 } = await setup();
		const row = (bidId: string) => sql`insert into public.bid_rates (bid_id, request_id, site_host, project_id, rate, rate_date)
			values (${bidId}, ${request.id}, ${production.siteHost}, ${production.projectId}, '1.2', '2026-11-20')`;
		expect((await refusal(() => row(b2.id))).message).toMatch(/draft/);
		expect((await refusal(() => row(a2.id))).message).toMatch(/base currency/);
		await row(b1.id);
		expect((await refusal(() => sql`update public.bid_rates set project_id = 1 where bid_id = ${b1.id}`)).message).toMatch(/move/);
	});
});

describe('scenarios', () => {
	it('saves picks with the costs left out, renames, lists, deletes', async () => {
		const { production, request, a2, b1 } = await setup();
		const saved = await comparison.saveScenario(production, request.id, { name: 'All A', picks: [pick('sh010', a2.id)], costsLeftOut: [b1.id] });
		expect(saved).toMatchObject({ name: 'All A', chosen: false, costsLeftOut: [b1.id], picks: [pick('sh010', a2.id)] });
		const updated = await comparison.saveScenario(production, request.id, { id: saved.id, name: 'All A', picks: [pick('sh010', b1.id), pick('sh020', b1.id)], costsLeftOut: [] });
		expect(updated.picks).toHaveLength(2);
		expect(updated.costsLeftOut).toEqual([]);
		const renamed = await comparison.renameScenario(production, request.id, saved.id, 'All B');
		expect(renamed.name).toBe('All B');
		expect((await comparison.listScenarios(production, request.id)).map((s) => s.name)).toEqual(['All B']);
		await comparison.deleteScenario(production, request.id, saved.id);
		expect(await comparison.listScenarios(production, request.id)).toEqual([]);
		expect(await sql`select 1 from public.award_scenario_items where scenario_id = ${saved.id}`).toHaveLength(0);
	});

	it('marks one chosen at most, switches, and unmarks', async () => {
		const { production, request, a2 } = await setup();
		const one = await comparison.saveScenario(production, request.id, { name: 'One', picks: [pick('sh010', a2.id)], costsLeftOut: [] });
		const two = await comparison.saveScenario(production, request.id, { name: 'Two', picks: [], costsLeftOut: [] });
		const chosen = (list: { name: string; chosen: boolean }[]) => list.filter((s) => s.chosen).map((s) => s.name);
		expect(chosen(await comparison.chooseScenario(production, request.id, one.id))).toEqual(['One']);
		expect(chosen(await comparison.chooseScenario(production, request.id, two.id))).toEqual(['Two']);
		expect(chosen(await comparison.chooseScenario(production, request.id, null))).toEqual([]);
		const twice = await refusal(() => sql`update public.award_scenarios set chosen = true where request_id = ${request.id}`);
		expect(twice).toBeTruthy();
	});

	it('refuses shares off 100, a draft picked, costs of another request', async () => {
		const { production, request, a2, b2 } = await setup();
		const off = await refusal(() =>
			comparison.saveScenario(production, request.id, { name: 'X', picks: [{ target: { kind: 'shot', id: 'sh010' }, shares: [{ bidId: a2.id, percent: '60' }] }], costsLeftOut: [] })
		);
		expect(off.status).toBe(422);
		expect((await refusal(() => comparison.saveScenario(production, request.id, { name: 'X', picks: [pick('sh010', b2.id)], costsLeftOut: [] }))).status).toBe(409);
		const other = await setup();
		expect((await refusal(() => comparison.saveScenario(production, request.id, { name: 'X', picks: [], costsLeftOut: [other.a2.id] }))).status).toBe(409);
	});

	it('keeps another tenant out of every scenario action', async () => {
		const { production, request, a2 } = await setup();
		const saved = await comparison.saveScenario(production, request.id, { name: 'Mine', picks: [pick('sh010', a2.id)], costsLeftOut: [] });
		const stranger = tenant();
		expect((await refusal(() => comparison.listScenarios(stranger, request.id))).status).toBe(404);
		expect((await refusal(() => comparison.renameScenario(stranger, request.id, saved.id, 'Theirs'))).status).toBe(404);
		expect((await refusal(() => comparison.deleteScenario(stranger, request.id, saved.id))).status).toBe(404);
		expect((await refusal(() => comparison.chooseScenario(stranger, request.id, saved.id))).status).toBe(404);
		expect((await refusal(() => comparison.saveScenario(stranger, request.id, { id: saved.id, name: 'Theirs', picks: [], costsLeftOut: [] }))).status).toBe(404);
		expect((await comparison.listScenarios(production, request.id))[0]).toMatchObject({ name: 'Mine', chosen: false });
	});
});
