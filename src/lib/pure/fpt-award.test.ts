import { describe, expect, it } from 'vitest';
import { bid, line, onAsset, onShot, request, shot, asset } from './fixtures';
import {
	attachmentOf,
	awardedTotals,
	awardedTotalsQuery,
	bidKey,
	chunk,
	isClean,
	lineKey,
	mergeWritten,
	NOTHING_WRITTEN,
	planAward,
	planUndo,
	toBatchRequest,
	undoRequest,
	verify,
	type AwardInput,
	type Existing,
	type FptSite,
	type ReadRow,
	type Write,
	type Written
} from './fpt-award';
import type { AwardScenario, InvitedVendor } from './model';
import { money, rate } from './money';

const SITE: FptSite = {
	projectId: 1180,
	bidType: 'CustomEntity14',
	lineType: 'CustomEntity15',
	vendorField: { Shot: 'sg_vendor_groups', Asset: 'sg_vendor_groups' },
	statuses: { draft: 'wtg', submitted: 'ip', awarded: 'fin' }
};

const vendor = (id: string, name: string, group: number): InvitedVendor => ({ id, name, email: `${id}@x.test`, ndaExecuted: true, fpt: { type: 'Group', id: group } });

const REQUEST = request({
	shots: [shot('sh010', { fpt: { type: 'Shot', id: 101 } }), shot('sh020', { fpt: { type: 'Shot', id: 102 } }), shot('sh030', { fpt: { type: 'Shot', id: 103 } })],
	assets: [asset('tree', { fpt: { type: 'Asset', id: 201 } })],
	vendors: [vendor('va', 'Vendor A', 38), vendor('vb', 'Vendor B', 39)]
});

const BID_A = bid({
	id: 'bidA',
	vendorId: 'va',
	currency: 'USD',
	number: '2',
	lines: [line('a1', onShot('sh010'), money(100000, 'USD')), line('a2', onShot('sh020'), money(200000, 'USD')), line('a3', onShot('sh030'), money(150000, 'USD')), line('a4', onAsset('tree'), money(0, 'USD'), { excluded: true })]
});

const BID_B = bid({
	id: 'bidB',
	vendorId: 'vb',
	currency: 'EUR',
	rate: rate('EUR', 'USD', '1.1', '2026-11-15'),
	number: 'B-7',
	lines: [line('b2', onShot('sh020'), money(180000, 'EUR')), line('b3', onShot('sh030'), money(90000, 'EUR'))]
});

const SCENARIO: AwardScenario = {
	id: 'sc1',
	requestId: 'req1',
	name: 'split',
	picks: [
		{ target: onShot('sh010'), shares: [{ bidId: 'bidA', percent: '100' }] },
		{
			target: onShot('sh020'),
			shares: [
				{ bidId: 'bidA', percent: '50' },
				{ bidId: 'bidB', percent: '50' }
			]
		},
		{ target: onShot('sh030'), shares: [{ bidId: 'bidB', percent: '100' }] }
	]
};

const NOTHING: Existing = { bids: [], lines: [], groups: {} };

function input(extra: Partial<AwardInput> = {}): AwardInput {
	return {
		request: REQUEST,
		bids: [BID_A, BID_B],
		scenario: SCENARIO,
		options: { date: '2026-11-20', requestCode: 'RQ-1', appLinks: { bidA: 'https://bids.test/b/bidA' } },
		site: SITE,
		existing: NOTHING,
		...extra
	};
}

const KEY_A = bidKey('req1', 'va', 1);
const KEY_B = bidKey('req1', 'vb', 1);

