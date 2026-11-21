import { describe, expect, it } from 'vitest';
import { awardRows, awardSummary, bidLinks, detailUrl, leftCounts } from './award-record';
import { bid, line, onAsset, onShot, request, shot, asset } from './fixtures';
import { bidKey, lineKey, type Written } from './fpt-award';
import type { AwardScenario, InvitedVendor } from './model';
import { money, rate } from './money';
import { inPounds, packed } from './fixtures/packages';

const vendor = (id: string, name: string): InvitedVendor => ({ id, name, email: `${id}@x.test`, ndaExecuted: true });
const REQUEST = request({
	shots: [shot('sh010', { fpt: { type: 'Shot', id: 101 } }), shot('sh020', { fpt: { type: 'Shot', id: 102 } })],
	assets: [asset('tree', { fpt: { type: 'Asset', id: 201 } })],
	vendors: [vendor('va', 'Vendor A'), vendor('vb', 'Vendor B')]
});
const BID_A = bid({ id: 'bidA', vendorId: 'va', currency: 'USD', lines: [line('a1', onShot('sh010'), money(100000, 'USD')), line('a2', onShot('sh020'), money(90000, 'USD'))] });
const BID_B = bid({
	id: 'bidB',
	vendorId: 'vb',
	currency: 'GBP',
	rate: rate('GBP', 'USD', '1.25', '2026-11-18'),
	lines: [line('b2', onShot('sh020'), money(80000, 'GBP')), line('b3', onAsset('tree'), money(4000, 'GBP'))]
});
const SCENARIO: AwardScenario = {
	id: 'sc1',
	requestId: 'req1',
	name: 'chosen',
	picks: [
		{ target: onShot('sh010'), shares: [{ bidId: 'bidA', percent: '100' }] },
		{
			target: onShot('sh020'),
			shares: [
				{ bidId: 'bidA', percent: '60' },
				{ bidId: 'bidB', percent: '40' }
			]
		},
		{ target: onAsset('tree'), shares: [{ bidId: 'bidB', percent: '100' }] }
	]
};
const KEY_A = bidKey('req1', 'va', 1);
const KEY_B = bidKey('req1', 'vb', 1);
const WRITTEN: Written = {
	bids: [
		{ key: KEY_A, id: 5001, created: true },
		{ key: KEY_B, id: 5002, created: true }
	],
	lines: [
		{ key: lineKey(KEY_A, onShot('sh010')), id: 6001, created: true },
		{ key: lineKey(KEY_A, onShot('sh020')), id: 6002, created: true },
		{ key: lineKey(KEY_B, onShot('sh020')), id: 6003, created: true }
	],
	groups: [{ itemType: 'Shot', id: 101, field: 'sg_vendor_groups', groups: [38, 39] }],
	attachments: []
};

describe('awardRows', () => {
	it('makes one row per share on the line it names, with the Flow PT ids found by key', () => {
		expect(awardRows(REQUEST, [BID_A, BID_B], SCENARIO, WRITTEN)).toEqual([
			{ item_kind: 'shot', item_key: 'sh010', bid_line_id: 'a1', share_percent: '100', fpt_bid_id: 5001, fpt_line_id: 6001 },
			{ item_kind: 'shot', item_key: 'sh020', bid_line_id: 'a2', share_percent: '60', fpt_bid_id: 5001, fpt_line_id: 6002 },
			{ item_kind: 'shot', item_key: 'sh020', bid_line_id: 'b2', share_percent: '40', fpt_bid_id: 5002, fpt_line_id: 6003 },
			{ item_kind: 'asset', item_key: 'tree', bid_line_id: 'b3', share_percent: '100', fpt_bid_id: 5002, fpt_line_id: null }
		]);
	});

	it('refuses a pick on a bid it was not given', () => {
		expect(() => awardRows(REQUEST, [BID_A], SCENARIO, WRITTEN)).toThrow('The scenario picks bid bidB; it is not among the bids.');
	});
});

