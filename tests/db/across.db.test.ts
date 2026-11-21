/**
 * The requests list across a site (`src/lib/server/requests.ts`, `listAcross`): it reads the
 * requests of the projects the server verified for the person on that site, with their counts,
 * and nothing of a project outside that list or of another site, whatever else the database holds.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { SitePrincipal } from '$lib/pure/access';
import { createRequests } from '$lib/server/requests';
import { draft, header, items, rest, store, superuser, vendor } from './helpers';

const sql = superuser();
const requests = () => createRequests(rest('service_role'));

afterAll(async () => {
	await sql.end();
});

/** One site with requests in three projects, and a request in a readable project id on another site. */
async function siteWithThreeProjects() {
	const s = store();
	const host = `site-${randomUUID().slice(0, 8)}.example.com`;
	const other = `site-${randomUUID().slice(0, 8)}.example.com`;
	const base = 2_000_000 + Math.floor(Math.random() * 1_000_000);
	const [p1, p2, hidden] = [base, base + 1, base + 2];
	const at = (projectId: number, siteHost = host) => ({ kind: 'production' as const, siteHost, projectId });

	const first = await s.createDraftRequest(at(p1), { code: 'A-1', header: header({ title: 'First' }), items: items() });
	const a = await s.inviteVendor(at(p1), first.id, vendor('Vendor A'));
	await s.inviteVendor(at(p1), first.id, vendor('Vendor B'));
	await s.issueRequest(at(p1), first.id);
	const bid = await s.saveDraftBid(a.token, draft(100_000));
	await s.submitBid(a.token, bid.id);

	const second = await s.createDraftRequest(at(p2), { code: 'B-1', header: header({ title: 'Second' }), items: items() });
	const secret = await s.createDraftRequest(at(hidden), { code: 'C-1', header: header({ title: 'Not readable' }), items: items() });
	await s.inviteVendor(at(hidden), secret.id, vendor('Vendor C'));
	const elsewhere = await s.createDraftRequest(at(p1, other), { code: 'D-1', header: header({ title: 'Other site' }), items: items() });
	return { host, other, p1, p2, hidden, first, second, secret, elsewhere };
}

describe('listAcross', () => {
	it('lists the requests of every verified project on the site, newest first, each with its project and counts', async () => {
		const { host, p1, p2, first, second } = await siteWithThreeProjects();
		const principal: SitePrincipal = { kind: 'production-site', siteHost: host, projectIds: [p1, p2] };
		const list = await requests().listAcross(principal);
		expect(list.map((r) => r.code)).toEqual(['B-1', 'A-1']);
		expect(list.find((r) => r.id === first.id)).toMatchObject({ projectId: p1, status: 'issued', title: 'First', invited: 2, submitted: 1 });
		expect(list.find((r) => r.id === second.id)).toMatchObject({ projectId: p2, status: 'draft', title: 'Second', invited: 0, submitted: 0 });
	});

	it('names each request’s bids in order and counts its shots and assets by unit, omitted rows left out, draft or issued', async () => {
		const s = store();
		const host = `site-${randomUUID().slice(0, 8)}.example.com`;
		const p = 3_000_000 + Math.floor(Math.random() * 1_000_000);
		const at = { kind: 'production' as const, siteHost: host, projectId: p };
		const bids = [
			{
				key: 'seq',
				name: 'Seq A',
				shots: [
					{ id: 's1', code: 'SH010', fpt: { type: 'Shot', id: 11 }, omitted: false, assetIds: [] },
					{ id: 's2', code: 'SIMPLE', omitted: false, assetIds: [], count: 120 },
					{ id: 's3', code: 'MEDIUM', omitted: true, assetIds: [], count: 40 }
				],
				assets: []
			},
			{ key: 'cr', name: 'Creature', shots: [{ id: 's4', code: 'SH020', omitted: false, assetIds: [] }], assets: [{ id: 'a1', name: 'Hero', omitted: false, count: 2 }] }
		];
		const drafted = await s.createDraftRequest(at, { code: 'T-1', header: header({ title: 'Draft' }), bids });
		const sent = await s.createDraftRequest(at, { code: 'T-2', header: header({ title: 'Sent' }), bids });
		await s.inviteVendor(at, sent.id, vendor('Vendor A'));
		await s.issueRequest(at, sent.id);
		const list = await requests().listAcross({ kind: 'production-site', siteHost: host, projectIds: [p] });
		for (const id of [drafted.id, sent.id]) {
			expect(list.find((r) => r.id === id)).toMatchObject({ bids: ['Seq A', 'Creature'], shots: 122, assets: 2 });
		}
	});

	it('shows nothing of a project the person cannot read, though the site and the database hold it', async () => {
		const { host, p1, hidden, secret } = await siteWithThreeProjects();
		const list = await requests().listAcross({ kind: 'production-site', siteHost: host, projectIds: [p1] });
		expect(list.map((r) => r.id)).not.toContain(secret.id);
		expect(list.every((r) => r.projectId === p1)).toBe(true);
		expect(list.some((r) => r.projectId === hidden)).toBe(false);
	});

	it('shows nothing of another site, even for the same project id', async () => {
		const { host, other, p1, elsewhere } = await siteWithThreeProjects();
		expect((await requests().listAcross({ kind: 'production-site', siteHost: host, projectIds: [p1] })).map((r) => r.id)).not.toContain(elsewhere.id);
		expect((await requests().listAcross({ kind: 'production-site', siteHost: other, projectIds: [p1] })).map((r) => r.id)).toEqual([elsewhere.id]);
	});

	it('answers nothing for a person who may read no project, without reading a row', async () => {
		const { host } = await siteWithThreeProjects();
		expect(await requests().listAcross({ kind: 'production-site', siteHost: host, projectIds: [] })).toEqual([]);
	});

	it('refuses a principal that is not a verified site principal', async () => {
		const { host, p1 } = await siteWithThreeProjects();
		await expect(requests().listAcross({ kind: 'production-site', siteHost: '', projectIds: [p1] })).rejects.toThrow();
		await expect(requests().listAcross({ kind: 'production', siteHost: host, projectId: p1 } as unknown as SitePrincipal)).rejects.toThrow();
	});
});