describe('planAward', () => {
	it('creates the Bids first, then the awarded lines and the Groups, then the links one by one', () => {
		const plan = planAward(input());
		expect(plan.steps.map((s) => [s.label, s.mode])).toEqual([
			['Bids', 'batch'],
			['Bid Lines and vendor Groups', 'batch'],
			['App links', 'single']
		]);
		expect(plan.steps[2].writes).toEqual([{ kind: 'link', key: KEY_A, url: 'https://bids.test/b/bidA' }]);
		expect(plan.steps[0].writes.map((w) => (w.kind === 'create' ? w.key : w.kind))).toEqual([KEY_A, KEY_B]);
		expect(plan.steps[1].writes.map((w) => (w.kind === 'addGroups' ? `groups ${w.id}` : w.kind === 'create' ? w.key : '?'))).toEqual([
			lineKey(KEY_A, onShot('sh010')),
			lineKey(KEY_A, onShot('sh020')),
			lineKey(KEY_B, onShot('sh020')),
			lineKey(KEY_B, onShot('sh030')),
			'groups 101',
			'groups 102',
			'groups 103'
		]);
	});

	it('writes a Bid with its amounts in both currencies, codes, rate, dates, status and link', () => {
		const [a, b] = planAward(input()).steps[0].writes as Extract<Write, { kind: 'create' }>[];
		expect(a.data).toEqual({
			code: 'RQ-1 Vendor A R1',
			sg_sgbids_key: KEY_A,
			sg_vendor: { type: 'Group', id: 38 },
			sg_round: 1,
			sg_total: '4500.00',
			sg_currency: 'USD',
			sg_total_base: '4500.00',
			sg_base_currency: 'USD',
			sg_rebate_estimate: '0.00',
			sg_total_after_rebate: '4500.00',
			sg_exchange_rate: null,
			sg_rate_date: null,
			sg_request_code: 'RQ-1',
			sg_submitted_date: '2026-11-20',
			sg_awarded_date: '2026-11-20',
			sg_bid_version: 2,
			sg_status_list: 'fin',
			project: { type: 'Project', id: 1180 }
		});
		expect(b.data).toMatchObject({ sg_total: '2700.00', sg_currency: 'EUR', sg_total_base: '2970.00', sg_exchange_rate: '1.1', sg_rate_date: '2026-11-15' });
		expect(b.data).not.toHaveProperty('sg_bid_version');
	});

	it('writes a split line with its share and the awarded part in the base currency', () => {
		const lines = planAward(input()).steps[1].writes.filter((w): w is Extract<Write, { kind: 'create' }> => w.kind === 'create');
		const splitB = lines.find((l) => l.key === lineKey(KEY_B, onShot('sh020')))!;
		expect(splitB.data).toEqual({
			code: 'SH020 Vendor B',
			sg_sgbids_key: lineKey(KEY_B, onShot('sh020')),
			sg_bid: { pendingBid: KEY_B },
			sg_item: { type: 'Shot', id: 102 },
			sg_amount: '1800.00',
			sg_currency: 'EUR',
			sg_amount_base: '1980.00',
			sg_share_percent: '50.0',
			sg_awarded_base: '990.00',
			sg_awarded: true,
			sg_excluded: false,
			project: { type: 'Project', id: 1180 }
		});
	});

	it('adds only the Groups an item does not hold yet', () => {
		const plan = planAward(input({ existing: { ...NOTHING, groups: { 'Shot:102': [38, 7] } } }));
		const groups = plan.steps[1].writes.filter((w) => w.kind === 'addGroups');
		expect(groups).toEqual([
			{ kind: 'addGroups', itemType: 'Shot', id: 101, field: 'sg_vendor_groups', groups: [38] },
			{ kind: 'addGroups', itemType: 'Shot', id: 102, field: 'sg_vendor_groups', groups: [39] },
			{ kind: 'addGroups', itemType: 'Shot', id: 103, field: 'sg_vendor_groups', groups: [39] }
		]);
		expect(plan.preview.groups[1]).toEqual({ item: 'SH020', target: 'shot:sh020', ref: { type: 'Shot', id: 102 }, added: [39], addedVendors: ['Vendor B'], already: [38], withoutGroup: [] });
	});

	it('updates rows found by key instead of creating them again, and leaves the link alone', () => {
		const existing: Existing = { bids: [{ id: 9001, key: KEY_A }], lines: [{ id: 9101, key: lineKey(KEY_A, onShot('sh010')) }], groups: {} };
		const plan = planAward(input({ existing }));
		const [a] = plan.steps[0].writes;
		expect(a).toMatchObject({ kind: 'update', id: 9001, key: KEY_A });
		expect((a as { data: object }).data).not.toHaveProperty('project');
		expect(plan.steps.map((s) => s.label)).not.toContain('App links');
		const l = plan.steps[1].writes.find((w) => (w.kind === 'create' || w.kind === 'update') && w.key === lineKey(KEY_A, onShot('sh010')))!;
		expect(l).toMatchObject({ kind: 'update', id: 9101, data: { sg_bid: { type: 'CustomEntity14', id: 9001 } } });
		expect(plan.preview.bids.map((b) => b.action)).toEqual(['update', 'create']);
	});

	it('writes every line with allLines, an excluded one with no amount', () => {
		const plan = planAward(input({ options: { date: '2026-11-20', allLines: true } }));
		const lines = plan.steps[1].writes.filter((w) => w.kind === 'create');
		expect(lines).toHaveLength(6);
		const tree = lines.find((w) => w.kind === 'create' && w.key === lineKey(KEY_A, onAsset('tree')))!;
		expect((tree as { data: object }).data).toMatchObject({ sg_amount: null, sg_amount_base: null, sg_share_percent: null, sg_awarded: false, sg_excluded: true });
		const a3 = lines.find((w) => w.kind === 'create' && w.key === lineKey(KEY_A, onShot('sh030')))!;
		expect((a3 as { data: object }).data).toMatchObject({ sg_amount: '1500.00', sg_awarded: false, sg_awarded_base: null });
	});

	it('marks a bid with nothing awarded as not awarded, and warns when the site has no status for it', () => {
		const scenario: AwardScenario = { ...SCENARIO, picks: [{ target: onShot('sh010'), shares: [{ bidId: 'bidA', percent: '100' }] }] };
		const plan = planAward(input({ scenario }));
		const b = plan.steps[0].writes[1] as Extract<Write, { kind: 'create' }>;
		expect(b.data).not.toHaveProperty('sg_status_list');
		expect(b.data.sg_awarded_date).toBeNull();
		expect(plan.preview.bids[1]).toMatchObject({ vendor: 'Vendor B', status: 'not_awarded', lines: 0 });
		expect(plan.warnings).toContain("Vendor B's bid: the project has no status for not awarded. The status is left as it is.");
		expect(plan.warnings).toContain("Vendor B's bid: bid number 'B-7' is not a whole number. Bid Version is left empty.");
	});

	it('rounds a three-decimal currency to two and says so', () => {
		const kwd = bid({ id: 'bidK', vendorId: 'va', currency: 'KWD', rate: rate('KWD', 'USD', '3.25', '2026-11-15'), lines: [line('k1', onShot('sh010'), money(12345, 'KWD'))] });
		const scenario: AwardScenario = { ...SCENARIO, picks: [{ target: onShot('sh010'), shares: [{ bidId: 'bidK', percent: '100' }] }] };
		const plan = planAward(input({ bids: [kwd], scenario }));
		const l = plan.steps[1].writes[0] as Extract<Write, { kind: 'create' }>;
		expect(l.data.sg_amount).toBe('12.35');
		expect(plan.warnings).toContain("Vendor A's bid, SH010: KWD has more decimals than Flow PT keeps. 12.345 is stored as 12.35.");
	});

	it('refuses a draft, a vendor with no Group, an item with no Flow PT row, and two bids for one round', () => {
		expect(() => planAward(input({ bids: [{ ...BID_A, status: 'draft' }, BID_B] }))).toThrow('Bid bidA is draft. Only a submitted bid is published.');
		const noGroup = { ...REQUEST, vendors: [{ ...REQUEST.vendors[0], fpt: undefined }, REQUEST.vendors[1]] };
		expect(() => planAward(input({ request: noGroup }))).toThrow('Vendor Vendor A has no Flow PT Group.');
		const noShot = { ...REQUEST, shots: [shot('sh010'), ...REQUEST.shots.slice(1)] };
		expect(() => planAward(input({ request: noShot }))).toThrow('The shot SH010 has no Flow PT Shot. Create it, publish without it, or match it first.');
		expect(() => planAward(input({ bids: [BID_A, { ...BID_A, id: 'bidA2' }, BID_B] }))).toThrow('Two bids from Vendor A for round 1. Publish one.');
		expect(() => planAward(input({ site: { ...SITE, vendorField: {} } }))).toThrow('No vendor groups field on Shot. The award cannot reach SH010.');
	});

	it('refuses a scenario whose shares do not make 100', () => {
		const bad: AwardScenario = { ...SCENARIO, picks: [{ target: onShot('sh020'), shares: [{ bidId: 'bidA', percent: '50' }] }] };
		expect(() => planAward(input({ scenario: bad }))).toThrow('The shares of shot sh020 sum to 50%, not 100%.');
	});
});


