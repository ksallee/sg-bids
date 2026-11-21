import { describe, expect, it } from 'vitest';
import { bidsToPublish, exposureOf, gate, siteOf, type GateInput } from './award-gate';
import { bid, line, onAsset, onShot, request, shot, asset } from './fixtures';
import { BID_FIELDS, LINE_FIELDS, linkTypes, type FieldSpec } from './fpt-fields';
import { setupReport, type RightsRead, type SetupInput } from './fpt-setup';
import type { AwardScenario, InvitedVendor } from './model';
import { money, rate } from './money';

// Shaped like GET /schema/permission_groups/vendor/entity_types/<Type> (162).
const rights = (read: unknown): RightsRead => ({ ok: true, data: { actions: { read } } });
const DENIED = rights({ access: 'denied' });
const ALLOWED = rights({ access: 'allowed' });
const TOKEN = { type: 'HumanUser', id: 0, valid: 'logged_in_user_token' };
const SHOT_RULE = rights({ access: 'conditional', condition: { logical_operator: 'or', conditions: [{ path: 'sg_vendor_groups.Group.users', relation: 'is', values: [TOKEN] }] } });

const complete = (fields: readonly FieldSpec[]) =>
	Object.fromEntries(fields.map((f) => [f.name, f.validTypes ? { dataType: f.dataType, validTypes: linkTypes(f.validTypes, 'CustomEntity14') } : { dataType: f.dataType }]));
const ITEM = { code: { dataType: 'text' }, sg_vendor_groups: { dataType: 'multi_entity', validTypes: ['Group'] } };

function site(extra: Partial<SetupInput> = {}): SetupInput {
	return {
		entityTypes: [
			{ name: 'Shot', displayName: 'Shot' },
			{ name: 'Asset', displayName: 'Asset' },
			{ name: 'Group', displayName: 'Group' },
			{ name: 'CustomEntity14', displayName: 'Bid' },
			{ name: 'CustomEntity15', displayName: 'Bid Line' }
		],
		fields: { CustomEntity14: complete(BID_FIELDS), CustomEntity15: complete(LINE_FIELDS), Shot: ITEM, Asset: ITEM },
		bidStatuses: [
			{ code: 'rev', label: 'Pending Review' },
			{ code: 'awd', label: 'Awarded' },
			{ code: 'omt', label: 'Omitted' }
		],
		vendorGroup: 'vendor',
		vendorGroupName: 'Vendor',
		rights: { CustomEntity14: DENIED, CustomEntity15: DENIED, EventLogEntry: ALLOWED, Shot: SHOT_RULE, Asset: SHOT_RULE },
		...extra
	};
}

const vendor = (id: string, name: string, group?: number): InvitedVendor => ({ id, name, email: `${id}@x.test`, ndaExecuted: true, ...(group ? { fpt: { type: 'Group', id: group } } : {}) });

const REQUEST = request({
	shots: [shot('sh010', { fpt: { type: 'Shot', id: 101 } }), shot('sh020', { fpt: { type: 'Shot', id: 102 } })],
	assets: [asset('tree', { fpt: { type: 'Asset', id: 201 } })],
	vendors: [vendor('va', 'Vendor A', 38), vendor('vb', 'Vendor B'), vendor('vc', 'Vendor C', 40)]
});
const BID_A = bid({ id: 'bidA', vendorId: 'va', currency: 'USD', lines: [line('a1', onShot('sh010'), money(100000, 'USD')), line('a2', onShot('sh020'), money(90000, 'USD'))] });
const BID_B = bid({ id: 'bidB', vendorId: 'vb', currency: 'GBP', lines: [line('b2', onShot('sh020'), money(80000, 'GBP')), line('b3', onAsset('tree'), money(5000, 'GBP'))] });
const BID_C = bid({ id: 'bidC', vendorId: 'vc', currency: 'EUR', lines: [line('c1', onShot('sh010'), money(120000, 'EUR'))] });
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
		}
	]
};

function input(extra: Partial<GateInput> = {}): GateInput {
	return {
		projectId: 1180,
		report: setupReport(site()),
		request: REQUEST,
		bids: [BID_A, { ...BID_B, rate: rate('GBP', 'USD', '1.27', '2026-11-18') }, BID_C],
		scenario: SCENARIO,
		allLines: false,
		groups: { vb: 39 },
		exposureAccepted: false,
		...extra
	};
}

describe('bidsToPublish', () => {
	it('takes the bids with a row in the scenario, or every submitted bid with every line', () => {
		expect(bidsToPublish([BID_A, BID_B, BID_C], SCENARIO, false).map((b) => b.id)).toEqual(['bidA', 'bidB']);
		expect(bidsToPublish([BID_A, BID_B, { ...BID_C, status: 'withdrawn' }], SCENARIO, true).map((b) => b.id)).toEqual(['bidA', 'bidB']);
		expect(bidsToPublish([BID_A], null, false)).toEqual([]);
	});
});

