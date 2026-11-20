/**
 * Rows from a breakdown: stored with their source, read back the same, and given their Flow PT row
 * later. On an issued request that link is the one change the freeze allows, through
 * `sg_link_request_items` only: once, on a breakdown row with none, and nothing else with it.
 */
import type postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import type { RequestAsset, RequestShot } from '$lib/pure/model';
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

function mixed(): { shots: RequestShot[]; assets: RequestAsset[] } {
	return {
		shots: [
			{ id: 'shot-1234', code: 'SH010', fpt: { type: 'Shot', id: 1234 }, omitted: false, assetIds: [] },
			{ id: 'shot-bd-a', code: 'SH900', source: 'breakdown', omitted: false, assetIds: ['asset-bd-b'], frames: 48, sequence: 'SQ9' },
			{ id: 'shot-bd-c', code: 'SH910', source: 'breakdown', omitted: false, assetIds: [] }
		],
		assets: [{ id: 'asset-bd-b', name: 'prop', source: 'breakdown' }]
	};
}

async function issued() {
	const s = store();
	const production = tenant();
	const request = await s.createDraftRequest(production, { code: 'BD-1', header: header(), items: mixed() });
	await s.inviteVendor(production, request.id, vendor('Vendor A'));
	await s.issueRequest(production, request.id);
	return { s, production, request };
}

describe('a breakdown row', () => {
	it('is stored with its source and no Flow PT row, and read back as sent', async () => {
		const s = store();
		const production = tenant();
		const request = await s.createDraftRequest(production, { code: 'BD-1', header: header(), items: mixed() });
		expect(request.shots).toEqual(mixed().shots);
		expect(request.assets).toEqual(mixed().assets);
		const rows = await sql`select key, source, fpt_id, fpt_linked_at from public.request_items where request_id = ${request.id} order by position`;
		expect(rows.map((r) => [r.key, r.source, r.fpt_id, r.fpt_linked_at])).toEqual([
			['shot-1234', 'fpt', '1234', null],
			['shot-bd-a', 'breakdown', null, null],
			['shot-bd-c', 'breakdown', null, null],
			['asset-bd-b', 'breakdown', null, null]
		]);
	});

	it('takes no other source', async () => {
		const { request, production } = await issued();
		const error = await refusal(() =>
			asService((tx) => tx`insert into public.request_items (request_id, site_host, project_id, kind, key, code, source) values (${request.id}, ${production.siteHost}, ${production.projectId}, 'shot', 'x', 'X', 'csv')`)
		);
		expect(error.message).toMatch(/request_items_source|frozen/);
	});

	it('is linked on a draft by a save, and by the link call', async () => {
		const s = store();
		const production = tenant();
		const request = await s.createDraftRequest(production, { code: 'BD-1', header: header(), items: mixed() });
		const linked = await s.linkItems(production, request.id, [{ kind: 'shot', key: 'shot-bd-a', fpt: { type: 'Shot', id: 501 } }]);
		expect(linked.shots.find((x) => x.id === 'shot-bd-a')?.fpt).toEqual({ type: 'Shot', id: 501 });
		const [row] = await sql`select fpt_linked_at from public.request_items where request_id = ${request.id} and key = 'shot-bd-a'`;
		expect(row.fpt_linked_at).toBeNull();
	});
});

