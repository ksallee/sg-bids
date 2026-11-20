import { describe, expect, it } from 'vitest';
import { parseId, parseSave, parseVendor } from './wire';

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
		expect(out.value.items.shots).toEqual([shot]);
		expect(out.value.items.assets).toEqual([asset]);
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
		expect('thumbnail' in out.value.items.shots[0]).toBe(false);
		expect('vendor' in out.value.items.shots[0]).toBe(false);
		expect('group' in out.value.items.assets[0]).toBe(false);
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
