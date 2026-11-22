/**
 * Rows by count: a row in the request only stands for many (`unit_count`). Saved on a draft, copied
 * at the issue, frozen with the request, never linked to one Flow PT row, 1 for every row from
 * before and from a caller that sends none. A vendor's line on it carries its unit price, and the
 * store holds the total to the unit price times the count.
 */
import type postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import type { RequestAsset, RequestShot } from '$lib/pure/model';
import type { BidDraft } from '$lib/pure/rows';
import { header, refusal, store, superuser, tenant, vendor } from './helpers';

const sql = superuser();

afterAll(async () => {
	await sql.end();
});

async function asService(statement: (tx: postgres.TransactionSql) => Promise<unknown>): Promise<unknown> {
	return sql.begin(async (tx) => {
		await tx`set local role service_role`;
		return statement(tx);
	});
}

function rows(): { shots: RequestShot[]; assets: RequestAsset[] } {
	return {
		shots: [
			{ id: 'shot-1234', code: 'SH010', fpt: { type: 'Shot', id: 1234 }, omitted: false, assetIds: [] },
			{ id: 'shot-bd-simple', code: 'SIMPLE', source: 'breakdown', omitted: false, assetIds: [], frames: 80, count: 120, difficulty: 'Simple' },
			{ id: 'shot-bd-hard', code: 'HARD', source: 'breakdown', omitted: false, assetIds: [], count: 10 }
		],
		assets: [{ id: 'asset-bd-props', name: 'props', source: 'breakdown', count: 12 }]
	};
}

async function issued() {
	const s = store();
	const production = tenant();
	const request = await s.createDraftRequest(production, { code: 'CT-1', header: header(), items: rows() });
	const a = await s.inviteVendor(production, request.id, vendor('Vendor A'));
	const out = await s.issueRequest(production, request.id);
	return { s, production, request: out, a };
}

const usd = (minor: number) => ({ minor, currency: 'USD' });

function answer(lines: BidDraft['lines']): BidDraft {
	return { number: 'Q-1', date: '2026-11-21', currency: 'USD', rate: null, assumptions: [], exclusions: [], milestones: [], lines, costs: [], discount: null, tax: null, rebate: [] };
}

describe('a counted row on a draft', () => {
	it('is saved with its count and read back the same; a Flow PT row is 1', async () => {
		const s = store();
		const production = tenant();
		const request = await s.createDraftRequest(production, { code: 'CT-1', header: header(), items: rows() });
		const bid = request.packages![0].id;
		expect(request.shots).toEqual(rows().shots.map((x) => ({ ...x, package: bid })));
		expect(request.assets).toEqual(rows().assets.map((x) => ({ ...x, package: bid })));
		const stored = await sql`select key, unit_count from public.production_bid_items where request_id = ${request.id} order by kind desc, position`;
		expect(stored.map((r) => [r.key, r.unit_count])).toEqual([
			['shot-1234', 1],
			['shot-bd-simple', 120],
			['shot-bd-hard', 10],
			['asset-bd-props', 12]
		]);
	});

	it('counts as many in its bid, its frames per unit times its count', async () => {
		const s = store();
		const production = tenant();
		const request = await s.createDraftRequest(production, { code: 'CT-1', header: header(), items: rows() });
		const [b] = await sql`select shot_count, asset_count, frame_count from public.production_bids where request_id = ${request.id}`;
		expect([b.shot_count, b.asset_count, Number(b.frame_count)]).toEqual([131, 12, 9600]);
	});

	it('reads as 1 when a caller from before counts saves it with none', async () => {
		const s = store();
		const production = tenant();
		const request = await s.createDraftRequest(production, { code: 'CT-1', header: header(), items: rows() });
		const key = request.packages![0].id;
		await asService(
			(tx) =>
				tx`select public.sg_save_draft(${request.id}, ${production.siteHost}, ${production.projectId}, ${tx.json([
					{ key, name: 'Bid 1', items: [{ kind: 'shot', key: 'shot-bd-simple', code: 'SIMPLE', fpt_type: null, fpt_id: null, fields: { assetIds: [] }, omitted: false, source: 'breakdown' }] }
				])}, null)`
		);
		const [row] = await sql`select unit_count from public.production_bid_items where request_id = ${request.id}`;
		expect(row.unit_count).toBe(1);
	});

	it('refuses a count out of range, and a count on a Flow PT row', async () => {
		const s = store();
		const production = tenant();
		const request = await s.createDraftRequest(production, { code: 'CT-1', header: header(), items: rows() });
		const [one] = await sql`select id from public.production_bid_items where request_id = ${request.id} and key = 'shot-bd-simple'`;
		expect((await refusal(() => sql`update public.production_bid_items set unit_count = 0 where id = ${one.id}`)).message).toMatch(/production_bid_items_unit_count/);
		expect((await refusal(() => sql`update public.production_bid_items set unit_count = 100001 where id = ${one.id}`)).message).toMatch(/production_bid_items_unit_count/);
		expect((await refusal(() => sql`update public.production_bid_items set unit_count = 2 where request_id = ${request.id} and key = 'shot-1234'`)).message).toMatch(/production_bid_items_unit_count_fpt/);
	});

	it('refuses the issue while a row has no code, naming its bid', async () => {
		const s = store();
		const production = tenant();
		const typed = rows();
		const request = await s.createDraftRequest(production, { code: 'CT-1', header: header(), items: { shots: [...typed.shots, { id: 'shot-bd-new', code: '', source: 'breakdown', omitted: false, assetIds: [] }], assets: typed.assets } });
		await s.inviteVendor(production, request.id, vendor('Vendor A'));
		const error = await refusal(() => s.issueRequest(production, request.id));
		expect(error.message).toMatch(/A row in Bid 01 has no code\. Type one, or remove the row\./);
	});
});