describe('on an issued request', () => {
	it('links a breakdown row once, stamps when, and changes nothing a vendor reads', async () => {
		const { s, production, request } = await issued();
		const before = await sql`select * from public.request_items where request_id = ${request.id} order by position`;
		const out = await s.linkItems(production, request.id, [
			{ kind: 'shot', key: 'shot-bd-a', fpt: { type: 'Shot', id: 501 } },
			{ kind: 'asset', key: 'asset-bd-b', fpt: { type: 'Asset', id: 77 } }
		]);
		expect(out.shots.find((x) => x.id === 'shot-bd-a')).toEqual({ ...mixed().shots[1], fpt: { type: 'Shot', id: 501 } });
		expect(out.assets[0]).toEqual({ ...mixed().assets[0], fpt: { type: 'Asset', id: 77 } });
		const after = await sql`select * from public.request_items where request_id = ${request.id} order by position`;
		for (const [i, row] of after.entries()) {
			const { fpt_type, fpt_id, fpt_linked_at, ...rest } = row;
			const { fpt_type: t0, fpt_id: i0, fpt_linked_at: l0, ...was } = before[i];
			expect(rest).toEqual(was);
			if (row.key === 'shot-bd-a' || row.key === 'asset-bd-b') {
				expect([t0, i0, l0]).toEqual([null, null, null]);
				expect(fpt_linked_at).not.toBeNull();
			} else expect([fpt_type, fpt_id, fpt_linked_at]).toEqual([t0, i0, l0]);
		}
	});

	it('refuses a second link, a row picked from Flow PT, the wrong type, and a Flow PT row already in the request', async () => {
		const { s, production, request } = await issued();
		await s.linkItems(production, request.id, [{ kind: 'shot', key: 'shot-bd-a', fpt: { type: 'Shot', id: 501 } }]);
		const cases: [string, Parameters<typeof s.linkItems>[2]][] = [
			['again', [{ kind: 'shot', key: 'shot-bd-a', fpt: { type: 'Shot', id: 502 } }]],
			['picked', [{ kind: 'shot', key: 'shot-1234', fpt: { type: 'Shot', id: 503 } }]],
			['type', [{ kind: 'shot', key: 'shot-bd-c', fpt: { type: 'Asset', id: 504 } }]],
			['taken', [{ kind: 'shot', key: 'shot-bd-c', fpt: { type: 'Shot', id: 1234 } }]],
			['missing', [{ kind: 'shot', key: 'nope', fpt: { type: 'Shot', id: 505 } }]]
		];
		for (const [what, links] of cases) {
			const error = await refusal(() => s.linkItems(production, request.id, links));
			expect(error.status, what).toBeGreaterThanOrEqual(400);
		}
		const [c] = await sql`select fpt_id from public.request_items where request_id = ${request.id} and key = 'shot-bd-c'`;
		expect(c.fpt_id).toBeNull();
	});

	it('links all or none', async () => {
		const { s, production, request } = await issued();
		await refusal(() =>
			s.linkItems(production, request.id, [
				{ kind: 'shot', key: 'shot-bd-c', fpt: { type: 'Shot', id: 600 } },
				{ kind: 'shot', key: 'shot-1234', fpt: { type: 'Shot', id: 601 } }
			])
		);
		const [c] = await sql`select fpt_id from public.request_items where request_id = ${request.id} and key = 'shot-bd-c'`;
		expect(c.fpt_id).toBeNull();
	});

	it('keeps the freeze in SQL: no other change rides on a link, no unlink, no link on a Flow PT row', async () => {
		const { request } = await issued();
		const before = await sql`select * from public.request_items where request_id = ${request.id} order by position`;
		for (const statement of [
			(tx: postgres.TransactionSql) => tx`update public.request_items set fpt_type = 'Shot', fpt_id = 9, code = 'X' where request_id = ${request.id} and key = 'shot-bd-c'`,
			(tx: postgres.TransactionSql) => tx`update public.request_items set fpt_type = 'Shot', fpt_id = 9, fields = '{}' where request_id = ${request.id} and key = 'shot-bd-a'`,
			(tx: postgres.TransactionSql) => tx`update public.request_items set fpt_type = 'Shot', fpt_id = 9, omitted = true where request_id = ${request.id} and key = 'shot-bd-c'`,
			(tx: postgres.TransactionSql) => tx`update public.request_items set fpt_type = 'Shot', fpt_id = 9 where request_id = ${request.id} and key = 'shot-1234'`,
			(tx: postgres.TransactionSql) => tx`update public.request_items set fpt_type = 'Asset', fpt_id = 9 where request_id = ${request.id} and key = 'shot-bd-c'`,
			(tx: postgres.TransactionSql) => tx`update public.request_items set source = 'fpt' where request_id = ${request.id} and key = 'shot-bd-c'`
		]) {
			const error = await refusal(() => asService(statement));
			expect(error.message).toMatch(/issued request are frozen/);
		}
		await asService((tx) => tx`update public.request_items set fpt_type = 'Shot', fpt_id = 9 where request_id = ${request.id} and key = 'shot-bd-c'`);
		const unlink = await refusal(() => asService((tx) => tx`update public.request_items set fpt_type = null, fpt_id = null where request_id = ${request.id} and key = 'shot-bd-c'`));
		expect(unlink.message).toMatch(/issued request are frozen/);
		const relink = await refusal(() => asService((tx) => tx`update public.request_items set fpt_id = 10 where request_id = ${request.id} and key = 'shot-bd-c'`));
		expect(relink.message).toMatch(/issued request are frozen/);
		const after = await sql`select key, code, fields, omitted, source from public.request_items where request_id = ${request.id} order by position`;
		expect(after).toEqual(before.map(({ key, code, fields, omitted, source }) => ({ key, code, fields, omitted, source })));
	});

	it('is refused once the request is awarded or closed', async () => {
		const { s, production, request } = await issued();
		await asService((tx) => tx`update public.bid_requests set status = 'closed' where id = ${request.id}`);
		const error = await refusal(() => s.linkItems(production, request.id, [{ kind: 'shot', key: 'shot-bd-c', fpt: { type: 'Shot', id: 700 } }]));
		expect(error.message).toMatch(/before the award/);
		const direct = await refusal(() => asService((tx) => tx`update public.request_items set fpt_type = 'Shot', fpt_id = 9 where request_id = ${request.id} and key = 'shot-bd-c'`));
		expect(direct.message).toMatch(/issued request are frozen/);
	});

	it('stays in its tenant', async () => {
		const { s, request } = await issued();
		const error = await refusal(() => s.linkItems(tenant(), request.id, [{ kind: 'shot', key: 'shot-bd-c', fpt: { type: 'Shot', id: 800 } }]));
		expect(error.status).toBe(404);
	});

	it('goes to the next round as it is, with its source and link', async () => {
		const { s, production, request } = await issued();
		await s.linkItems(production, request.id, [{ kind: 'shot', key: 'shot-bd-a', fpt: { type: 'Shot', id: 501 } }]);
		const back = await s.getRequest(production, request.id);
		const next = await s.createDraftRequest(production, { code: 'BD-1', header: header({ round: 2 }), items: { shots: back.shots, assets: back.assets } });
		expect(next.shots.map((x) => [x.id, x.source ?? 'fpt', x.fpt?.id ?? null])).toEqual([
			['shot-1234', 'fpt', 1234],
			['shot-bd-a', 'breakdown', 501],
			['shot-bd-c', 'breakdown', null]
		]);
	});
});
