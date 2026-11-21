import { describe, expect, it } from 'vitest';
import { parseId, parseInvitationPackages, parseLinks, parseSave, parseVendor } from './wire';

const header = { code: 'DS_R1', title: 'Main', project: 'Demo', round: 1, baseCurrency: 'EUR', assumptions: ['A'], dueDate: '2026-12-01' };
const shot = { id: 'shot-1', code: 'sh010', fpt: { type: 'Shot', id: 1 }, omitted: false, assetIds: ['asset-9'], frames: 96, description: 'd', notes: 'n' };
const asset = { id: 'asset-9', name: 'hero', fpt: { type: 'Asset', id: 9 }, type: 'Character', omitted: true };

describe('parseSave', () => {
	it('takes a draft as the builder sends it', () => {
		const out = parseSave({ id: null, code: 'DS_R1', header, items: { shots: [shot], assets: [asset] } });
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.value.id).toBeNull();
		expect(out.value.header).toEqual(header);
		expect(out.value.items!.shots).toEqual([shot]);
		expect(out.value.items!.assets).toEqual([asset]);
	});

	it('keeps only the header and item fields the model has', () => {
		const out = parseSave({
			code: 'X',
			header: { ...header, vendorName: 'Leak Inc', projectRef: { type: 'Project', id: 99 } },
			items: { shots: [{ ...shot, thumbnail: 'https://s3/x', vendor: 'Leak' }], assets: [{ ...asset, group: 7 }] }
		});
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect('vendorName' in out.value.header).toBe(false);
		expect('projectRef' in out.value.header).toBe(false);
		expect('thumbnail' in out.value.items!.shots[0]).toBe(false);
		expect('vendor' in out.value.items!.shots[0]).toBe(false);
		expect('group' in out.value.items!.assets[0]).toBe(false);
	});

	it('takes a breakdown row, with no Flow PT row, and no other source', () => {
		const row = { id: 'shot-bd-1', code: 'sh900', source: 'breakdown', omitted: false, assetIds: [], frames: 48 };
		const one = { id: 'asset-bd-2', name: 'prop', source: 'breakdown' };
		const out = parseSave({ code: 'X', header, items: { shots: [row], assets: [one] } });
		expect(out.ok && out.value.items!.shots).toEqual([row]);
		expect(out.ok && out.value.items!.assets).toEqual([one]);
		expect(parseSave({ code: 'X', header, items: { shots: [{ ...row, source: 'fpt' }], assets: [] } }).ok).toBe(false);
		expect(parseSave({ code: 'X', header, items: { shots: [], assets: [{ ...one, source: 7 }] } }).ok).toBe(false);
	});

	it('refuses what is not a draft', () => {
		expect(parseSave(null).ok).toBe(false);
		expect(parseSave({ code: '', header, items: { shots: [], assets: [] } })).toEqual({ ok: false, message: 'Give the request a code.' });
		expect(parseSave({ code: 'X', header: { ...header, round: 0 }, items: { shots: [], assets: [] } })).toEqual({ ok: false, message: 'The header does not fit a request.' });
		expect(parseSave({ code: 'X', header, items: { shots: [{ code: 'no id' }], assets: [] } })).toEqual({ ok: false, message: 'An item does not fit a request.' });
		expect(parseSave({ code: 'X', header, items: { shots: [{ ...shot, assetIds: 'x' }], assets: [] } }).ok).toBe(false);
		expect(parseSave({ id: 5, code: 'X', header, items: { shots: [], assets: [] } }).ok).toBe(false);
	});

	it('takes a bid material link only when it is http or https', () => {
		const save = (materialLink: unknown) => parseSave({ code: 'X', header: { ...header, materialLink }, items: { shots: [], assets: [] } });
		const ok = save('https://example.com/cut');
		expect(ok.ok && ok.value.header.materialLink).toBe('https://example.com/cut');
		for (const link of ['javascript:alert(document.cookie)', ' JAVASCRIPT:alert(1)', 'data:text/html,x', 'ftp://x.example.com', '//evil.example.com', 'cut']) {
			expect(save(link), link).toEqual({ ok: false, message: 'The header does not fit a request.' });
		}
		// Blank is no link.
		const blank = save('');
		expect(blank.ok && 'materialLink' in blank.value.header).toBe(false);
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
	const packages = [
		{ id: 'seq:SQ1', name: 'SQ1' },
		{ id: 'assets', name: 'Assets' }
	];

	it('takes the packages with the rows that sit in them', () => {
		const out = parseSave({ code: 'X', header, items: { shots: [{ ...shot, package: 'seq:SQ1' }], assets: [{ ...asset, package: 'assets' }] }, packages });
		expect(out.ok && out.value.packages).toEqual(packages);
		expect(out.ok && out.value.items!.shots[0].package).toBe('seq:SQ1');
	});

	it('takes a save with no packages as before', () => {
		const out = parseSave({ code: 'X', header, items: { shots: [shot], assets: [] } });
		expect(out.ok && out.value.packages).toEqual([]);
	});

	it('refuses a row outside the packages, two packages with one name, a blank name', () => {
		expect(parseSave({ code: 'X', header, items: { shots: [shot], assets: [] }, packages }).ok).toBe(false);
		expect(parseSave({ code: 'X', header, items: { shots: [{ ...shot, package: 'nope' }], assets: [] }, packages }).ok).toBe(false);
		expect(parseSave({ code: 'X', header, items: { shots: [{ ...shot, package: 'seq:SQ1' }], assets: [] } }).ok).toBe(false);
		expect(parseSave({ code: 'X', header, items: { shots: [], assets: [] }, packages: [packages[0], { id: 'b', name: 'sq1' }] })).toEqual({ ok: false, message: 'Two packages are named sq1.' });
		expect(parseSave({ code: 'X', header, items: { shots: [], assets: [] }, packages: [{ id: 'b', name: ' ' }] }).ok).toBe(false);
	});

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
