/**
 * One page per request: a draft owns its bids, saved with their rows and its vendors in one write; a
 * row sits in one bid of a request; a vendor is kept half typed until the issue; the issue copies
 * the rows, makes the links, refuses an empty bid or a half typed vendor, and the draft's bids go;
 * deleting a draft takes its bids; and the data from before (bids of their own, drafts that named
 * them) turns into drafts that own their bids, with no row lost.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { loadRequest } from '$lib/server/vendor-api';
import type { RequestAsset, RequestShot } from '$lib/pure/model';
import type { SavedBid } from '$lib/pure/request-draft';
import type { DraftVendor } from '$lib/server/store';
import { header, refusal, rest, store, superuser, tenant } from './helpers';

const sql = superuser();

afterAll(async () => {
	await sql.end();
});

const seqShots: RequestShot[] = [
	{ id: 'shot-9300001', code: 'SH010', fpt: { type: 'Shot', id: 9_300_001 }, omitted: false, assetIds: [], frames: 48, sequence: 'SQ1', notes: 'Keep the rain' },
	{ id: 'shot-9300002', code: 'SH020', fpt: { type: 'Shot', id: 9_300_002 }, omitted: true, assetIds: [], frames: 24, sequence: 'SQ1' }
];
const creatureShots: RequestShot[] = [{ id: 'shot-bd-1', code: 'CR010', source: 'breakdown', omitted: false, assetIds: [], frames: 100, description: 'Creature lands' }];
const creatureAssets: RequestAsset[] = [{ id: 'asset-bd-1', name: 'Creature', source: 'breakdown', difficulty: 'Hard' }];

const bids = (): SavedBid[] => [
	{ key: 'bid:seq', name: 'SEQ010', shots: seqShots, assets: [] },
	{ key: 'bid:creature', name: 'Creature', shots: creatureShots, assets: creatureAssets }
];

const vendorRow = (name: string, extra: Partial<DraftVendor> = {}): DraftVendor => ({
	id: randomUUID(),
	name,
	email: `${name.toLowerCase().replace(/\W/g, '')}@example.com`,
	group: null,
	bids: null,
	...extra
});

async function draft(code = 'OP-1') {
	const s = store();
	const production = tenant();
	const a = vendorRow('Vendor A', { group: { id: 41, name: 'Vendor A Group' }, bids: ['bid:creature'] });
	const b = vendorRow('Vendor B');
	const request = await s.createDraftRequest(production, { code, header: header({ title: 'Rooftop' }), bids: bids(), vendors: [a, b] });
	return { s, production, request, a, b };
}

describe('a draft request', () => {
	it('owns its bids: each a package of the request, its rows in it, in order', async () => {
		const { request } = await draft();
		expect(request.packages?.map((p) => [p.id, p.name])).toEqual([
			['bid:seq', 'SEQ010'],
			['bid:creature', 'Creature']
		]);
		expect(request.shots.map((x) => [x.code, x.package])).toEqual([
			['SH010', 'bid:seq'],
			['SH020', 'bid:seq'],
			['CR010', 'bid:creature']
		]);
		expect(request.shots[0]).toEqual({ ...seqShots[0], package: 'bid:seq' });
		const [row] = await sql`select count(*)::int as n from public.production_bids where request_id = ${request.id}`;
		expect(row.n).toBe(2);
		const [{ n }] = await sql`select count(*)::int as n from public.request_items where request_id = ${request.id}`;
		expect(n).toBe(0);
	});

	it('keeps its vendors as added, their links made at the issue, each with its Group and its bids', async () => {
		const { request, a } = await draft();
		const mine = request.vendors.find((v) => v.id === a.id);
		expect(mine).toEqual({ id: a.id, name: 'Vendor A', email: 'vendora@example.com', fpt: { type: 'Group', id: 41 }, groupName: 'Vendor A Group', ndaExecuted: false, packages: ['bid:creature'] });
		const rows = await sql`select link_pending from public.invitations where request_id = ${request.id}`;
		expect(rows.every((r) => r.link_pending)).toBe(true);
	});

	it('saves its page in one write: a bid renamed, a row moved, a bid added, a bid gone with its rows', async () => {
		const { s, production, request, a } = await draft();
		const next: SavedBid[] = [
			{ key: 'bid:seq', name: 'Rooftop shots', shots: [seqShots[0]], assets: [] },
			{ key: 'bid:new', name: 'Bid 2', shots: [seqShots[1]], assets: [] }
		];
		await s.saveDraft(production, request.id, { bids: next });
		const read = await s.getRequest(production, request.id);
		expect(read.packages?.map((p) => [p.id, p.name])).toEqual([
			['bid:seq', 'Rooftop shots'],
			['bid:new', 'Bid 2']
		]);
		expect(read.shots.map((x) => [x.code, x.package])).toEqual([
			['SH010', 'bid:seq'],
			['SH020', 'bid:new']
		]);
		expect(read.assets).toEqual([]);
		// Vendor A answered the bid that went: it answers every bid now.
		expect(read.vendors.find((v) => v.id === a.id)?.packages).toBeUndefined();
		const [{ n }] = await sql`select count(*)::int as n from public.production_bids where request_id = ${request.id}`;
		expect(n).toBe(2);
		const counts = await sql`select name, shot_count, omitted_count, frame_count from public.production_bids where request_id = ${request.id} order by name`;
		expect(counts.map((c) => [c.name, c.shot_count, c.omitted_count, Number(c.frame_count)])).toEqual([
			['Bid 2', 0, 1, 0],
			['Rooftop shots', 1, 0, 48]
		]);
	});

	it('lets two bids trade their names in one save', async () => {
		const { s, production, request } = await draft();
		const [one, two] = bids();
		await s.saveDraft(production, request.id, { bids: [{ ...one, name: 'Creature' }, { ...two, name: 'SEQ010' }] });
		expect((await s.getRequest(production, request.id)).packages?.map((p) => p.name)).toEqual(['Creature', 'SEQ010']);
	});

	it('keeps a vendor half typed, takes off one left out, and adds a new one', async () => {
		const { s, production, request, a } = await draft();
		const half = vendorRow('', { email: 'bids@' });
		await s.saveDraft(production, request.id, { vendors: [a, half] });
		const read = await s.getRequest(production, request.id);
		expect(read.vendors.map((v) => [v.name, v.email])).toEqual([
			['Vendor A', 'vendora@example.com'],
			['', 'bids@']
		]);
	});

	it('refuses a row in two bids, naming it, and changes nothing', async () => {
		const { s, production, request } = await draft();
		const twice: SavedBid[] = [
			{ key: 'bid:seq', name: 'SEQ010', shots: seqShots, assets: [] },
			{ key: 'bid:creature', name: 'Creature', shots: [seqShots[0]], assets: [] }
		];
		const error = await refusal(() => s.saveDraft(production, request.id, { bids: twice }));
		expect(error.status).toBe(422);
		expect(error.message).toBe('A row sits in one bid. SH010 is in SEQ010 and in Creature.');
		// The database holds it too.
		const tenantOf = { p_request_id: request.id, p_site_host: production.siteHost, p_project_id: production.projectId, p_vendors: null };
		const item = { kind: 'shot', key: 'shot-x', code: 'X', fpt_type: null, fpt_id: null, fields: {}, omitted: false, source: 'breakdown' };
		const direct = await rest('service_role').rpc('sg_save_draft', {
			...tenantOf,
			p_bids: [
				{ key: 'bid:a', name: 'A', items: [item] },
				{ key: 'bid:b', name: 'B', items: [item] }
			]
		});
		expect(direct.error?.code).toBe('23505');
		expect((await s.getRequest(production, request.id)).shots.map((x) => x.code)).toEqual(['SH010', 'SH020', 'CR010']);
	});

	it('refuses two bids of one name, and a request with no bid', async () => {
		const { s, production, request } = await draft();
		const [one, two] = bids();
		expect((await refusal(() => s.saveDraft(production, request.id, { bids: [one, { ...two, name: 'seq010' }] }))).message).toBe('Two bids have the same name. Give each its own.');
		expect((await refusal(() => s.saveDraft(production, request.id, { bids: [] }))).message).toBe('A request holds one bid at least.');
	});

	it('is another tenant’s: not read, not saved', async () => {
		const { s, production, request } = await draft();
		const other = tenant(production.siteHost);
		expect((await refusal(() => s.getRequest(other, request.id))).status).toBe(404);
		expect((await refusal(() => s.saveDraft(other, request.id, { bids: bids() }))).status).toBe(404);
	});

	it('takes its bids and their rows with it when deleted', async () => {
		const { s, production, request } = await draft();
		const gone = await s.deleteRequest(production, request.id, 'Rooftop');
		expect(gone.items).toBe(4);
		expect(gone.title).toBe('Rooftop');
		const [{ n }] = await sql`select count(*)::int as n from public.production_bids where request_id = ${request.id}`;
		expect(n).toBe(0);
		const [{ m }] = await sql`select count(*)::int as m from public.production_bid_items where request_id = ${request.id}`;
		expect(m).toBe(0);
	});
});

describe('issuing a draft', () => {
	it('refuses a bid with no row, and a vendor without a name or an email, naming them', async () => {
		const { s, production, request, a, b } = await draft();
		await s.saveDraft(production, request.id, { bids: [...bids(), { key: 'bid:empty', name: 'Empty one', shots: [], assets: [] }] });
		expect((await refusal(() => s.issue(production, request.id))).message).toBe('Empty one holds no row. Add rows to it or delete it.');
		await s.saveDraft(production, request.id, { bids: bids(), vendors: [a, { ...b, email: 'nope' }] });
		expect((await refusal(() => s.issue(production, request.id))).message).toBe('Vendor B needs a name and an email.');
		const [{ status }] = await sql`select status from public.bid_requests where id = ${request.id}`;
		expect(status).toBe('draft');
	});

	it('copies each bid’s rows under its package, makes the links once, and the draft’s bids go', async () => {
		const { s, production, request, a } = await draft();
		const { request: issued, links } = await s.issue(production, request.id);
		expect(links.map((l) => l.invitation.name)).toEqual(['Vendor A', 'Vendor B']);
		const items = await sql`select code, package_key from public.request_items where request_id = ${request.id} order by position`;
		expect(items.map((i) => [i.code, i.package_key])).toEqual([
			['SH010', 'bid:seq'],
			['SH020', 'bid:seq'],
			['CR010', 'bid:creature'],
			['Creature', 'bid:creature']
		]);
		expect(issued.shots[0]).toEqual({ ...seqShots[0], package: 'bid:seq' });
		const [{ n }] = await sql`select count(*)::int as n from public.production_bids where request_id = ${request.id}`;
		expect(n).toBe(0);
		const packages = await sql`select bid_id from public.request_packages where request_id = ${request.id}`;
		expect(packages.every((p) => p.bid_id === null)).toBe(true);

		const view = await loadRequest(s, links.find((l) => l.invitation.id === a.id)!.token);
		expect(view.packages).toEqual([{ id: 'bid:creature', name: 'Creature' }]);
		expect(view.shots.map((x) => x.code)).toEqual(['CR010']);
		const text = JSON.stringify(view);
		for (const hidden of ['SH010', '9300001', 'Vendor A Group', 'groupName']) expect(text).not.toContain(hidden);
		// A draft save now is refused: the request is issued.
		expect((await refusal(() => s.saveDraft(production, request.id, { bids: bids() }))).status).toBe(404);
	});
});

describe('the data from before one page', () => {
	/** A bid of its own, as the Bids page made it: no request. */
	async function looseBid(production: ReturnType<typeof tenant>, name: string, rows: { kind: string; key: string; code: string; position: number }[]) {
		const [bid] = await sql`insert into public.production_bids (site_host, project_id, name) values (${production.siteHost}, ${production.projectId}, ${name}) returning id`;
		for (const r of rows) {
			await sql`insert into public.production_bid_items (bid_id, site_host, project_id, kind, key, code, position, fields, source)
				values (${bid.id}, ${production.siteHost}, ${production.projectId}, ${r.kind}, ${r.key}, ${r.code}, ${r.position}, ${sql.json({ frames: 10 })}, 'breakdown')`;
		}
		return bid.id as string;
	}

	/** A draft that names bids by reference, as the send flow made it. */
	async function namingDraft(production: ReturnType<typeof tenant>, code: string, named: { id: string; name: string }[]) {
		const [request] = await sql`insert into public.bid_requests (site_host, project_id, code, status, base_currency, header)
			values (${production.siteHost}, ${production.projectId}, ${code}, 'draft', 'USD', ${sql.json({ title: code, project: 'Show', assumptions: [] })}) returning id`;
		for (const [i, b] of named.entries()) {
			await sql`insert into public.request_packages (request_id, site_host, project_id, key, name, position, bid_id)
				values (${request.id}, ${production.siteHost}, ${production.projectId}, ${`bid:${b.id}`}, ${b.name}, ${i}, ${b.id})`;
		}
		return request.id as string;
	}

	it('turns into drafts that own their bids, every row kept, and applied again changes nothing', async () => {
		const s = store();
		const production = tenant();
		const row = (key: string, position: number) => ({ kind: 'shot', key, code: key.toUpperCase(), position });
		const shared = await looseBid(production, 'Shared', [row('sh1', 0), row('sh2', 1)]);
		const other = await looseBid(production, 'Other', [row('sh2', 0), row('sh3', 1)]);
		const loose = await looseBid(production, 'Loose', [row('sh9', 0)]);
		const sent = await looseBid(production, 'Sent', [row('sh7', 0)]);
		const first = await namingDraft(production, 'D-1', [
			{ id: shared, name: 'Shared' },
			{ id: other, name: 'Other' }
		]);
		const second = await namingDraft(production, 'D-2', [{ id: shared, name: 'Shared' }]);
		// An issued request whose package still names the bid it was sent from.
		const issued = await s.createDraftRequest(production, { code: 'I-1', header: header({ title: 'Issued one' }), items: { shots: [{ id: 'sh7', code: 'SH7', omitted: false, assetIds: [] }], assets: [] } });
		await s.issue(production, issued.id);
		await sql.begin(async (tx) => {
			await tx`set local session_replication_role = replica`;
			await tx`update public.request_packages set bid_id = ${sent} where request_id = ${issued.id}`;
		});
		const issuedBefore = await sql`select kind, key, code, position, fields, package_key from public.request_items where request_id = ${issued.id} order by position`;

		const [{ result }] = await sql`select public.sg_one_page_convert() as result`;
		expect(result).toEqual({ owned: 2, copied: 1, made: 2, dropped: 1 });

		// The first draft owns both its bids; the row the two held stays in the first bid.
		const one = await s.getRequest(production, first);
		expect(one.packages?.map((p) => p.name)).toEqual(['Shared', 'Other']);
		expect(one.shots.map((x) => [x.code, x.package])).toEqual([
			['SH1', `bid:${shared}`],
			['SH2', `bid:${shared}`],
			['SH3', `bid:${other}`]
		]);
		// The second draft has its own copy of the shared bid, every row.
		const two = await s.getRequest(production, second);
		expect(two.shots.map((x) => x.code)).toEqual(['SH1', 'SH2']);
		const [{ copy }] = await sql`select bid_id as copy from public.request_packages where request_id = ${second}`;
		expect(copy).not.toBe(shared);
		// A bid no draft named is a draft of its own, named after it, the project's name from its requests.
		const made = await sql`select q.id, q.code, q.round, q.status, q.header from public.bid_requests q join public.production_bids b on b.request_id = q.id
			where b.id in ${sql([loose, sent])} order by q.header ->> 'title'`;
		expect(made.map((m) => [m.header.title, m.round, m.status, m.header.project])).toEqual([
			['Loose', 1, 'draft', 'Show'],
			['Sent', 1, 'draft', 'Show']
		]);
		expect((await s.getRequest(production, made[0].id)).shots.map((x) => x.code)).toEqual(['SH9']);
		// The issued request kept its rows and forgot the bid.
		expect(await sql`select kind, key, code, position, fields, package_key from public.request_items where request_id = ${issued.id} order by position`).toEqual(issuedBefore);
		const [{ bid_id }] = await sql`select bid_id from public.request_packages where request_id = ${issued.id}`;
		expect(bid_id).toBeNull();
		// Every bid now belongs to one draft.
		const [{ loose: left }] = await sql`select count(*)::int as loose from public.production_bids where site_host = ${production.siteHost} and request_id is null`;
		expect(left).toBe(0);
		// A converted draft issues as any other.
		await s.issue(production, first);
		expect((await s.getRequest(production, first)).shots.map((x) => x.code)).toEqual(['SH1', 'SH2', 'SH3']);

		const [{ again }] = await sql`select public.sg_one_page_convert() as again`;
		expect(again).toEqual({ owned: 0, copied: 0, made: 0, dropped: 0 });
	});
});
