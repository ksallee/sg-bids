/**
 * Packages: saved with the items, frozen at issue, deleted with the request; a vendor invited to
 * some packages reads and writes the rows of those alone, through every store call and in SQL; its
 * packages change only until it submits; a package priced as one figure covers its rows; a request
 * from before packages still works as one package.
 */
import type postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createComparison } from '$lib/server/comparison';
import { loadBid, loadRequest, saveDraft } from '$lib/server/vendor-api';
import { compareBids } from '$lib/pure/compare';
import type { RequestAsset, RequestPackage, RequestShot } from '$lib/pure/model';
import type { BidDraft } from '$lib/pure/rows';
import { draft, header, refusal, rest, store, superuser, tenant, vendor, vendorIds } from './helpers';

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

const PACKAGES: RequestPackage[] = [
	{ id: 'seq:SQ1', name: 'SQ1' },
	{ id: 'pkg:creature', name: 'Creature' },
	{ id: 'assets', name: 'Assets' }
];

function packedItems(): { shots: RequestShot[]; assets: RequestAsset[]; packages: RequestPackage[] } {
	return {
		shots: [
			{ id: 'sh010', code: 'SH010', fpt: { type: 'Shot', id: 9_100_001 }, omitted: false, assetIds: [], frames: 10, sequence: 'SQ1', package: 'seq:SQ1' },
			{ id: 'sh020', code: 'SH020', fpt: { type: 'Shot', id: 9_100_002 }, omitted: false, assetIds: [], frames: 30, sequence: 'SQ1', package: 'pkg:creature' },
			{ id: 'sh030', code: 'SH030', fpt: { type: 'Shot', id: 9_100_003 }, omitted: false, assetIds: [], frames: 50, sequence: 'SQ1', package: 'pkg:creature' }
		],
		assets: [{ id: 'hero', name: 'Hero', fpt: { type: 'Asset', id: 9_100_004 }, package: 'assets' }],
		packages: PACKAGES
	};
}

/** An issued request with packages, A invited to Creature alone, B to every package. */
async function packedRequest() {
	const s = store();
	const production = tenant();
	const request = await s.createDraftRequest(production, { code: 'PK-1', header: header(), items: packedItems() });
	const a = await s.inviteVendor(production, request.id, { ...vendor('Vendor A'), packages: ['pkg:creature'] });
	const b = await s.inviteVendor(production, request.id, vendor('Vendor B'));
	await s.issueRequest(production, request.id);
	return { s, production, request, a, b };
}

/** The Creature package priced as one figure, in the stored keys. */
function creatureFigure(total = 500_000): BidDraft {
	return {
		...draft(0),
		lines: [
			{ target: { kind: 'shot', id: 'sh020' }, total: { minor: 0, currency: 'USD' }, excluded: false, inPackage: true },
			{ target: { kind: 'shot', id: 'sh030' }, total: { minor: 0, currency: 'USD' }, excluded: false, inPackage: true }
		],
		packages: [{ package: 'pkg:creature', total: { minor: total, currency: 'USD' } }]
	};
}

describe('a request with packages', () => {
	it('saves its packages with its rows, in order, and reads them back', async () => {
		const { s, production, request } = await packedRequest();
		const read = await s.getRequest(production, request.id);
		expect(read.packages).toEqual(PACKAGES);
		expect(read.shots.map((x) => x.package)).toEqual(['seq:SQ1', 'pkg:creature', 'pkg:creature']);
		expect(read.assets[0].package).toBe('assets');
		expect(read.vendors.map((v) => v.packages)).toEqual([['pkg:creature'], undefined]);
	});

	it('refuses a row outside every package, in SQL', async () => {
		const s = store();
		const production = tenant();
		const items = packedItems();
		const error = await refusal(() =>
			s.createDraftRequest(production, { code: 'PK-2', header: header(), items: { ...items, shots: items.shots.map((x) => ({ ...x, package: undefined })) } })
		);
		expect(error.message).toMatch(/Every row of a request with packages sits in one/);
	});

	it('freezes its packages and each row in its package at issue', async () => {
		const { request } = await packedRequest();
		const [{ site_host, project_id }] = await sql`select site_host, project_id from public.bid_requests where id = ${request.id}`;
		for (const statement of [
			(tx: postgres.TransactionSql) => tx`update public.request_packages set name = 'Other' where request_id = ${request.id} and key = 'assets'`,
			(tx: postgres.TransactionSql) => tx`delete from public.request_packages where request_id = ${request.id} and key = 'seq:SQ1'`,
			(tx: postgres.TransactionSql) =>
				tx`insert into public.request_packages (request_id, site_host, project_id, key, name) values (${request.id}, ${site_host}, ${project_id}, 'pkg:new', 'New')`
		]) {
			const error = await refusal(() => asService(statement));
			expect(error.message).toMatch(/packages of an issued request are frozen/);
		}
		const moved = await refusal(() => asService((tx) => tx`update public.request_items set package_key = 'assets' where request_id = ${request.id} and key = 'sh010'`));
		expect(moved.message).toMatch(/items of an issued request are frozen/);
	});

	it('goes whole when the request is deleted', async () => {
		const { s, production, request } = await packedRequest();
		await s.deleteRequest(production, request.id, 'PK-1');
		const [{ n }] = await sql`select count(*)::int as n from public.request_packages where request_id = ${request.id}`;
		expect(n).toBe(0);
	});

	it('keeps its packages through a new round', async () => {
		const s = store();
		const production = tenant();
		const request = await s.createDraftRequest(production, { code: 'PK-3', header: header(), items: packedItems() });
		await s.issueRequest(production, request.id);
		const issued = await s.getRequest(production, request.id);
		const { nextRound } = await import('$lib/pure/persist');
		const next = await s.createDraftRequest(production, { ...nextRound(issued), code: 'PK-3' });
		expect(next.packages).toEqual(PACKAGES);
		expect(next.shots.map((x) => x.package)).toEqual(['seq:SQ1', 'pkg:creature', 'pkg:creature']);
	});
});