describe('planAward, the Group per vendor', () => {
	it('takes a Group picked at publish over the invitation, and a vendor without one when told so', () => {
		const noGroup = { ...REQUEST, vendors: [{ ...REQUEST.vendors[0], fpt: undefined }, REQUEST.vendors[1]] };
		const picked = planAward(input({ request: noGroup, options: { date: '2026-11-20', groups: { va: 41 } } }));
		expect((picked.steps[0].writes[0] as Extract<Write, { kind: 'create' }>).data.sg_vendor).toEqual({ type: 'Group', id: 41 });
		expect(picked.steps[1].writes.find((w) => w.kind === 'addGroups' && w.id === 101)).toMatchObject({ groups: [41] });

		const none = planAward(input({ request: noGroup, options: { date: '2026-11-20', groups: { va: null } } }));
		expect((none.steps[0].writes[0] as Extract<Write, { kind: 'create' }>).data.sg_vendor).toBeNull();
		const adds = none.steps[1].writes.filter((w) => w.kind === 'addGroups');
		expect(adds).toEqual([
			{ kind: 'addGroups', itemType: 'Shot', id: 102, field: 'sg_vendor_groups', groups: [39] },
			{ kind: 'addGroups', itemType: 'Shot', id: 103, field: 'sg_vendor_groups', groups: [39] }
		]);
		expect(none.preview.groups[0]).toEqual({ item: 'SH010', target: 'shot:sh010', ref: { type: 'Shot', id: 101 }, added: [], addedVendors: [], already: [], withoutGroup: ['Vendor A'] });
		expect(none.warnings).toContain('Vendor A has no Flow PT Group. Its Bid is written, and no Shot or Asset is shared with it.');
	});
});

