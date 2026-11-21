import { describe, expect, it } from 'vitest';
import { asset, bid, line, onAsset, onShot, shot } from './fixtures';
import type { AwardScenario, InvitedVendor, RequestHeader } from './model';
import { money, rate } from './money';
import {
	bidFromRows,
	bidToRows,
	headerToColumns,
	itemsFromRows,
	itemsToRows,
	packagesFromRows,
	packagesToRows,
	requestFromRows,
	scenarioFromRows,
	scenarioToRows,
	vendorFromRow,
	vendorToColumns,
	type BidLineRow,
	type BidRow,
	type InvitationRow,
	type RequestItemRow,
	type RequestRow
} from './rows';

const tenant = { site_host: 'studio.example.com', project_id: 70 };

const header: RequestHeader = {
	project: 'Show',
	projectRef: { type: 'Project', id: 999 },
	studio: 'Studio',
	round: 2,
	dueDate: '2026-12-01',
	baseCurrency: 'USD',
	materialLink: 'https://example.com/cut',
	assumptions: ['4K', 'ACES']
};

function requestRow(extra: Partial<RequestRow> = {}): RequestRow {
	return {
		id: 'req-uuid',
		...tenant,
		code: 'BR-1',
		status: 'issued',
		issued_at: '2026-11-20T10:00:00Z',
		closed_at: null,
		created_at: '2026-11-20T09:00:00Z',
		updated_at: '2026-11-20T10:00:00Z',
		...headerToColumns(header),
		...extra
	};
}

function itemRows(): RequestItemRow[] {
	const shots = [shot('sh010', { fpt: { type: 'Shot', id: 1234 }, frames: 96, assetIds: ['hero'] }), shot('sh020', { omitted: true })];
	const assets = [asset('hero', { fpt: { type: 'Asset', id: 55 }, type: 'Character' })];
	return itemsToRows(shots, assets).map((item, index) => ({
		id: `item-${index}`,
		request_id: 'req-uuid',
		...tenant,
		...item
	}));
}

describe('header', () => {
	it('keeps round, currency and due day in columns, the rest in the jsonb', () => {
		const columns = headerToColumns(header);
		expect(columns.round).toBe(2);
		expect(columns.base_currency).toBe('USD');
		expect(columns.due_on).toBe('2026-12-01');
		expect(columns.header).toEqual({ project: 'Show', studio: 'Studio', materialLink: 'https://example.com/cut', assumptions: ['4K', 'ACES'] });
	});

	it('never stores the project ref: the tenant is the project', () => {
		expect(headerToColumns(header).header).not.toHaveProperty('projectRef');
		const request = requestFromRows(requestRow(), [], []);
		expect(request.header.projectRef).toEqual({ type: 'Project', id: 70 });
	});

	it('refuses a currency that is not ISO 4217 or a round below 1', () => {
		expect(() => headerToColumns({ ...header, baseCurrency: 'usd' })).toThrow();
		expect(() => headerToColumns({ ...header, round: 0 })).toThrow();
	});
});

