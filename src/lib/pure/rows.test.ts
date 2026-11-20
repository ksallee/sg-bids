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
			details: { ndaExecuted: true, tpn: 'Gold', capacity: '40 shots' }
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
				notes: 'two layers'
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
			detail: { departments: [{ department: 'comp', days: '4.5', cost: money(900_000, 'EUR') }], compute: money(100_000, 'EUR'), notes: 'two layers' }
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