describe('planAward, the preview', () => {
	it('lists every line it writes with both amounts, the share and the awarded part', () => {
		const plan = planAward(input());
		expect(plan.preview.lines.map((l) => [l.item, l.vendor, l.action])).toEqual([
			['SH010', 'Vendor A', 'create'],
			['SH020', 'Vendor A', 'create'],
			['SH020', 'Vendor B', 'create'],
			['SH030', 'Vendor B', 'create']
		]);
		expect(plan.preview.lines[2]).toEqual({
			key: lineKey(KEY_B, onShot('sh020')),
			item: 'SH020',
			target: 'shot:sh020',
			ref: { type: 'Shot', id: 102 },
			vendor: 'Vendor B',
			action: 'create',
			amount: money(180000, 'EUR'),
			amountBase: money(198000, 'USD'),
			share: '50',
			awardedBase: money(99000, 'USD'),
			excluded: false
		});
		expect(plan.preview.bids[1]).toMatchObject({ vendor: 'Vendor B', currency: 'EUR', rate: rate('EUR', 'USD', '1.1', '2026-11-15'), group: 39 });
		expect(plan.preview.removed).toEqual({ bids: [], lines: [], groups: [], items: [] });
	});
});

describe('planAward again, after a change', () => {
	const KEY_A030 = lineKey(KEY_A, onShot('sh030'));
	const KEY_A010 = lineKey(KEY_A, onShot('sh010'));
	// The first run gave sh030 to A, and wrote A's Bid with its link.
	const previous: Written = {
		bids: [{ key: KEY_A, id: 5001, created: true }],
		lines: [
			{ key: KEY_A010, id: 6001, created: true },
			{ key: KEY_A030, id: 6003, created: true }
		],
		groups: [
			{ itemType: 'Shot', id: 101, field: 'sg_vendor_groups', groups: [38] },
			{ itemType: 'Shot', id: 103, field: 'sg_vendor_groups', groups: [38] }
		],
		attachments: [{ key: KEY_A, id: 77 }]
	};
	const existing: Existing = { bids: [{ id: 5001, key: KEY_A }], lines: [{ id: 6001, key: KEY_A010 }, { id: 6003, key: KEY_A030 }], groups: { 'Shot:101': [38], 'Shot:103': [38] } };

	it('first takes back what the new scenario drops, then updates what it keeps', () => {
		const plan = planAward(input({ existing, previous }));
		expect(plan.steps[0]).toEqual({
			label: 'Take back what the scenario dropped',
			mode: 'batch',
			writes: [
				{ kind: 'removeGroups', itemType: 'Shot', id: 103, field: 'sg_vendor_groups', groups: [38] },
				{ kind: 'delete', entity: 'line', key: KEY_A030, id: 6003 }
			]
		});
		expect(plan.steps[1].writes[0]).toMatchObject({ kind: 'update', key: KEY_A, id: 5001 });
		expect(plan.preview.removed).toEqual({ bids: [], lines: [{ key: KEY_A030, item: 'SH030', vendor: 'Vendor A' }], groups: [{ item: 'SH030', ref: { type: 'Shot', id: 103 }, groups: [38] }], items: [] });
	});

	it('keeps a Group another award still needs, and deletes a Bid the scenario no longer names with its link', () => {
		const onlyB: AwardScenario = { ...SCENARIO, picks: [{ target: onShot('sh030'), shares: [{ bidId: 'bidB', percent: '100' }] }] };
		const plan = planAward(input({ bids: [BID_B], scenario: onlyB, existing: { ...existing, needed: new Set(['Shot:101:38']) }, previous }));
		expect(plan.steps[0].writes).toEqual([
			{ kind: 'removeGroups', itemType: 'Shot', id: 103, field: 'sg_vendor_groups', groups: [38] },
			{ kind: 'delete', entity: 'line', key: KEY_A010, id: 6001 },
			{ kind: 'delete', entity: 'line', key: KEY_A030, id: 6003 },
			{ kind: 'delete', entity: 'attachment', key: KEY_A, id: 77 },
			{ kind: 'delete', entity: 'bid', key: KEY_A, id: 5001 }
		]);
	});

	it('sends the take back as a batch removal and deletes', () => {
		const [remove, del] = planAward(input({ existing, previous })).steps[0].writes;
		expect(toBatchRequest(remove, SITE, new Map())).toEqual({
			request_type: 'update',
			entity: 'Shot',
			record_id: 103,
			data: { sg_vendor_groups: { multi_entity_update_mode: 'remove', value: [{ type: 'Group', id: 38 }] } }
		});
		expect(toBatchRequest(del, SITE, new Map())).toEqual({ request_type: 'delete', entity: 'CustomEntity15', record_id: 6003 });
		expect(toBatchRequest({ kind: 'delete', entity: 'attachment', key: KEY_A, id: 77 }, SITE, new Map())).toEqual({ request_type: 'delete', entity: 'Attachment', record_id: 77 });
	});

	it('checks the take back on the read-back: the row gone, the Group off', () => {
		const plan = { steps: [{ label: 'x', mode: 'batch' as const, writes: [{ kind: 'removeGroups' as const, itemType: 'Shot' as const, id: 103, field: 'sg_vendor_groups', groups: [38] }, { kind: 'delete' as const, entity: 'line' as const, key: KEY_A030, id: 6003 }] }], preview: { bids: [], lines: [], groups: [], removed: { bids: [], lines: [], groups: [], items: [] }, created: [], sequences: [], unlinked: [] }, collisions: [], released: [], warnings: [] };
		expect(verify(plan, { bids: new Map(), lines: new Map(), groups: { 'Shot:103': [39] } }, SITE, new Map())).toEqual([]);
		const still = { bids: new Map(), lines: new Map([[KEY_A030, { id: 6003, attributes: {}, relationships: {} }]]), groups: { 'Shot:103': [38] } };
		expect(verify(plan, still, SITE, new Map())).toEqual(['Shot 103: Group 38 is still in sg_vendor_groups.', `${KEY_A030}: the row is still there.`]);
	});
});