describe('items', () => {
	it('round-trips shots and assets in order', () => {
		const { shots, assets } = itemsFromRows(itemRows().reverse());
		expect(shots.map((s) => s.id)).toEqual(['sh010', 'sh020']);
		expect(shots[0]).toEqual(shot('sh010', { fpt: { type: 'Shot', id: 1234 }, frames: 96, assetIds: ['hero'] }));
		expect(shots[1].omitted).toBe(true);
		expect(assets).toEqual([asset('hero', { fpt: { type: 'Asset', id: 55 }, type: 'Character' })]);
	});

	it('writes the kind, key, code and Flow PT entity as columns', () => {
		const [first] = itemsToRows([shot('sh010', { fpt: { type: 'Shot', id: 1234 } })], []);
		expect(first).toMatchObject({ kind: 'shot', key: 'sh010', code: 'SH010', fpt_type: 'Shot', fpt_id: 1234, omitted: false, position: 0 });
		expect(first.fields).toEqual({ assetIds: [] });
	});

	it('refuses two items with one key', () => {
		expect(() => itemsToRows([shot('a'), shot('a')], [])).toThrow();
	});

	it('writes where a row came from as its own column, fpt by default, and reads it back', () => {
		const rows = itemsToRows([shot('sh010', { fpt: { type: 'Shot', id: 1 } }), shot('bd-1', { source: 'breakdown', frames: 48 })], [asset('bd-2', { source: 'breakdown' })]);
		expect(rows.map((r) => r.source)).toEqual(['fpt', 'breakdown', 'breakdown']);
		for (const row of rows) expect(row.fields).not.toHaveProperty('source');
		expect(rows[1]).toMatchObject({ fpt_type: null, fpt_id: null });
		const back = itemsFromRows(rows);
		expect(back.shots[0]).not.toHaveProperty('source');
		expect(back.shots[1]).toEqual(shot('bd-1', { source: 'breakdown', frames: 48 }));
		expect(back.assets[0]).toEqual(asset('bd-2', { source: 'breakdown' }));
	});

	it('writes a row count as its own column, 1 by default and for a Flow PT row, and reads it back', () => {
		const rows = itemsToRows([shot('sh010', { fpt: { type: 'Shot', id: 1 } }), shot('bd-1', { source: 'breakdown', frames: 80, count: 120 })], [asset('bd-2', { source: 'breakdown', count: 12 }), asset('bd-3', { source: 'breakdown' })]);
		expect(rows.map((r) => r.unit_count)).toEqual([1, 120, 12, 1]);
		for (const row of rows) expect(row.fields).not.toHaveProperty('count');
		const back = itemsFromRows(rows);
		expect(back.shots[1]).toEqual(shot('bd-1', { source: 'breakdown', frames: 80, count: 120 }));
		expect(back.shots[0]).not.toHaveProperty('count');
		expect(back.assets[0].count).toBe(12);
		expect(back.assets[1]).not.toHaveProperty('count');
	});

	it('reads a row stored before counts as 1', () => {
		const [row] = itemsToRows([shot('bd-1', { source: 'breakdown' })], []);
		const { unit_count: _, ...old } = row;
		expect(itemsFromRows([old]).shots[0]).toEqual(shot('bd-1', { source: 'breakdown' }));
	});

	it('reads a breakdown row linked later with its Flow PT row', () => {
		const [row] = itemsToRows([shot('bd-1', { source: 'breakdown' })], []);
		const back = itemsFromRows([{ ...row, fpt_type: 'Shot', fpt_id: 77 }]);
		expect(back.shots[0]).toEqual(shot('bd-1', { source: 'breakdown', fpt: { type: 'Shot', id: 77 } }));
	});
});

describe('request', () => {
	it('builds the model from its rows, with the vendors it is given', () => {
		const vendor: InvitedVendor = { id: 'inv-a', name: 'Vendor A', email: 'a@example.com', ndaExecuted: false };
		const request = requestFromRows(requestRow(), itemRows(), [vendor]);
		expect(request.id).toBe('req-uuid');
		expect(request.header).toEqual({ ...header, projectRef: { type: 'Project', id: 70 } });
		expect(request.shots).toHaveLength(2);
		expect(request.assets).toHaveLength(1);
		expect(request.vendors).toEqual([vendor]);
	});
});