describe('a vendor invited to some packages', () => {
	it('reads only the rows and packages of its packages, and nothing of the others', async () => {
		const { s, a } = await packedRequest();
		const view = await loadRequest(s, a.token);
		expect(view.packages).toEqual([{ id: 'pkg:creature', name: 'Creature' }]);
		expect(view.shots.map((x) => x.code)).toEqual(['SH020', 'SH030']);
		expect(view.assets).toEqual([]);
		const text = JSON.stringify(view);
		for (const hidden of ['SH010', 'Hero', 'seq:SQ1', '"id":"assets"', '9100001', '9100004']) expect(text).not.toContain(hidden);
	});

	it('cannot save a line for a row outside its packages: the store refuses it', async () => {
		const { s, a, request } = await packedRequest();
		const ids = await vendorIds(sql, request.id);
		// As the page sends it, plus the row id of a row outside its packages, guessed: refused as not in the request.
		const lines = [
			...creatureFigure().lines.map((l) => ({ ...l, target: { ...l.target, id: ids.get(`shot:${l.target.id}`)! } })),
			{ target: { kind: 'shot' as const, id: ids.get('shot:sh010')! }, total: { minor: 1, currency: 'USD' }, excluded: false }
		];
		const error = await refusal(() => saveDraft(s, a.token, { invitationId: a.invitation.id, bidId: null, draft: { ...creatureFigure(), lines } }));
		expect(error.status).toBe(422);
		expect((await loadBid(s, a.token)).bid).toBeNull();
		// Straight to the store with the stored key: refused too.
		const direct = await refusal(() => s.saveDraftBid(a.token, { ...draft(1), lines: [{ target: { kind: 'shot', id: 'sh010' }, total: { minor: 1, currency: 'USD' }, excluded: false }] }));
		expect(direct.status).toBe(422);
		expect(direct.message).toMatch(/outside your bids/);
	});

	it('cannot price a package it is not invited to', async () => {
		const { s, a } = await packedRequest();
		const error = await refusal(() => s.saveDraftBid(a.token, { ...creatureFigure(), packages: [{ package: 'assets', total: { minor: 5, currency: 'USD' } }] }));
		expect(error.status).toBe(422);
	});

	it('is refused by the database on a line outside its packages, whatever the server does', async () => {
		const { s, a, request } = await packedRequest();
		const bid = await s.saveDraftBid(a.token, creatureFigure());
		const [{ site_host, project_id }] = await sql`select site_host, project_id from public.bids where id = ${bid.id}`;
		const error = await refusal(() =>
			asService(
				(tx) => tx`insert into public.bid_lines (bid_id, invitation_id, request_id, site_host, project_id, item_kind, item_key, total_minor)
					values (${bid.id}, ${a.invitation.id}, ${request.id}, ${site_host}, ${project_id}, 'shot', 'sh010', 5)`
			)
		);
		expect(error.message).toMatch(/not in your packages/);
		const figure = await refusal(() => asService((tx) => tx`update public.bids set packages = ${sql.json([{ package: 'assets', total: { minor: 1, currency: 'USD' } }])} where id = ${bid.id}`));
		expect(figure.message).toMatch(/outside your packages/);
	});

	it('prices its package as one figure: every row in it covered, the figure kept with the bid', async () => {
		const { s, a } = await packedRequest();
		const bid = await s.saveDraftBid(a.token, creatureFigure(750_000));
		expect(bid.packages).toEqual([{ package: 'pkg:creature', total: { minor: 750_000, currency: 'USD' } }]);
		expect(bid.lines.every((l) => l.inPackage && l.total.minor === 0)).toBe(true);
		const submitted = await s.submitBid(a.token, bid.id);
		expect(submitted.status).toBe('submitted');
		const frozen = await refusal(() => asService((tx) => tx`update public.bids set packages = '[]' where id = ${bid.id}`));
		expect(frozen.message).toMatch(/submitted bid is final/);
	});

	it('refuses a figure that leaves a row of its package out', async () => {
		const { s, a } = await packedRequest();
		const half = { ...creatureFigure(), lines: creatureFigure().lines.slice(0, 1) };
		const error = await refusal(() => s.saveDraftBid(a.token, half));
		expect(error.status).toBe(422);
		expect(error.message).toMatch(/Creature is priced as one figure. SH030 has no line in it/);
	});
});