describe('isClean', () => {
	it('is clean only when nothing the app wrote is left', () => {
		expect(isClean(NOTHING_WRITTEN)).toBe(true);
		expect(isClean({ ...NOTHING_WRITTEN, groups: [{ itemType: 'Shot', id: 1, field: 'f', groups: [38] }] })).toBe(false);
		expect(isClean({ ...NOTHING_WRITTEN, attachments: [{ key: 'k', id: 1 }] })).toBe(false);
	});
});

describe('mergeWritten', () => {
	it('keeps what an earlier run created as created, adds the new, drops what was taken back', () => {
		const previous: Written = {
			bids: [{ key: 'b1', id: 1, created: true }],
			lines: [
				{ key: 'l1', id: 11, created: true },
				{ key: 'l2', id: 12, created: true }
			],
			groups: [{ itemType: 'Shot', id: 101, field: 'f', groups: [38, 39] }],
			attachments: [{ key: 'b1', id: 77 }]
		};
		const run: Written = {
			bids: [
				{ key: 'b1', id: 1, created: false },
				{ key: 'b2', id: 2, created: true }
			],
			lines: [{ key: 'l3', id: 13, created: true }],
			groups: [
				{ itemType: 'Shot', id: 101, field: 'f', groups: [40] },
				{ itemType: 'Shot', id: 102, field: 'f', groups: [38] }
			],
			attachments: [{ key: 'b2', id: 78 }]
		};
		const removed = { bids: [], lines: [12], attachments: [], groups: [{ itemType: 'Shot' as const, id: 101, field: 'f', groups: [39] }] };
		expect(mergeWritten(previous, run, removed)).toEqual({
			bids: [
				{ key: 'b1', id: 1, created: true },
				{ key: 'b2', id: 2, created: true }
			],
			lines: [
				{ key: 'l1', id: 11, created: true },
				{ key: 'l3', id: 13, created: true }
			],
			groups: [
				{ itemType: 'Shot', id: 101, field: 'f', groups: [38, 40] },
				{ itemType: 'Shot', id: 102, field: 'f', groups: [38] }
			],
			attachments: [
				{ key: 'b1', id: 77 },
				{ key: 'b2', id: 78 }
			],
			items: []
		});
	});

	it('starts from nothing', () => {
		const run: Written = { bids: [{ key: 'b1', id: 1, created: true }], lines: [], groups: [], attachments: [] };
		expect(mergeWritten(null, run)).toEqual(run);
	});
});