describe('vendor', () => {
	it('round-trips through the invitation columns', () => {
		const vendor = { name: 'Vendor A', fpt: { type: 'Group', id: 12 }, email: 'a@example.com', ndaExecuted: true, tpn: 'Gold', capacity: '40 shots' };
		const columns = vendorToColumns(vendor);
		expect(columns).toEqual({
			vendor_name: 'Vendor A',
			vendor_group_id: 12,
			contact_email: 'a@example.com',
			details: { ndaExecuted: true, tpn: 'Gold', capacity: '40 shots' },
			package_keys: null
		});
		const row: InvitationRow = {
			id: 'inv-a',
			request_id: 'req-uuid',
			...tenant,
			...columns,
			token_hash: 'f'.repeat(64),
			expires_at: '2027-01-01T00:00:00Z',
			revoked_at: null,
			last_opened_at: null,
			created_at: '2026-11-20T10:00:00Z'
		};
		expect(vendorFromRow(row)).toEqual({ id: 'inv-a', ...vendor });
	});

	it('refuses a Flow PT entity that is not a Group', () => {
		expect(() => vendorToColumns({ name: 'V', fpt: { type: 'HumanUser', id: 1 }, email: 'a@example.com', ndaExecuted: false })).toThrow();
	});
});

describe('bid', () => {
	const eur = bid({
		currency: 'EUR',
		rate: rate('EUR', 'USD', '1.0842', '2026-11-20'),
		number: 'Q-7',
		validUntil: '2027-01-31',
		assumptions: ['plates by week 2'],
		lines: [
			line('ignored-1', onShot('sh010'), money(1_000_000, 'EUR'), {
				departments: [{ department: 'comp', days: '4.5', cost: money(900_000, 'EUR') }],
				compute: money(100_000, 'EUR'),
				notes: 'two layers',
				assumptions: 'clean plate given'
			}),
			line('ignored-2', onAsset('hero'), money(0, 'EUR'), { excluded: true })
		],
		costs: [{ kind: 'supervision', label: 'VFX sup', amount: money(200_000, 'EUR'), labour: true }],
		discount: { kind: 'percent', percent: '5' },
		tax: null,
		rebate: [{ jurisdiction: 'FR', workPercent: '100', rate: '30', base: { kind: 'all' } }]
	});

	function rows(): { row: BidRow; lines: BidLineRow[] } {
		const written = bidToRows(eur, 'USD');
		const row: BidRow = {
			id: 'bid-uuid',
			invitation_id: 'inv-a',
			request_id: 'req-uuid',
			...tenant,
			version: 1,
			status: 'submitted',
			submitted_at: '2026-11-21T10:00:00Z',
			withdrawn_at: null,
			created_at: '2026-11-21T09:00:00Z',
			updated_at: '2026-11-21T10:00:00Z',
			...written.bid
		};
		const lines = written.lines.map((l, index) => ({
			id: `line-${index}`,
			bid_id: 'bid-uuid',
			invitation_id: 'inv-a',
			request_id: 'req-uuid',
			...tenant,
			...l
		}));
		return { row, lines };
	}

	it('keeps the currency and the rate as columns, the rate as its exact string', () => {
		const { bid: columns } = bidToRows(eur, 'USD');
		expect(columns.currency).toBe('EUR');
		expect(columns.exchange_rate).toBe('1.0842');
		expect(columns.exchange_rate_date).toBe('2026-11-20');
	});

	it('writes each line as minor units on its target, detail in the jsonb', () => {
		const { lines } = bidToRows(eur, 'USD');
		expect(lines[0]).toEqual({
			item_kind: 'shot',
			item_key: 'sh010',
			total_minor: 1_000_000,
			excluded: false,
			detail: { departments: [{ department: 'comp', days: '4.5', cost: money(900_000, 'EUR') }], compute: money(100_000, 'EUR'), notes: 'two layers', assumptions: 'clean plate given' },
			in_package: false
		});
		expect(lines[1]).toMatchObject({ item_kind: 'asset', item_key: 'hero', total_minor: 0, excluded: true });
	});

	it('round-trips to the model, the vendor being the invitation', () => {
		const { row, lines } = rows();
		const back = bidFromRows(row, lines, { round: 1, baseCurrency: 'USD' });
		expect(back).toEqual({
			...eur,
			id: 'bid-uuid',
			requestId: 'req-uuid',
			vendorId: 'inv-a',
			lines: eur.lines.map((l, index) => ({ ...l, id: `line-${index}` }))
		});
	});

	it('reads no rate for a bid in the base currency', () => {
		const usd = bid({ currency: 'USD', lines: [line('l', onShot('sh010'), money(5, 'USD'))] });
		const written = bidToRows(usd, 'USD');
		expect(written.bid.exchange_rate).toBeNull();
		expect(written.bid.exchange_rate_date).toBeNull();
	});

	it('refuses a line in another currency, or a rate that is not bid to base', () => {
		expect(() => bidToRows(bid({ currency: 'EUR', rate: rate('EUR', 'USD', '1', '2026-11-20'), lines: [line('l', onShot('a'), money(1, 'USD'))] }), 'USD')).toThrow();
		expect(() => bidToRows(bid({ currency: 'EUR', rate: rate('GBP', 'USD', '1', '2026-11-20') }), 'USD')).toThrow();
		expect(() => bidToRows(bid({ currency: 'EUR', rate: null }), 'USD')).toThrow();
	});

	it('refuses two lines on one target', () => {
		const twice = bid({ currency: 'USD', lines: [line('a', onShot('sh010'), money(1, 'USD')), line('b', onShot('sh010'), money(2, 'USD'))] });
		expect(() => bidToRows(twice, 'USD')).toThrow();
	});
});