describe('a counted row on an issued request', () => {
	it('is copied with its count, and the vendor reads it', async () => {
		const { request } = await issued();
		expect(request.shots.map((x) => [x.code, x.count])).toEqual([
			['SH010', undefined],
			['SIMPLE', 120],
			['HARD', 10]
		]);
		const stored = await sql`select key, unit_count from public.request_items where request_id = ${request.id} order by position`;
		expect(stored.map((r) => r.unit_count)).toEqual([1, 120, 10, 12]);
	});

	it('is frozen: its count never changes after the issue', async () => {
		const { request } = await issued();
		const error = await refusal(() => asService((tx) => tx`update public.request_items set unit_count = 5 where request_id = ${request.id} and key = 'shot-bd-simple'`));
		expect(error.message).toMatch(/frozen/);
	});

	it('is never linked to one Flow PT row', async () => {
		const { s, production, request } = await issued();
		const error = await refusal(() => s.linkItems(production, request.id, [{ kind: 'shot', key: 'shot-bd-simple', fpt: { type: 'Shot', id: 501 } }]));
		expect(error.message).toMatch(/SIMPLE stands for 120 shots\. It is never linked to one\./);
		const [row] = await sql`select fpt_id from public.request_items where request_id = ${request.id} and key = 'shot-bd-simple'`;
		expect(row.fpt_id).toBeNull();
	});

	it('takes a vendor line with its unit price and the product as total, and refuses one that is not', async () => {
		const { s, a } = await issued();
		const saved = await s.saveDraftBid(
			a.token,
			answer([
				{ target: { kind: 'shot', id: 'shot-bd-simple' }, total: usd(18_000_000), unit: usd(150_000), excluded: false, fromRate: true },
				{ target: { kind: 'shot', id: 'shot-1234' }, total: usd(90_000), excluded: false }
			])
		);
		expect(saved.lines.find((l) => l.target.id === 'shot-bd-simple')).toMatchObject({ total: usd(18_000_000), unit: usd(150_000), fromRate: true });
		const [line] = await sql`select total_minor, detail from public.bid_lines where bid_id = ${saved.id} and item_key = 'shot-bd-simple'`;
		expect([Number(line.total_minor), line.detail.unit]).toEqual([18_000_000, usd(150_000)]);
		const wrong = await refusal(() => s.saveDraftBid(a.token, answer([{ target: { kind: 'shot', id: 'shot-bd-simple' }, total: usd(18_000_001), unit: usd(150_000), excluded: false }])));
		expect(wrong.status).toBe(422);
		expect(wrong.message).toMatch(/not its unit price times 120/);
		const bare = await refusal(() => s.saveDraftBid(a.token, answer([{ target: { kind: 'shot', id: 'shot-bd-simple' }, total: usd(150_000), excluded: false }])));
		expect(bare.message).toMatch(/needs its unit price/);
		const one = await refusal(() => s.saveDraftBid(a.token, answer([{ target: { kind: 'shot', id: 'shot-1234' }, total: usd(90_000), unit: usd(90_000), excluded: false }])));
		expect(one.message).toMatch(/not priced per unit/);
	});
});