describe('toBatchRequest', () => {
	it('puts in the new Bid id and sends the Group add in the body (recipe 009, 154)', () => {
		const plan = planAward(input());
		const ids = new Map([
			[KEY_A, 5001],
			[KEY_B, 5002]
		]);
		expect(toBatchRequest(plan.steps[2].writes[0], SITE, ids)).toEqual({
			request_type: 'update',
			entity: 'CustomEntity14',
			record_id: 5001,
			data: { sg_app_link: { url: 'https://bids.test/b/bidA', name: 'sg-bids' } }
		});
		const [lineWrite] = plan.steps[1].writes;
		expect(toBatchRequest(lineWrite, SITE, ids)).toMatchObject({ request_type: 'create', entity: 'CustomEntity15', data: { sg_bid: { type: 'CustomEntity14', id: 5001 } } });
		const groups = plan.steps[1].writes.find((w) => w.kind === 'addGroups')!;
		expect(toBatchRequest(groups, SITE, ids)).toEqual({
			request_type: 'update',
			entity: 'Shot',
			record_id: 101,
			data: { sg_vendor_groups: { multi_entity_update_mode: 'add', value: [{ type: 'Group', id: 38 }] } }
		});
	});

	it('refuses to send a line whose Bid has no id yet', () => {
		const [lineWrite] = planAward(input()).steps[1].writes;
		expect(() => toBatchRequest(lineWrite, SITE, new Map())).toThrow(`The Bid ${KEY_A} has no id yet.`);
	});
});

describe('chunk', () => {
	it('keeps batches at 200 requests, in order (recipe 002)', () => {
		const list = Array.from({ length: 450 }, (_, i) => i);
		expect(chunk(list).map((c) => c.length)).toEqual([200, 200, 50]);
		expect(chunk(list).flat()).toEqual(list);
		expect(chunk([])).toEqual([]);
	});
});