describe('changing a vendor packages', () => {
	it('is allowed until the vendor submits, and refused after with the reason', async () => {
		const { s, production, a } = await packedRequest();
		const wider = await s.setInvitationPackages(production, a.invitation.id, ['pkg:creature', 'assets']);
		expect(wider.packages).toEqual(['pkg:creature', 'assets']);
		expect((await loadRequest(s, a.token)).assets.map((x) => x.name)).toEqual(['Hero']);
		await s.setInvitationPackages(production, a.invitation.id, ['pkg:creature']);
		const bid = await s.saveDraftBid(a.token, creatureFigure());
		await s.submitBid(a.token, bid.id);
		const error = await refusal(() => s.setInvitationPackages(production, a.invitation.id, null));
		expect(error.status).toBe(409);
		expect(error.message).toMatch(/Vendor A has submitted an answer. Its bids are fixed/);
		const inSql = await refusal(() => asService((tx) => tx`update public.invitations set package_keys = null where id = ${a.invitation.id}`));
		expect(inSql.message).toMatch(/packages are fixed/);
	});

	it('refuses a package the request does not have', async () => {
		const { s, production, b } = await packedRequest();
		expect((await refusal(() => s.setInvitationPackages(production, b.invitation.id, ['pkg:nope']))).status).toBe(422);
		const inSql = await refusal(() => asService((tx) => tx`update public.invitations set package_keys = ${['pkg:nope']} where id = ${b.invitation.id}`));
		expect(inSql.message).toMatch(/only packages of its request/);
	});

	it('stops a draft made for wider packages at submit', async () => {
		const { s, production, b } = await packedRequest();
		const all = await s.saveDraftBid(b.token, { ...draft(0), lines: [{ target: { kind: 'shot', id: 'sh010' }, total: { minor: 100, currency: 'USD' }, excluded: false }] });
		await s.setInvitationPackages(production, b.invitation.id, ['pkg:creature']);
		const error = await refusal(() => s.submitBid(b.token, all.id));
		expect(error.status).toBe(409);
		expect(error.message).toMatch(/Your bids changed/);
		// Its reads hold the rows of its packages alone now: the line outside them is not shown.
		expect((await loadBid(s, b.token)).bid?.lines).toEqual([]);
	});
});

describe('a request from before packages', () => {
	it('reads as one package, takes no package list, and lets a vendor price it as one figure', async () => {
		const s = store();
		const production = tenant();
		const plain = packedItems();
		const request = await s.createDraftRequest(production, {
			code: 'OLD-1',
			header: header(),
			items: { shots: plain.shots.map(({ package: _, ...x }) => x), assets: plain.assets.map(({ package: _, ...x }) => x) }
		});
		expect(request.packages).toBeUndefined();
		const refused = await refusal(() => s.inviteVendor(production, request.id, { ...vendor('Old'), packages: ['all'] }));
		expect(refused.status).toBe(422);
		const v = await s.inviteVendor(production, request.id, vendor('Old'));
		await s.issueRequest(production, request.id);
		const view = await loadRequest(s, v.token);
		expect(view.packages).toEqual([{ id: 'all', name: 'All shots and assets' }]);
		expect(view.shots.every((x) => x.package === 'all')).toBe(true);
		const covered = [...plain.shots.map((x) => ({ kind: 'shot' as const, id: x.id })), { kind: 'asset' as const, id: 'hero' }].map((target) => ({
			target,
			total: { minor: 0, currency: 'USD' },
			excluded: false,
			inPackage: true
		}));
		const bid = await s.saveDraftBid(v.token, { ...draft(0), lines: covered, packages: [{ package: 'all', total: { minor: 900, currency: 'USD' } }] });
		expect(bid.packages?.[0].total.minor).toBe(900);
	});

	it('keeps a request saved through the call from before packages whole: its packages go', async () => {
		const s = store();
		const production = tenant();
		const request = await s.createDraftRequest(production, { code: 'OLD-2', header: header(), items: packedItems() });
		const [{ site_host, project_id }] = await sql`select site_host, project_id from public.bid_requests where id = ${request.id}`;
		await asService(
			(tx) => tx`select * from public.sg_save_request_items(${request.id}, ${site_host}, ${project_id}, ${sql.json([{ kind: 'shot', key: 'sh010', code: 'SH010', package_key: 'seq:SQ1' }])})`
		);
		const read = await s.getRequest(production, request.id);
		expect(read.packages).toBeUndefined();
		expect(read.shots.map((x) => x.package)).toEqual([undefined]);
	});
});

