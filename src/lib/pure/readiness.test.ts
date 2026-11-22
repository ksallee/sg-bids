import { describe, expect, it } from 'vitest';
import { asset, shot } from './fixtures';
import { emptyHeaderForm, type HeaderForm } from './header';
import { controlId, readiness, type DraftFacts } from './readiness';
import type { DraftBid } from './request-draft';
import { blankVendor, type VendorRow } from './vendor-rows';

const TODAY = '2026-11-20';
const form: HeaderForm = { ...emptyHeaderForm('GBP'), code: 'DS-01', title: 'Main bid', dueDate: '2026-12-15' };
const bids: DraftBid[] = [
	{ key: 'bid:a', name: 'Bid 1' },
	{ key: 'bid:b', name: 'Hero' }
];
const vendor = (id: string, extra: Partial<VendorRow> = {}): VendorRow => ({ ...blankVendor(id), name: `Studio ${id}`, email: `${id}@studio.com`, ...extra });

function facts(extra: Partial<DraftFacts> = {}): DraftFacts {
	return {
		form,
		today: TODAY,
		bids,
		rows: { shots: [{ ...shot('shot-1'), package: 'bid:a' }], assets: [{ ...asset('asset-1'), package: 'bid:b' }] },
		vendors: [vendor('a')],
		...extra
	};
}

describe('readiness of a draft request', () => {
	it('is ready with a name, a due day, a currency, rows in every bid and a vendor', () => {
		const r = readiness(facts());
		expect(r.problems).toEqual([]);
		expect(r.toIssue).toEqual([]);
		expect(r.canIssue).toBe(true);
	});

	it('names every problem with its field or row, in the order of the page', () => {
		const r = readiness(
			facts({
				form: { ...form, title: '', dueDate: '', materialLink: 'nope' },
				rows: { shots: [{ ...shot('shot-1'), package: 'bid:a' }], assets: [] },
				vendors: [vendor('a', { name: '' }), blankVendor('b'), vendor('c', { email: 'c at studio' })]
			})
		);
		expect(r.problems.map((p) => [p.target, p.label, p.short])).toEqual([
			['title', 'Name', 'missing'],
			['bid:bid:b', 'Hero', 'no rows'],
			['dueDate', 'Answers due', 'missing'],
			['materialLink', 'Bid material', 'not a web link'],
			['vendor:a:name', 'Vendor 1', 'no name'],
			['vendor:c:email', 'Studio c', 'not an address']
		]);
		expect(r.problems.find((p) => p.target === 'bid:bid:b')?.message).toBe('Hero holds no rows. Add rows to it, or delete it.');
		expect(r.problems.find((p) => p.target === 'vendor:a:name')?.message).toBe('Give the vendor a name.');
		expect(r.canIssue).toBe(false);
	});

	it('asks for rows when there are none, and for a vendor when there is none', () => {
		const r = readiness(facts({ rows: { shots: [], assets: [] }, vendors: [blankVendor('x')] }));
		expect(r.problems.map((p) => [p.target, p.message])).toEqual([
			['items', 'Add shots or assets to a bid.'],
			['vendors', 'Add a vendor to send the request to.']
		]);
	});

	it('names a row typed by hand with no code, by its bid, pointing at the row', () => {
		const r = readiness(
			facts({
				rows: {
					shots: [{ ...shot('shot-1'), package: 'bid:a' }, { ...shot('shot-bd-1', { source: 'breakdown', count: 120 }), code: ' ', package: 'bid:a' }],
					assets: [{ ...asset('asset-1'), name: '', package: 'bid:b' }]
				}
			})
		);
		expect(r.toIssue.map((p) => [p.target, p.label, p.short, p.message])).toEqual([
			['row:shot:shot-bd-1', 'Shots', 'no code', 'A shot row in Bid 1 has no code. Type one, or remove the row.'],
			['row:asset:asset-1', 'Assets', 'no code', 'An asset row in Hero has no code. Type one, or remove the row.']
		]);
		expect(controlId('row:shot:shot-bd-1')).toBe('f-row-shot-shot-bd-1');
	});

	it('refuses a request whose every row is omitted', () => {
		const r = readiness(facts({ bids: [bids[0]], rows: { shots: [{ ...shot('shot-1'), package: 'bid:a', omitted: true }], assets: [] } }));
		expect(r.toIssue.map((p) => [p.target, p.message])).toEqual([['items', 'Every row is omitted. Bring one back.']]);
	});

	it('warns of a past due day while drafting and refuses it at issue', () => {
		const r = readiness(facts({ form: { ...form, dueDate: '2026-11-01' } }));
		expect(r.problems.map((p) => [p.target, p.tone])).toEqual([['dueDate', 'warning']]);
		expect(r.toIssue.map((p) => [p.target, p.tone])).toEqual([['dueDate', 'error']]);
		expect(r.canIssue).toBe(false);
	});

	it('never counts without naming: every problem has a label, a short and a message', () => {
		const r = readiness(facts({ form: { ...emptyHeaderForm(), baseCurrency: '' }, rows: { shots: [], assets: [] }, vendors: [] }));
		expect(r.problems.length).toBeGreaterThan(2);
		for (const p of r.problems) {
			expect(p.label).not.toBe('');
			expect(p.short).not.toBe('');
			expect(p.message).not.toBe('');
		}
	});
});

describe('controlId', () => {
	it('names the control a problem points at, safe as an id', () => {
		expect(controlId('dueDate')).toBe('f-dueDate');
		expect(controlId('bid:bid:6f1c-2a')).toBe('f-bid-bid-6f1c-2a');
		expect(controlId('vendor:v1:email')).toBe('f-vendor-v1-email');
	});
});