describe('gate', () => {
	it('is ready on a set-up site, with a rate for each other currency and a Group for each vendor', () => {
		const g = gate(input());
		expect(g.blockers).toEqual([]);
		expect(g.ready).toBe(true);
		expect(g.needsConfirm).toBe(false);
		expect(g.exposure).toEqual({ state: 'safe' });
		expect(g.site).toEqual({ projectId: 1180, bidType: 'CustomEntity14', lineType: 'CustomEntity15', vendorField: { Shot: 'sg_vendor_groups', Asset: 'sg_vendor_groups' }, statuses: { submitted: 'rev', awarded: 'awd', not_awarded: 'omt' } });
		expect(g.vendors).toEqual([
			{ vendorId: 'va', name: 'Vendor A', invited: { type: 'Group', id: 38 }, source: 'invitation', group: 38, awarded: true },
			{ vendorId: 'vb', name: 'Vendor B', invited: null, source: 'picked', group: 39, awarded: true }
		]);
		expect(g.groups).toEqual({ va: 38, vb: 39 });
	});

	it('blocks a vendor with no Group until one is picked or none is chosen', () => {
		const g = gate(input({ groups: {} }));
		expect(g.ready).toBe(false);
		expect(g.blockers).toEqual(['Vendor B has no Flow PT Group. Pick one, or publish its Bid without sharing any Shot or Asset with it.']);
		const none = gate(input({ groups: { vb: null } }));
		expect(none.ready).toBe(true);
		expect(none.vendors[1]).toMatchObject({ source: 'none', group: null });
		expect(none.groups).toEqual({ va: 38, vb: null });
	});

	it('blocks a vendor in another currency with no rate, and every vendor needs one with every line', () => {
		expect(gate(input({ bids: [BID_A, BID_B, BID_C] })).blockers).toEqual(['Vendor B bids in GBP and has no rate to USD. Set it on the compare page.']);
		const all = gate(input({ allLines: true }));
		expect(all.blockers).toEqual(['Vendor C bids in EUR and has no rate to USD. Set it on the compare page.']);
		expect(all.vendors.map((v) => [v.name, v.awarded])).toEqual([
			['Vendor A', true],
			['Vendor B', true],
			['Vendor C', false]
		]);
	});

	it('blocks with no chosen scenario, and while reading', () => {
		expect(gate(input({ scenario: null })).blockers).toContain('No scenario is chosen. Mark one as chosen on the compare page.');
		expect(gate(input({ report: null })).blockers).toEqual(['The Flow PT site is still being read.']);
	});

	it('names the awarded rows with no Flow PT row, per kind, and blocks until a choice is made for the kind', () => {
		const noRow = { ...REQUEST, shots: [shot('sh010', { code: 'SH900', source: 'breakdown' }), REQUEST.shots[1]] };
		const g = gate(input({ request: noRow }));
		expect(g.missing).toEqual({ shot: { labels: ['SH900'], choice: null }, asset: { labels: [], choice: null } });
		expect(g.blockers).toEqual(['1 shot has no Flow PT Shot: SH900. Create it, publish without it, or match it first.']);
		expect(g.problems[0]).toMatchObject({ target: 'gate-missing' });
		const create = gate(input({ request: noRow, missing: { shot: 'create' } }));
		expect(create.blockers).toEqual([]);
		expect(create.missing.shot.choice).toBe('create');
		expect(gate(input({ request: noRow, missing: { shot: 'without' } })).ready).toBe(true);
	});

	it('points each problem at what fixes it, and names the missing fields', () => {
		const g = gate(input({ groups: {}, bids: [BID_A, BID_B, BID_C] }));
		expect(g.problems.map((p) => [p.target, p.href ?? null])).toEqual([
			['gate-vendor-vb', null],
			['gate-rates', '/requests/req1/compare']
		]);
		const partial = site({ fields: { ...site().fields, CustomEntity15: { code: { dataType: 'text' } } } });
		const fields = gate(input({ report: setupReport(partial) })).problems.find((p) => p.target === 'gate-site')!;
		expect(fields.message).toMatch(/^10 fields are missing on Bid Line: sgbids key, Bid, Item, Amount, Currency, Amount Base, Share Percent, Awarded Base, Awarded and Excluded\. Create them here\.$/);
	});

	it('counts the fields it can create, and says what an admin must do', () => {
		const partial = site({ fields: { ...site().fields, CustomEntity15: { code: { dataType: 'text' } } } });
		const g = gate(input({ report: setupReport(partial) }));
		expect(g.missingFields).toBe(LINE_FIELDS.length - 1);
		expect(g.blockers).toHaveLength(1);
		expect(g.blockers[0]).toMatch(new RegExp(`^${LINE_FIELDS.length - 1} fields are missing on Bid Line: `));
		const noLine = site({ entityTypes: site().entityTypes.filter((t) => t.name !== 'CustomEntity15') });
		const g2 = gate(input({ report: setupReport(noLine) }));
		expect(g2.site).toBeNull();
		expect(g2.blockers).toContain("Bid Line is not enabled on the site. An admin enables a custom entity displayed 'Bid Line', with no Tasks and no Versions.");
		const wrong = site({ fields: { ...site().fields, CustomEntity14: { ...complete(BID_FIELDS), sg_total: { dataType: 'number' } } } });
		expect(gate(input({ report: setupReport(wrong) })).blockers).toEqual(['Bid.sg_total is a number field. sg-bids needs currency. An admin fixes it in the web interface.']);
	});

	it('blocks an award on Assets when Asset has no vendor groups field', () => {
		const noAssetField = site({ fields: { ...site().fields, Asset: { code: { dataType: 'text' } } } });
		const assetPick: AwardScenario = { ...SCENARIO, picks: [...SCENARIO.picks, { target: onAsset('tree'), shares: [{ bidId: 'bidB', percent: '100' }] }] };
		expect(gate(input({ report: setupReport(noAssetField), scenario: assetPick })).blockers).toEqual(['Asset: No multi-entity field to Group. The award cannot share an Asset.']);
		expect(gate(input({ report: setupReport(noAssetField) })).blockers).toEqual([]);
	});

	it('asks for publish anyway when the Vendor role reads Bid or Bid Line, and is ready after', () => {
		const open = setupReport(site({ rights: { ...site().rights, CustomEntity14: ALLOWED, CustomEntity15: ALLOWED } }));
		const g = gate(input({ report: open }));
		expect(g.blockers).toEqual([]);
		expect(g.needsConfirm).toBe(true);
		expect(g.ready).toBe(false);
		expect(gate(input({ report: open, exposureAccepted: true })).ready).toBe(true);
	});
});

