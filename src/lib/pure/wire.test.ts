import { describe, expect, it } from 'vitest';
import { parseCreate, parseDraftSave, parseDuplicate, parseId, parseInvitationPackages, parseLinks, parseVendor } from './wire';

const header = { code: 'DS_R1', title: 'Main', project: 'Demo', round: 1, baseCurrency: 'EUR', assumptions: ['A'], dueDate: '2026-12-01' };
const shot = { id: 'shot-1', code: 'sh010', fpt: { type: 'Shot', id: 1 }, omitted: false, assetIds: ['asset-9'], frames: 96, description: 'd', notes: 'n' };
const asset = { id: 'asset-9', name: 'hero', fpt: { type: 'Asset', id: 9 }, type: 'Character', omitted: true };

const ID = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const V1 = '11111111-2222-4333-8444-555555555555';
const draft = (extra: Record<string, unknown> = {}) => ({
	id: ID,
	header,
	bids: [
		{ key: 'bid:a', name: 'Bid 1', items: { shots: [shot], assets: [] } },
		{ key: 'bid:b', name: 'Hero', items: { shots: [], assets: [asset] } }
	],
	vendors: [{ id: V1, name: 'Studio A', email: 'bids@a.test', group: { id: 4, name: 'Studio A' }, bids: ['bid:b'] }],
	...extra
});