describe('verify', () => {
	const row = (id: number, attributes: Record<string, unknown>, relationships: Record<string, unknown> = {}): ReadRow => ({
		id,
		attributes,
		relationships: Object.fromEntries(Object.entries(relationships).map(([k, v]) => [k, { data: v }]))
	});

	it('passes a read-back that matches, the site reading currency as strings and floats with a point', () => {
		const scenario: AwardScenario = { ...SCENARIO, picks: [{ target: onShot('sh010'), shares: [{ bidId: 'bidA', percent: '100' }] }] };
		const plan = planAward(input({ bids: [BID_A], scenario, options: { date: '2026-11-20', requestCode: 'RQ-1' } }));
		const ids = new Map([[KEY_A, 5001]]);
		const bidRow = row(
			5001,
			{
				code: 'RQ-1 Vendor A R1',
				sg_sgbids_key: KEY_A,
				sg_round: 1,
				sg_total: '4500.0',
				sg_currency: 'USD',
				sg_total_base: '4500.0',
				sg_base_currency: 'USD',
				sg_rebate_estimate: '0.0',
				sg_total_after_rebate: '4500.0',
				sg_exchange_rate: null,
				sg_rate_date: null,
				sg_request_code: 'RQ-1',
				sg_submitted_date: '2026-11-20',
				sg_awarded_date: '2026-11-20',
				sg_bid_version: 2,
				sg_status_list: 'fin'
			},
			{ sg_vendor: { type: 'Group', id: 38, name: 'qa' }, project: { type: 'Project', id: 1180 } }
		);
		const lkey = lineKey(KEY_A, onShot('sh010'));
		const lineRow = row(
			6001,
			{ code: 'SH010 Vendor A', sg_sgbids_key: lkey, sg_amount: '1000.0', sg_currency: 'USD', sg_amount_base: '1000.0', sg_share_percent: '100.0', sg_awarded_base: '1000.0', sg_awarded: true, sg_excluded: false },
			{ sg_bid: { type: 'CustomEntity14', id: 5001 }, sg_item: { type: 'Shot', id: 101 }, project: { type: 'Project', id: 1180 } }
		);
		const back = { bids: new Map([[KEY_A, bidRow]]), lines: new Map([[lkey, lineRow]]), groups: { 'Shot:101': [38] } };
		expect(verify(plan, back, SITE, ids)).toEqual([]);

		const wrong = { ...back, lines: new Map([[lkey, { ...lineRow, attributes: { ...lineRow.attributes, sg_amount: '999.99' } }]]), groups: {} };
		expect(verify(plan, wrong, SITE, ids)).toEqual([`${lkey}: sg_amount reads back "999.99".`, 'Shot 101: Group 38 is not in sg_vendor_groups.']);
		expect(verify(plan, { ...back, bids: new Map() }, SITE, ids)).toEqual([`${KEY_A}: no row reads back.`]);

		const linked = planAward(input({ bids: [BID_A], scenario, options: { date: '2026-11-20', requestCode: 'RQ-1', appLinks: { bidA: 'https://bids.test/b/bidA' } } }));
		const withLink = (url: string) => ({ ...back, bids: new Map([[KEY_A, { ...bidRow, attributes: { ...bidRow.attributes, sg_app_link: { url, name: 'sg-bids', link_type: 'web', type: 'Attachment', id: 77 } } }]]) });
		expect(verify(linked, withLink('https://bids.test/b/bidA'), SITE, ids)).toEqual([]);
		expect(verify(linked, withLink('https://elsewhere.test'), SITE, ids)).toEqual([`${KEY_A}: sg_app_link reads back "https://elsewhere.test".`]);
	});

	it('finds the Attachment a link minted', () => {
		expect(attachmentOf(row(1, { sg_app_link: { url: 'x', name: 'sg-bids', link_type: 'web', type: 'Attachment', id: 77 } }))).toBe(77);
		expect(attachmentOf(row(1, { sg_app_link: null }))).toBeNull();
	});
});