describe('exposureOf', () => {
	it('names what a vendor with a login reads, and what an admin sets', () => {
		const open = setupReport(site({ rights: { ...site().rights, CustomEntity14: ALLOWED, CustomEntity15: ALLOWED } }));
		expect(exposureOf(open, 'USD')).toEqual({
			state: 'exposed',
			lines: [
				"A vendor with a Flow PT login can read every Bid in this project: each vendor's name and Group, its total in its own currency and in USD, the rate, and whether it won; and every Bid Line: the price of each Shot and Asset from each vendor, each share, and who won it.",
				'The vendors you invited through the app see none of this unless they also have a Flow PT login.'
			],
			adminSteps: ['In the Vendor permission role, set See entities to Not allowed for Bid.', 'In the Vendor permission role, set See entities to Not allowed for Bid Line.']
		});
	});

	it('says a condition does not stop it', () => {
		const ruled = setupReport(site({ rights: { ...site().rights, CustomEntity15: SHOT_RULE } }));
		const e = exposureOf(ruled, 'USD');
		expect(e.state).toBe('exposed');
		expect(e.state !== 'safe' && e.lines[1]).toBe('A condition on the rule does not stop it. A filter through a link, a summary grouped on a link and the event log still show the rows.');
		expect(e.state !== 'safe' && e.adminSteps).toEqual(['In the Vendor permission role, set See entities to Not allowed for Bid Line.']);
	});

	it('says plainly when the rights could not be read, as for a script key or a Manager', () => {
		const unread: RightsRead = { ok: false, status: 404, reason: "No group 'vendor' for this caller. A script key reads none." };
		const e = exposureOf(setupReport(site({ rights: { ...site().rights, CustomEntity14: unread, CustomEntity15: unread } })), 'USD');
		expect(e).toEqual({
			state: 'unknown',
			lines: [
				"The app could not read what the Vendor role may see of Bid and Bid Line. No group 'vendor' for this caller. A script key reads none.",
				'If the role can read them, a vendor with a Flow PT login reads every bid in this project: names, totals, every price, and who won.',
				'Sign in as an Admin to check, or publish anyway.'
			],
			adminSteps: ['In the Vendor permission role, set See entities to Not allowed for Bid.', 'In the Vendor permission role, set See entities to Not allowed for Bid Line.']
		});
	});
});

describe('siteOf', () => {
	it('is null until both entities are found', () => {
		const noBid = setupReport(site({ entityTypes: site().entityTypes.filter((t) => t.name !== 'CustomEntity14') }));
		expect(siteOf(noBid, 1)).toBeNull();
	});
});