describe('parseDraftSave', () => {
	it('takes a draft page as it saves: the header, the bids with their rows, the vendors', () => {
		const out = parseDraftSave(draft());
		expect(out).toEqual({
			ok: true,
			value: {
				id: ID,
				header,
				bids: [
					{ key: 'bid:a', name: 'Bid 1', shots: [shot], assets: [] },
					{ key: 'bid:b', name: 'Hero', shots: [], assets: [asset] }
				],
				vendors: [{ id: V1, name: 'Studio A', email: 'bids@a.test', group: { id: 4, name: 'Studio A' }, bids: ['bid:b'] }]
			}
		});
	});

	it('keeps only the header and item fields the model has, and drops a row’s package: the bid is its group', () => {
		const out = parseDraftSave(
			draft({
				header: { ...header, vendorName: 'Leak Inc', projectRef: { type: 'Project', id: 99 } },
				bids: [{ key: 'bid:a', name: 'Bid 1', items: { shots: [{ ...shot, thumbnail: 'https://s3/x', vendor: 'Leak', package: 'bid:z' }], assets: [{ ...asset, group: 7 }] } }],
				vendors: []
			})
		);
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect('vendorName' in out.value.header!).toBe(false);
		expect('projectRef' in out.value.header!).toBe(false);
		const row = out.value.bids![0].shots[0];
		expect(['thumbnail' in row, 'vendor' in row, 'package' in row]).toEqual([false, false, false]);
		expect('group' in out.value.bids![0].assets[0]).toBe(false);
	});

	it('takes a breakdown row, with no Flow PT row, and no other source', () => {
		const row = { id: 'shot-bd-1', code: 'sh900', source: 'breakdown', omitted: false, assetIds: [], frames: 48 };
		const one = (rows: unknown[]) => parseDraftSave(draft({ bids: [{ key: 'bid:a', name: 'Bid 1', items: { shots: rows, assets: [] } }], vendors: [] }));
		const out = one([row]);
		expect(out.ok && out.value.bids![0].shots).toEqual([row]);
		expect(one([{ ...row, source: 'fpt' }]).ok).toBe(false);
	});

	it('takes a save of the header alone, or of the vendors alone', () => {
		expect(parseDraftSave({ id: ID, header })).toEqual({ ok: true, value: { id: ID, header } });
		expect(parseDraftSave({ id: ID, vendors: [] })).toEqual({ ok: true, value: { id: ID, vendors: [] } });
	});

	it('takes a vendor half typed: the issue holds it to a name and an email', () => {
		const out = parseDraftSave(draft({ vendors: [{ id: V1, name: '', email: 'bids@', group: null, bids: null }] }));
		expect(out.ok && out.value.vendors).toEqual([{ id: V1, name: '', email: 'bids@', group: null, bids: null }]);
	});

	it('refuses what does not fit, saying what', () => {
		expect(parseDraftSave(null)).toEqual({ ok: false, message: 'Send a draft.' });
		expect(parseDraftSave({ ...draft(), id: 'local-1' })).toEqual({ ok: false, message: 'That is not a request id.' });
		expect(parseDraftSave(draft({ header: { ...header, round: 0 } }))).toEqual({ ok: false, message: 'The details do not fit a request.' });
		expect(parseDraftSave(draft({ bids: [] }))).toEqual({ ok: false, message: 'A request holds one bid at least.' });
		expect(parseDraftSave(draft({ bids: [{ key: 'bid:a', name: ' ', items: { shots: [], assets: [] } }] }))).toEqual({ ok: false, message: 'A bid has no name. Give it one.' });
		expect(
			parseDraftSave(
				draft({
					bids: [
						{ key: 'bid:a', name: 'Hero', items: { shots: [], assets: [] } },
						{ key: 'bid:b', name: 'hero', items: { shots: [], assets: [] } }
					],
					vendors: []
				})
			)
		).toEqual({ ok: false, message: 'Two bids are named hero. Give each its own name.' });
		expect(
			parseDraftSave(
				draft({
					bids: [
						{ key: 'bid:a', name: 'A', items: { shots: [shot], assets: [] } },
						{ key: 'bid:b', name: 'B', items: { shots: [shot], assets: [] } }
					],
					vendors: []
				})
			)
		).toEqual({ ok: false, message: 'A row sits in one bid. sh010 is in A and in B.' });
		expect(parseDraftSave(draft({ bids: [{ key: 'bid:a', name: 'A', items: { shots: [{ code: 'no id' }], assets: [] } }] }))).toEqual({ ok: false, message: 'A row does not fit a request.' });
		expect(parseDraftSave(draft({ vendors: [{ id: 'x', name: 'A', email: '', group: null, bids: null }] }))).toEqual({ ok: false, message: 'A vendor does not fit the request.' });
		expect(parseDraftSave(draft({ vendors: [{ id: V1, name: 'A', email: '', group: null, bids: ['bid:none'] }] }))).toEqual({ ok: false, message: 'A vendor is invited to a bid the request does not have.' });
		expect(parseDraftSave(draft({ vendors: [{ id: V1, name: 'A', email: '', group: null, bids: [] }] }))).toEqual({ ok: false, message: 'A vendor does not fit the request.' });
		const twice = { id: V1, name: 'A', email: '', group: null, bids: null };
		expect(parseDraftSave(draft({ vendors: [twice, twice] }))).toEqual({ ok: false, message: 'A vendor is named twice.' });
	});

	it('takes a bid material link only when it is http or https', () => {
		const save = (materialLink: unknown) => parseDraftSave({ id: ID, header: { ...header, materialLink } });
		const ok = save('https://example.com/cut');
		expect(ok.ok && ok.value.header!.materialLink).toBe('https://example.com/cut');
		for (const link of ['javascript:alert(document.cookie)', ' JAVASCRIPT:alert(1)', 'data:text/html,x', 'ftp://x.example.com', '//evil.example.com', 'cut']) {
			expect(save(link), link).toEqual({ ok: false, message: 'The details do not fit a request.' });
		}
		const blank = save('');
		expect(blank.ok && 'materialLink' in blank.value.header!).toBe(false);
	});
});

describe('parseCreate and parseDuplicate', () => {
	it('take a new request’s name and its details', () => {
		expect(parseCreate({ name: '  Hero shots ', header })).toEqual({ ok: true, value: { name: 'Hero shots', header: { ...header, title: 'Hero shots' } } });
		expect(parseCreate({ name: ' ', header })).toEqual({ ok: false, message: 'Name the request.' });
		expect(parseCreate({ name: 'x'.repeat(201), header })).toEqual({ ok: false, message: 'A request name is 200 characters at most.' });
		expect(parseCreate({ name: 'A', header: { project: 'Demo' } })).toEqual({ ok: false, message: 'The details do not fit a request.' });
	});

	it('take the request to copy, the copy’s name, and whether its rows go too', () => {
		expect(parseDuplicate({ id: ID, name: 'Main copy', rows: true })).toEqual({ ok: true, value: { id: ID, name: 'Main copy', rows: true } });
		expect(parseDuplicate({ id: ID, name: 'Main copy' })).toEqual({ ok: false, message: 'Say whether the rows go too.' });
		expect(parseDuplicate({ id: 'x', name: 'Main copy', rows: false }).ok).toBe(false);
		expect(parseDuplicate({ id: ID, name: '', rows: false })).toEqual({ ok: false, message: 'Name the request.' });
	});
});