describe('awardSummary', () => {
	it('says who won what in the base currency, the split rows counted', () => {
		expect(awardSummary(REQUEST, [BID_A, BID_B], SCENARIO)).toEqual({
			baseCurrency: 'USD',
			total: money(100000 + 54000 + 40000 + 5000, 'USD'),
			shots: 2,
			assets: 1,
			split: 1,
			vendors: [
				{ vendorId: 'va', name: 'Vendor A', shots: 2, assets: 0, split: 1, total: money(154000, 'USD') },
				{ vendorId: 'vb', name: 'Vendor B', shots: 1, assets: 1, split: 1, total: money(45000, 'USD') }
			]
		});
	});

	it('refuses a bid with no rate', () => {
		expect(() => awardSummary(REQUEST, [BID_A, { ...BID_B, rate: null }], SCENARIO)).toThrow();
	});

	it('counts a package priced as one figure once, its rows in it', () => {
		const picks = ['a', 'b'].map((id) => ({ target: onShot(id), shares: [{ bidId: 'C', percent: '100' }] }));
		const summary = awardSummary({ ...packed, vendors: [vendor('vC', 'Vendor C')] }, [inPounds], { id: 's', requestId: packed.id, name: 'S', picks });
		expect(summary.total).toEqual(money(75_000, 'USD'));
		expect(summary.vendors).toEqual([{ vendorId: 'vC', name: 'Vendor C', shots: 2, assets: 0, split: 0, total: money(75_000, 'USD') }]);
	});

	it('refuses part of a package priced as one figure', () => {
		const picks = [{ target: onShot('a'), shares: [{ bidId: 'C', percent: '100' }] }];
		expect(() => awardSummary(packed, [inPounds], { id: 's', requestId: packed.id, name: 'S', picks })).toThrow(/whole or not at all/);
	});
});

describe('awardRows with packages', () => {
	it('records each row of a package awarded whole on its own line', () => {
		const picks = ['a', 'b'].map((id) => ({ target: onShot(id), shares: [{ bidId: 'C', percent: '100' }] }));
		const rows = awardRows(packed, [inPounds], { id: 's', requestId: packed.id, name: 'S', picks }, { bids: [], lines: [], groups: [], attachments: [] });
		expect(rows.map((r) => [r.item_key, r.bid_line_id, r.share_percent])).toEqual([
			['a', 'Ca', '100'],
			['b', 'Cb', '100']
		]);
	});
});

describe('bidLinks', () => {
	it('links each Bid to its page on the site', () => {
		expect(bidLinks('https://site.test/', { bidType: 'CustomEntity14' }, WRITTEN, REQUEST)).toEqual([
			{ vendorId: 'va', name: 'Vendor A', label: null, id: 5001, url: 'https://site.test/detail/CustomEntity14/5001' },
			{ vendorId: 'vb', name: 'Vendor B', label: null, id: 5002, url: 'https://site.test/detail/CustomEntity14/5002' }
		]);
		expect(detailUrl('https://site.test', 'CustomEntity14', 7)).toBe('https://site.test/detail/CustomEntity14/7');
	});

	it('names the package of each Bid, and the general one', () => {
		const written = {
			...WRITTEN,
			bids: [
				{ key: 'sgbids/req1/va/r1/p:seq%3ASQ1', id: 1, created: true },
				{ key: 'sgbids/req1/va/r1/general', id: 2, created: true }
			]
		};
		const links = bidLinks('https://site.test', { bidType: 'CustomEntity14' }, written, { ...REQUEST, packages: [{ id: 'seq:SQ1', name: 'SQ1' }] });
		expect(links.map((l) => [l.name, l.label])).toEqual([
			['Vendor A', 'SQ1'],
			['Vendor A', 'General costs']
		]);
	});

	it('skips a key of another request', () => {
		expect(bidLinks('https://site.test', { bidType: 'CustomEntity14' }, { ...WRITTEN, bids: [{ key: 'sgbids/other/va/r1', id: 1, created: true }] }, REQUEST)).toEqual([]);
	});
});

describe('leftCounts', () => {
	it('counts rows and Groups', () => {
		expect(leftCounts(WRITTEN)).toEqual({ bids: 2, lines: 3, groups: 2 });
	});
});