describe('the comparison of a package priced as one figure', () => {
	it('loads the packages, compares the package as a unit, and refuses a scenario with part of it', async () => {
		const { s, production, request, a, b } = await packedRequest();
		const one = await s.saveDraftBid(a.token, creatureFigure(80_000));
		await s.submitBid(a.token, one.id);
		const rows = await s.saveDraftBid(b.token, {
			...draft(0),
			lines: [
				{ target: { kind: 'shot', id: 'sh010' }, total: { minor: 10_000, currency: 'USD' }, excluded: false },
				{ target: { kind: 'shot', id: 'sh020' }, total: { minor: 30_000, currency: 'USD' }, excluded: false },
				{ target: { kind: 'shot', id: 'sh030' }, total: { minor: 60_000, currency: 'USD' }, excluded: false }
			]
		});
		await s.submitBid(b.token, rows.id);
		const comparison = createComparison(rest('service_role'));
		const data = await comparison.loadComparison(production, request.id);
		expect(data.request.packages).toEqual(PACKAGES);
		const grid = compareBids(data.request, data.bids);
		const creature = grid.packages.find((p) => p.id === 'pkg:creature')!;
		const column = grid.columns.findIndex((c) => c.bidId === one.id);
		expect(creature.cells[column]).toMatchObject({ kind: 'package', lowest: true, amount: { base: { minor: 80_000, currency: 'USD' } } });
		expect(creature.cells[1 - column]).toMatchObject({ kind: 'rows', complete: true, lowest: false, amount: { base: { minor: 90_000, currency: 'USD' } } });

		const partial = await refusal(() =>
			comparison.saveScenario(production, request.id, { name: 'Part', picks: [{ target: { kind: 'shot', id: 'sh020' }, shares: [{ bidId: one.id, percent: '100' }] }], costsLeftOut: [] })
		);
		expect(partial.status).toBe(422);
		expect(partial.message).toBe('Vendor A priced Creature as one figure. It is awarded whole or not at all.');
		const whole = await comparison.saveScenario(production, request.id, {
			name: 'Whole',
			picks: ['sh020', 'sh030'].map((id) => ({ target: { kind: 'shot' as const, id }, shares: [{ bidId: one.id, percent: '100' }] })),
			costsLeftOut: []
		});
		expect(whole.picks).toHaveLength(2);
	});
});

describe('a package the vendor is not bidding on', () => {
	it('takes no line, needs no price, is kept with the bid, and one package is bid on at least', async () => {
		const { s, b } = await packedRequest();
		const declining: BidDraft = {
			...draft(0),
			lines: [{ target: { kind: 'shot', id: 'sh010' }, total: { minor: 5_000, currency: 'USD' }, excluded: false }],
			declined: ['pkg:creature', 'assets']
		};
		const saved = await s.saveDraftBid(b.token, declining);
		expect(saved.declined).toEqual(['pkg:creature', 'assets']);
		const priced = await refusal(() => s.saveDraftBid(b.token, { ...declining, lines: [...declining.lines, { target: { kind: 'shot', id: 'sh020' }, total: { minor: 1, currency: 'USD' }, excluded: false }] }));
		expect(priced.status).toBe(422);
		expect(priced.message).toMatch(/SH020 is in Creature, which you are not bidding on/);
		const none = await s.saveDraftBid(b.token, { ...declining, lines: [], declined: ['seq:SQ1', 'pkg:creature', 'assets'] });
		const error = await refusal(() => s.submitBid(b.token, none.id));
		expect(error.status).toBe(422);
		expect(error.message).toBe('Answer one bid at least.');
		const back = await s.saveDraftBid(b.token, declining);
		expect((await s.submitBid(b.token, back.id)).declined).toEqual(['pkg:creature', 'assets']);
	});
});