describe('a counted line', () => {
	it('keeps its unit price in the detail and reads it back', () => {
		const draft = bid({ currency: 'USD', lines: [line('l1', onShot('bd-1'), money(18_000_000, 'USD'), { unit: money(150_000, 'USD'), fromRate: true })] });
		const { bid: columns, lines } = bidToRows(draft, 'USD');
		expect(lines[0]).toMatchObject({ total_minor: 18_000_000, detail: { unit: { minor: 150_000, currency: 'USD' }, fromRate: true } });
		const row = { ...tenant, id: 'b', invitation_id: 'v1', request_id: 'req1', version: 1, status: 'submitted', submitted_at: null, withdrawn_at: null, created_at: '', updated_at: '', ...columns } as BidRow;
		const back = bidFromRows(row, [{ ...tenant, id: 'l1', bid_id: 'b', invitation_id: 'v1', request_id: 'req1', ...lines[0] }], { round: 1, baseCurrency: 'USD' });
		expect(back.lines[0].unit).toEqual(money(150_000, 'USD'));
		expect(back.lines[0].total).toEqual(money(18_000_000, 'USD'));
	});

	it('refuses a unit price in another currency', () => {
		const draft = bid({ currency: 'USD', lines: [line('l1', onShot('bd-1'), money(200, 'USD'), { unit: money(100, 'EUR') })] });
		expect(() => bidToRows(draft, 'USD')).toThrow('unit price');
	});
});

describe('scenario', () => {
	const scenario: AwardScenario = {
		id: 'sc-1',
		requestId: 'req-uuid',
		name: 'Split comp',
		picks: [
			{ target: onShot('sh010'), shares: [{ bidId: 'bid-a', percent: '60' }, { bidId: 'bid-b', percent: '40' }] },
			{ target: onAsset('hero'), shares: [{ bidId: 'bid-a', percent: '100' }] }
		]
	};

	it('writes one item row per share, in order', () => {
		expect(scenarioToRows(scenario.picks)).toEqual([
			{ item_kind: 'shot', item_key: 'sh010', bid_id: 'bid-a', share_percent: '60', position: 0 },
			{ item_kind: 'shot', item_key: 'sh010', bid_id: 'bid-b', share_percent: '40', position: 1 },
			{ item_kind: 'asset', item_key: 'hero', bid_id: 'bid-a', share_percent: '100', position: 2 }
		]);
	});

	it('round-trips to the model', () => {
		const items = scenarioToRows(scenario.picks)
			.map((item, index) => ({ id: `si-${index}`, scenario_id: 'sc-1', request_id: 'req-uuid', ...tenant, ...item }))
			.reverse();
		const row = { id: 'sc-1', request_id: 'req-uuid', ...tenant, name: 'Split comp', created_at: '', updated_at: '' };
		expect(scenarioFromRows(row, items)).toEqual(scenario);
	});

	it('refuses a share that is not a percent', () => {
		expect(() => scenarioToRows([{ target: onShot('a'), shares: [{ bidId: 'b', percent: '-5' }] }])).toThrow();
	});
});