describe('parseLinks', () => {
	const id = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
	it('takes a request id and each row with the Flow PT row of its kind', () => {
		const out = parseLinks({ requestId: id, links: [{ kind: 'shot', key: 'shot-bd-1', fpt: { type: 'Shot', id: 5 } }, { kind: 'asset', key: 'asset-bd-2', fpt: { type: 'Asset', id: 6 } }] });
		expect(out).toEqual({
			ok: true,
			value: {
				requestId: id,
				links: [
					{ kind: 'shot', key: 'shot-bd-1', fpt: { type: 'Shot', id: 5 } },
					{ kind: 'asset', key: 'asset-bd-2', fpt: { type: 'Asset', id: 6 } }
				]
			}
		});
	});

	it('refuses a link to the wrong type, a bad id, none, or the same row twice', () => {
		const one = { kind: 'shot', key: 'shot-bd-1', fpt: { type: 'Shot', id: 5 } };
		expect(parseLinks({ requestId: 'x', links: [one] }).ok).toBe(false);
		expect(parseLinks({ requestId: id, links: [] }).ok).toBe(false);
		expect(parseLinks({ requestId: id, links: [{ ...one, fpt: { type: 'Asset', id: 5 } }] }).ok).toBe(false);
		expect(parseLinks({ requestId: id, links: [{ ...one, fpt: { type: 'Shot', id: -1 } }] }).ok).toBe(false);
		expect(parseLinks({ requestId: id, links: [{ ...one, key: '' }] }).ok).toBe(false);
		expect(parseLinks({ requestId: id, links: [one, one] }).ok).toBe(false);
	});
});

describe('parseVendor', () => {
	it('takes a name, an email and an optional Group', () => {
		expect(parseVendor({ name: ' Vendor A ', email: 'bids@a.test', groupId: 12 })).toEqual({
			ok: true,
			value: { name: 'Vendor A', email: 'bids@a.test', fpt: { type: 'Group', id: 12 }, ndaExecuted: false }
		});
		expect(parseVendor({ name: 'B', email: 'b@b.test', groupId: null })).toEqual({ ok: true, value: { name: 'B', email: 'b@b.test', ndaExecuted: false } });
	});

	it('refuses a missing name, a bad email or a bad Group id', () => {
		expect(parseVendor({ name: '', email: 'b@b.test' }).ok).toBe(false);
		expect(parseVendor({ name: 'B', email: 'nope' }).ok).toBe(false);
		expect(parseVendor({ name: 'B', email: 'b@b.test', groupId: -1 }).ok).toBe(false);
	});
});

describe('parseId', () => {
	it('takes a uuid only', () => {
		expect(parseId('6f1c2a4e-0000-4000-8000-000000000000')).toBe('6f1c2a4e-0000-4000-8000-000000000000');
		expect(parseId('local-1')).toBeNull();
		expect(parseId(3)).toBeNull();
	});
});

describe('packages on the wire', () => {
	it('takes a vendor invited to some packages, or to every one', () => {
		const some = parseVendor({ name: 'V', email: 'v@x.test', packages: ['seq:SQ1'] });
		expect(some.ok && some.value.packages).toEqual(['seq:SQ1']);
		const every = parseVendor({ name: 'V', email: 'v@x.test', packages: null });
		expect(every.ok && 'packages' in every.value).toBe(false);
		expect(parseVendor({ name: 'V', email: 'v@x.test', packages: [] }).ok).toBe(false);
		expect(parseVendor({ name: 'V', email: 'v@x.test', packages: ['a', 'a'] }).ok).toBe(false);
	});

	it('reads a change of a vendor packages', () => {
		const id = '00000000-0000-4000-8000-000000000001';
		expect(parseInvitationPackages({ invitationId: id, packages: ['a'] })).toEqual({ ok: true, value: { invitationId: id, packages: ['a'] } });
		expect(parseInvitationPackages({ invitationId: id, packages: null })).toEqual({ ok: true, value: { invitationId: id, packages: null } });
		expect(parseInvitationPackages({ invitationId: 'x', packages: null }).ok).toBe(false);
	});
});