describe('planUndo', () => {
	const written = {
		bids: [
			{ key: KEY_A, id: 5001, created: true },
			{ key: KEY_B, id: 5002, created: false }
		],
		lines: [
			{ key: 'l1', id: 6001, created: true },
			{ key: 'l2', id: 6002, created: false }
		],
		groups: [
			{ itemType: 'Shot' as const, id: 101, field: 'sg_vendor_groups', groups: [38] },
			{ itemType: 'Shot' as const, id: 102, field: 'sg_vendor_groups', groups: [38, 39] }
		],
		attachments: [{ key: KEY_A, id: 77 }]
	};

	it('takes the Groups away first, then deletes the created lines, Attachments and Bids', () => {
		const undo = planUndo(written, SITE);
		expect(undo.writes).toEqual([
			{ kind: 'removeGroups', itemType: 'Shot', id: 101, field: 'sg_vendor_groups', groups: [38] },
			{ kind: 'removeGroups', itemType: 'Shot', id: 102, field: 'sg_vendor_groups', groups: [38, 39] },
			{ kind: 'delete', entityType: 'CustomEntity15', id: 6001 },
			{ kind: 'delete', entityType: 'Attachment', id: 77 },
			{ kind: 'delete', entityType: 'CustomEntity14', id: 5001 }
		]);
		expect(undo.untouched).toEqual([KEY_B, 'l2']);
	});

	it('keeps a Group another award on the item still needs (recipe 009)', () => {
		const undo = planUndo(written, SITE, new Set(['Shot:102:39']));
		expect(undo.writes[1]).toEqual({ kind: 'removeGroups', itemType: 'Shot', id: 102, field: 'sg_vendor_groups', groups: [38] });
		expect(undo.kept).toEqual([{ itemType: 'Shot', id: 102, group: 39 }]);
	});

	it('sends a removal in the body and a delete by record_id', () => {
		const [remove, , del] = planUndo(written, SITE).writes;
		expect(undoRequest(remove)).toEqual({
			request_type: 'update',
			entity: 'Shot',
			record_id: 101,
			data: { sg_vendor_groups: { multi_entity_update_mode: 'remove', value: [{ type: 'Group', id: 38 }] } }
		});
		expect(undoRequest(del)).toEqual({ request_type: 'delete', entity: 'CustomEntity15', record_id: 6001 });
	});
});

describe('awarded totals', () => {
	it('asks one _summarize for every item, grouped on the item link (167)', () => {
		const q = awardedTotalsQuery(SITE, [{ type: 'Shot', id: 101 }, { type: 'Asset', id: 201 }], 'USD');
		expect(q.filters.conditions).toEqual([
			['project', 'is', { type: 'Project', id: 1180 }],
			['sg_item', 'in', [{ type: 'Shot', id: 101 }, { type: 'Asset', id: 201 }]],
			['sg_awarded', 'is', true],
			['sg_bid.CustomEntity14.sg_base_currency', 'is', 'USD']
		]);
		expect(q.grouping).toEqual([{ field: 'sg_item', type: 'exact', direction: 'asc' }]);
	});

	it('reads each group into an amount keyed by the item', () => {
		const groups: { groupValue: unknown; summaries: Record<string, number> }[] = [
			{ groupValue: { type: 'Shot', id: 101, name: 'sh010' }, summaries: { sg_awarded_base: 2000, id: 2 } },
			{ groupValue: { type: 'Shot', id: 102, name: '' }, summaries: { sg_awarded_base: 300.25, id: 1 } },
			{ groupValue: null, summaries: {} }
		];
		expect(awardedTotals(groups, 'USD')).toEqual({
			'Shot:101': { total: money(200000, 'USD'), lines: 2 },
			'Shot:102': { total: money(30025, 'USD'), lines: 1 }
		});
		expect(awardedTotals([{ groupValue: { type: 'Shot', id: 1 }, summaries: { sg_awarded_base: 1500, id: 1 } }], 'JPY')['Shot:1'].total).toEqual(money(1500, 'JPY'));
		expect(awardedTotals([{ groupValue: { type: 'Shot', id: 1 }, summaries: { sg_awarded_base: 12.35, id: 1 } }], 'KWD')['Shot:1'].total).toEqual(money(12350, 'KWD'));
	});
});