describe('packages in the rows', () => {
	it('writes each row package in its own column and reads it back', () => {
		const rows = itemsToRows([{ id: 'a', code: 'A', omitted: false, assetIds: [], package: 'p1' }], [{ id: 'x', name: 'X', package: 'p2' }]);
		expect(rows.map((r) => [r.key, r.package_key, 'package' in r.fields])).toEqual([
			['a', 'p1', false],
			['x', 'p2', false]
		]);
		const back = itemsFromRows(rows);
		expect(back.shots[0].package).toBe('p1');
		expect(back.assets[0].package).toBe('p2');
		expect(itemsFromRows(itemsToRows([{ id: 'b', code: 'B', omitted: false, assetIds: [] }], [])).shots[0]).not.toHaveProperty('package');
	});

	it('writes the packages in order and refuses two with one id or one name', () => {
		expect(packagesToRows([{ id: 'p1', name: ' Creature ' }, { id: 'p2', name: 'Comp' }])).toEqual([
			{ key: 'p1', name: 'Creature' },
			{ key: 'p2', name: 'Comp' }
		]);
		expect(() => packagesToRows([{ id: 'p1', name: 'A' }, { id: 'p1', name: 'B' }])).toThrow(/Two packages have the id/);
		expect(() => packagesToRows([{ id: 'p1', name: 'A' }, { id: 'p2', name: 'a' }])).toThrow(/Two packages are named/);
		expect(packagesFromRows([{ key: 'p2', name: 'B', position: 1 }, { key: 'p1', name: 'A', position: 0 }])).toEqual([
			{ id: 'p1', name: 'A' },
			{ id: 'p2', name: 'B' }
		]);
	});

	it('round-trips an invitation to some packages', () => {
		const columns = vendorToColumns({ name: 'V', email: 'v@example.com', ndaExecuted: false, packages: ['p1'] });
		expect(columns.package_keys).toEqual(['p1']);
		expect(vendorFromRow({ id: 'i', ...columns }).packages).toEqual(['p1']);
		expect(vendorFromRow({ id: 'i', ...columns, package_keys: null })).not.toHaveProperty('packages');
	});

	it('round-trips a bid with a package priced as one figure', () => {
		const draft = {
			number: '1',
			date: '2026-11-25',
			currency: 'USD',
			rate: null,
			assumptions: [],
			exclusions: [],
			milestones: [],
			lines: [{ target: { kind: 'shot' as const, id: 'a' }, total: money(0, 'USD'), excluded: false, inPackage: true }],
			costs: [],
			discount: null,
			tax: null,
			rebate: [],
			packages: [{ package: 'p1', total: money(5000, 'USD'), notes: 'all in' }],
			declined: ['p2']
		};
		const rows = bidToRows(draft, 'USD');
		expect(rows.bid.packages).toEqual([{ package: 'p1', total: money(5000, 'USD'), notes: 'all in' }]);
		expect(rows.lines[0].in_package).toBe(true);
		const back = bidFromRows(
			{ ...rows.bid, id: 'b', invitation_id: 'i', request_id: 'r', site_host: 'h', project_id: 1, version: 1, status: 'draft', submitted_at: null, withdrawn_at: null, created_at: '', updated_at: '' },
			rows.lines.map((l, i) => ({ ...l, id: `l${i}`, bid_id: 'b', invitation_id: 'i', request_id: 'r', site_host: 'h', project_id: 1 })),
			{ round: 1, baseCurrency: 'USD' }
		);
		expect(back.packages).toEqual(draft.packages);
		expect(back.declined).toEqual(['p2']);
		expect(back.lines[0].inPackage).toBe(true);
	});
});
