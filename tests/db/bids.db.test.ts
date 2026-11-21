/**
 * Bids first: production's bids saved, cloned, moved between and deleted in their tenant; a request
 * made from bids references them while a draft and copies their rows at the issue, with the links of
 * the vendors added to the draft; a bid edited after the issue changes nothing issued and goes out
 * again; a row in two bids refuses the issue; deleting a bid leaves its drafts and keeps what was
 * issued; and the drafts made before bids turn into their bids without a row lost or changed.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { loadRequest } from '$lib/server/vendor-api';
import { createProductionBids } from '$lib/server/production-bids';
import type { RequestAsset, RequestShot } from '$lib/pure/model';
import { header, refusal, rest, store, superuser, tenant, vendor } from './helpers';

const sql = superuser();
const bids = () => createProductionBids(rest('service_role'));

afterAll(async () => {
	await sql.end();
});

const seqShots: RequestShot[] = [
	{ id: 'shot-9200001', code: 'SH010', fpt: { type: 'Shot', id: 9_200_001 }, omitted: false, assetIds: [], frames: 48, sequence: 'SQ1', notes: 'Keep the rain' },
	{ id: 'shot-9200002', code: 'SH020', fpt: { type: 'Shot', id: 9_200_002 }, omitted: true, assetIds: [], frames: 24, sequence: 'SQ1' }
];
const creatureShots: RequestShot[] = [{ id: 'shot-bd-1', code: 'CR010', source: 'breakdown', omitted: false, assetIds: [], frames: 100, description: 'Creature lands' }];
const creatureAssets: RequestAsset[] = [{ id: 'asset-bd-1', name: 'Creature', source: 'breakdown', difficulty: 'Hard' }];

async function twoBids() {
	const production = tenant();
	const b = bids();
	const seq = await b.save(production, { id: null, name: 'SEQ010', shots: seqShots, assets: [] });
	const creature = await b.save(production, { id: null, name: 'Creature', shots: creatureShots, assets: creatureAssets });
	return { production, b, s: store(), seq: seq.bid, creature: creature.bid };
}

describe('a production bid', () => {
	it('saves its name and rows, in order, and keeps its counts', async () => {
		const { production, b, seq } = await twoBids();
		const read = await b.get(production, seq.id);
		expect(read.bid.name).toBe('SEQ010');
		expect(read.bid.shots).toEqual(seqShots);
		const [row] = await sql`select shot_count, asset_count, omitted_count, frame_count from public.production_bids where id = ${seq.id}`;
		expect(row).toEqual({ shot_count: 1, asset_count: 0, omitted_count: 1, frame_count: '48' });
		const listed = await b.list(production);
		expect(listed.map((x) => [x.name, x.shots, x.assets, x.frames])).toEqual([
			['Creature', 1, 1, 100],
			['SEQ010', 1, 0, 48]
		]);
	});

	it('replaces its rows and name on a save, and answers 404 for another tenant', async () => {
		const { production, b, seq } = await twoBids();
		const next = await b.save(production, { id: seq.id, name: 'SEQ010 v2', shots: [seqShots[0]], assets: [] });
		expect(next.bid.name).toBe('SEQ010 v2');
		expect(next.bid.shots.map((x) => x.id)).toEqual(['shot-9200001']);
		const other = tenant(production.siteHost);
		for (const call of [() => b.get(other, seq.id), () => b.save(other, { id: seq.id, name: 'X', shots: [], assets: [] }), () => b.clone(other, seq.id), () => b.remove(other, seq.id)]) {
			expect((await refusal(call)).status).toBe(404);
		}
		expect(await b.list(other)).toEqual([]);
	});

	it('clones as <name> copy, then <name> copy 2, with every row, apart from the original', async () => {
		const { production, b, seq } = await twoBids();
		const one = await b.clone(production, seq.id);
		const two = await b.clone(production, seq.id);
		expect([one.bid.name, two.bid.name]).toEqual(['SEQ010 copy', 'SEQ010 copy 2']);
		expect(one.bid.shots).toEqual(seqShots);
		await b.save(production, { id: one.bid.id, name: one.bid.name, shots: [], assets: [] });
		expect((await b.get(production, seq.id)).bid.shots).toEqual(seqShots);
	});

	it('moves or copies rows to another bid, leaving a row the other holds as it is', async () => {
		const { production, b, seq, creature } = await twoBids();
		const copied = await b.moveRows(production, { from: seq.id, to: creature.id, rows: [{ kind: 'shot', id: 'shot-9200001' }], move: false });
		expect(copied.taken).toBe(1);
		expect(copied.from.bid.shots.map((x) => x.id)).toEqual(['shot-9200001', 'shot-9200002']);
		const again = await b.moveRows(production, { from: seq.id, to: creature.id, rows: [{ kind: 'shot', id: 'shot-9200001' }, { kind: 'shot', id: 'shot-9200002' }], move: true });
		expect(again.taken).toBe(1);
		expect(again.from.bid.shots).toEqual([]);
		const target = await b.get(production, creature.id);
		expect(target.bid.shots.map((x) => x.id)).toEqual(['shot-bd-1', 'shot-9200001', 'shot-9200002']);
		expect(target.bid.shots[1]).toEqual(seqShots[0]);
	});

	it('is never read by a vendor: a vendor principal has no grant on it', async () => {
		const { seq } = await twoBids();
		const vendorStore = createProductionBids(rest('service_role'));
		const error = await refusal(() => vendorStore.get({ kind: 'vendor', invitationId: 'i', requestId: 'r' } as never, seq.id));
		expect(error.message).toMatch(/may not read production_bids/);
	});
});

describe('a request made from bids', () => {
	it('references its bids while a draft: it reads as they are now, each a package named as its bid', async () => {
		const { production, b, s, seq, creature } = await twoBids();
		const draft = await s.createDraftRequest(production, { code: 'BF-1', header: header(), bids: [seq.id, creature.id] });
		expect(draft.packages).toEqual([
			{ id: `bid:${seq.id}`, name: 'SEQ010', bid: seq.id },
			{ id: `bid:${creature.id}`, name: 'Creature', bid: creature.id }
		]);
		expect(draft.shots.map((x) => [x.code, x.package])).toEqual([
			['SH010', `bid:${seq.id}`],
			['SH020', `bid:${seq.id}`],
			['CR010', `bid:${creature.id}`]
		]);
		await b.save(production, { id: creature.id, name: 'Creature', shots: creatureShots, assets: [] });
		expect((await s.getRequest(production, draft.id)).assets).toEqual([]);
		const [{ n }] = await sql`select count(*)::int as n from public.request_items where request_id = ${draft.id}`;
		expect(n).toBe(0);
	});

	it('issues: copies each bid’s rows, makes the links of the vendors added to the draft, and a vendor reads its bids alone', async () => {
		const { production, b, s, seq, creature } = await twoBids();
		const draft = await s.createDraftRequest(production, { code: 'BF-2', header: header(), bids: [seq.id, creature.id] });
		const a = await s.planVendor(production, draft.id, { ...vendor('Vendor A'), packages: [`bid:${creature.id}`] });
		await s.planVendor(production, draft.id, vendor('Vendor B'));
		const before = await sql`select token_hash from public.invitations where id = ${a.id}`;

		const { request, links } = await s.issue(production, draft.id);
		expect(links.map((l) => l.invitation.name)).toEqual(['Vendor A', 'Vendor B']);
		expect(links.every((l) => l.token.length > 20)).toBe(true);
		const after = await sql`select token_hash, link_pending from public.invitations where id = ${a.id}`;
		expect(after[0].token_hash).not.toBe(before[0].token_hash);
		expect(after[0].link_pending).toBe(false);

		const items = await sql`select kind, key, code, package_key, omitted, fields from public.request_items where request_id = ${draft.id} order by position`;
		expect(items.map((i) => [i.code, i.package_key])).toEqual([
			['SH010', `bid:${seq.id}`],
			['SH020', `bid:${seq.id}`],
			['CR010', `bid:${creature.id}`],
			['Creature', `bid:${creature.id}`]
		]);
		expect(request.shots.find((x) => x.code === 'SH010')).toEqual({ ...seqShots[0], package: `bid:${seq.id}` });

		const view = await loadRequest(s, links[0].token);
		expect(view.packages).toEqual([{ id: `bid:${creature.id}`, name: 'Creature' }]);
		expect(view.shots.map((x) => x.code)).toEqual(['CR010']);
		const text = JSON.stringify(view);
		for (const hidden of ['SH010', '9200001', '"bid":']) expect(text).not.toContain(hidden);

		// Edited after the issue: nothing issued changes, and the bid goes out again in another request.
		await b.save(production, { id: creature.id, name: 'Creature v2', shots: [], assets: creatureAssets });
		const issued = await s.getRequest(production, draft.id);
		expect(issued.shots.map((x) => x.code)).toEqual(['SH010', 'SH020', 'CR010']);
		expect(issued.packages?.map((p) => p.name)).toEqual(['SEQ010', 'Creature']);
		const second = await s.createDraftRequest(production, { code: 'BF-3', header: header(), bids: [creature.id] });
		await s.planVendor(production, second.id, vendor('Vendor C'));
		await s.issue(production, second.id);
		expect((await s.getRequest(production, second.id)).packages?.map((p) => p.name)).toEqual(['Creature v2']);
		const loaded = await b.get(production, creature.id);
		expect(loaded.requests.map((r) => [r.code, r.status]).sort()).toEqual([
			['BF-2', 'issued'],
			['BF-3', 'issued']
		]);
	});

	it('names packages from bids of one name apart, as the draft showed them', async () => {
		const { production, b, s, seq } = await twoBids();
		const twin = await b.save(production, { id: null, name: 'seq010', shots: [], assets: creatureAssets });
		const draft = await s.createDraftRequest(production, { code: 'BF-4', header: header(), bids: [seq.id, twin.bid.id] });
		expect(draft.packages?.map((p) => p.name)).toEqual(['SEQ010', 'seq010 2']);
		await s.issue(production, draft.id);
		expect((await s.getRequest(production, draft.id)).packages?.map((p) => p.name)).toEqual(['SEQ010', 'seq010 2']);
	});

	it('refuses to issue a row in two bids, naming it, and changes nothing', async () => {
		const { production, b, s, seq } = await twoBids();
		const copy = await b.clone(production, seq.id);
		const draft = await s.createDraftRequest(production, { code: 'BF-5', header: header(), bids: [seq.id, copy.bid.id] });
		const view = await s.getDraftView(production, draft.id);
		expect(view.overlaps.map((o) => o.code)).toEqual(['SH010', 'SH020']);
		const error = await refusal(() => s.issue(production, draft.id));
		expect(error.status).toBe(409);
		expect(error.message).toBe('SH010 is in SEQ010 and in SEQ010 copy. A request takes each row once.');
		const [row] = await sql`select status from public.bid_requests where id = ${draft.id}`;
		expect(row.status).toBe('draft');
	});

	it('sets a draft’s bids: keeps a vendor’s choice of a bid kept, and refuses to leave a vendor with none', async () => {
		const { production, b, s, seq, creature } = await twoBids();
		const third = await b.save(production, { id: null, name: 'Third', shots: [], assets: [{ id: 'asset-x', name: 'X' }] });
		const draft = await s.createDraftRequest(production, { code: 'BF-6', header: header(), bids: [seq.id, creature.id, third.bid.id] });
		const a = await s.planVendor(production, draft.id, { ...vendor('Vendor A'), packages: [`bid:${creature.id}`, `bid:${third.bid.id}`] });
		await s.setRequestBids(production, draft.id, [creature.id, seq.id]);
		const read = await s.getRequest(production, draft.id);
		expect(read.packages?.map((p) => p.name)).toEqual(['Creature', 'SEQ010']);
		expect(read.vendors.find((v) => v.id === a.id)?.packages).toEqual([`bid:${creature.id}`]);
		const error = await refusal(() => s.setRequestBids(production, draft.id, [seq.id]));
		expect(error.message).toBe('Vendor A is invited to none of these bids. Give it one first.');
		expect((await refusal(() => s.setRequestBids(tenant(production.siteHost), draft.id, [seq.id]))).status).toBe(404);
		const foreign = await bids().save(tenant(), { id: null, name: 'Elsewhere', shots: [], assets: [] });
		expect((await refusal(() => s.setRequestBids(production, draft.id, [foreign.bid.id]))).message).toBe('A bid is not in this project.');
	});

	it('removes a vendor added to the draft, and only while its link was never made', async () => {
		const { production, s, seq } = await twoBids();
		const draft = await s.createDraftRequest(production, { code: 'BF-7', header: header(), bids: [seq.id] });
		const a = await s.planVendor(production, draft.id, vendor('Vendor A'));
		const b2 = await s.planVendor(production, draft.id, vendor('Vendor B'));
		await s.removePlannedVendor(production, a.id);
		await s.issue(production, draft.id);
		expect((await refusal(() => s.removePlannedVendor(production, b2.id))).status).toBe(404);
		const rows = await sql`select vendor_name from public.invitations where request_id = ${draft.id}`;
		expect(rows.map((r) => r.vendor_name)).toEqual(['Vendor B']);
	});

	it('refuses bids on a draft that holds rows of its own', async () => {
		const { production, s, seq } = await twoBids();
		const legacy = await s.createDraftRequest(production, { code: 'BF-8', header: header(), items: { shots: seqShots, assets: [] } });
		expect((await refusal(() => s.setRequestBids(production, legacy.id, [seq.id]))).message).toBe('This draft holds rows of its own. It takes no bids.');
	});
});

describe('deleting a bid', () => {
	it('takes it out of its drafts, with each vendor’s choice of it, and keeps what was issued', async () => {
		const { production, b, s, seq, creature } = await twoBids();
		const issued = await s.createDraftRequest(production, { code: 'BD-1', header: header(), bids: [seq.id, creature.id] });
		await s.issue(production, issued.id);
		const draft = await s.createDraftRequest(production, { code: 'BD-2', header: header(), bids: [seq.id, creature.id] });
		const a = await s.planVendor(production, draft.id, { ...vendor('Vendor A'), packages: [`bid:${seq.id}`, `bid:${creature.id}`] });

		const facts = await b.deletionFacts(production, seq.id);
		expect(facts.drafts.map((d) => d.code)).toEqual(['BD-2']);
		expect(facts.issued.map((d) => d.code)).toEqual(['BD-1']);

		const gone = await b.remove(production, seq.id);
		expect(gone).toEqual({ name: 'SEQ010', drafts: [{ id: draft.id, code: 'BD-2', round: 1 }], issued: [{ id: issued.id, code: 'BD-1', round: 1 }] });
		const left = await s.getRequest(production, draft.id);
		expect(left.packages?.map((p) => p.name)).toEqual(['Creature']);
		expect(left.vendors.find((v) => v.id === a.id)?.packages).toEqual([`bid:${creature.id}`]);
		const kept = await s.getRequest(production, issued.id);
		expect(kept.shots.map((x) => x.code)).toEqual(['SH010', 'SH020', 'CR010']);
		expect(kept.packages?.map((p) => [p.name, p.bid])).toEqual([
			['SEQ010', undefined],
			['Creature', creature.id]
		]);
	});

	it('is refused while a vendor of a draft is invited to it alone', async () => {
		const { production, b, s, seq, creature } = await twoBids();
		const draft = await s.createDraftRequest(production, { code: 'BD-3', header: header(), bids: [seq.id, creature.id] });
		await s.planVendor(production, draft.id, { ...vendor('Vendor A'), packages: [`bid:${seq.id}`] });
		const error = await refusal(() => b.remove(production, seq.id));
		expect(error.message).toBe('Vendor A is invited to this bid alone in a draft request. Give it another bid first.');
		expect((await b.get(production, seq.id)).bid.name).toBe('SEQ010');
	});

	it('leaves the bids of a deleted draft request', async () => {
		const { production, b, s, seq } = await twoBids();
		const draft = await s.createDraftRequest(production, { code: 'BD-4', header: header(), bids: [seq.id] });
		await s.deleteRequest(production, draft.id, 'BD-4');
		expect((await b.get(production, seq.id)).requests).toEqual([]);
	});
});

describe('the drafts made before bids', () => {
	async function legacy(production: ReturnType<typeof tenant>, code: string, packaged: boolean) {
		const s = store();
		const shots: RequestShot[] = [
			{ ...seqShots[0], ...(packaged ? { package: 'seq:SQ1' } : {}) },
			{ ...seqShots[1], ...(packaged ? { package: 'pkg:x' } : {}) },
			{ ...creatureShots[0], ...(packaged ? { package: 'pkg:x' } : {}) }
		];
		const assets: RequestAsset[] = [{ ...creatureAssets[0], ...(packaged ? { package: 'assets' } : {}) }];
		const packages = packaged
			? [
					{ id: 'seq:SQ1', name: 'SQ1' },
					{ id: 'pkg:x', name: 'Creature work' },
					{ id: 'assets', name: 'Assets' },
					{ id: 'pkg:empty', name: 'Empty one' }
				]
			: undefined;
		return s.createDraftRequest(production, { code, header: header({ title: `Title ${code}` }), items: { shots, assets, packages } });
	}

	it('turn into their bids, one per package or one for a draft from before packages, with every row as it was', async () => {
		const s = store();
		const production = tenant();
		const packaged = await legacy(production, 'LG-1', true);
		const plain = await legacy(production, 'LG-2', false);
		const a = await s.inviteVendor(production, packaged.id, { ...vendor('Vendor A'), packages: ['pkg:x'] });
		const issued = await legacy(production, 'LG-3', true);
		await s.issueRequest(production, issued.id);
		const empty = await s.createDraftRequest(production, { code: 'LG-4', header: header({ title: 'Nothing yet' }) });
		const rowsBefore = await sql`select request_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted, source, package_key
			from public.request_items where request_id in ${sql([packaged.id, plain.id])} order by request_id, position`;
		const issuedBefore = await sql`select * from public.request_items where request_id = ${issued.id} order by position`;

		const [{ turned }] = await sql`select public.sg_bids_first_convert() as turned`;
		expect(turned).toBeGreaterThanOrEqual(2);

		const made = await sql`select b.id, b.name, b.shot_count, b.asset_count, b.omitted_count, b.frame_count, p.request_id, p.key
			from public.production_bids b join public.request_packages p on p.bid_id = b.id
			where p.request_id in ${sql([packaged.id, plain.id])} order by p.request_id = ${plain.id}, p.position`;
		expect(made.map((m) => [m.name, m.key])).toEqual([
			['SQ1', 'seq:SQ1'],
			['Creature work', 'pkg:x'],
			['Assets', 'assets'],
			['Empty one', 'pkg:empty'],
			['Title LG-2', `bid:${made[4].id}`]
		]);
		const rowsAfter = await sql`select p.request_id, i.kind, i.key, i.code, i.position, i.fpt_type, i.fpt_id, i.fields, i.omitted, i.source, p.key as package_key
			from public.production_bid_items i join public.request_packages p on p.bid_id = i.bid_id
			where p.request_id in ${sql([packaged.id, plain.id])} order by p.request_id, i.position`;
		const strip = (rows: typeof rowsBefore, plainId: string) => rows.map((r) => ({ ...r, package_key: r.request_id === plainId ? null : r.package_key }));
		expect(strip(rowsAfter, plain.id)).toEqual(strip(rowsBefore, plain.id));
		const [{ n }] = await sql`select count(*)::int as n from public.request_items where request_id in ${sql([packaged.id, plain.id])}`;
		expect(n).toBe(0);

		// The drafts read as before, a vendor's choice of a package stands, and they issue.
		const read = await s.getRequest(production, packaged.id);
		expect(read.packages?.map((p) => p.name)).toEqual(['SQ1', 'Creature work', 'Assets', 'Empty one']);
		expect(read.shots.map((x) => [x.code, x.package])).toEqual([
			['SH010', 'seq:SQ1'],
			['SH020', 'pkg:x'],
			['CR010', 'pkg:x']
		]);
		expect(read.vendors.find((v) => v.id === a.invitation.id)?.packages).toEqual(['pkg:x']);
		await s.issue(production, packaged.id);
		const view = await loadRequest(s, a.token);
		expect(view.shots.map((x) => x.code)).toEqual(['SH020', 'CR010']);

		// An issued request and an empty draft are not touched; applied again, nothing turns.
		expect(await sql`select * from public.request_items where request_id = ${issued.id} order by position`).toEqual(issuedBefore);
		const [{ links }] = await sql`select count(*)::int as links from public.request_packages where request_id in ${sql([issued.id, empty.id])} and bid_id is not null`;
		expect(links).toBe(0);
		const [{ again }] = await sql`select public.sg_bids_first_convert() as again`;
		expect(again).toBe(0);
	});
});
