import { describe, expect, it } from 'vitest';
import { applyRate, applyScenario, compareBids, needsRate, shownVersions, spreadBp, type BidRecord } from './compare';
import { asset, bid, line, onAsset, onShot, request, shot } from './fixtures';
import type { AwardScenario, ScenarioPick } from './model';
import { money, rate } from './money';

const usd = (minor: number) => money(minor, 'USD');
const jpy = (minor: number) => money(minor, 'JPY');

const req = request({
	shots: [shot('sh010'), shot('sh020'), shot('sh030'), shot('sh040', { omitted: true })],
	assets: [asset('hero')]
});

/** Vendor A, in dollars: sh010 1,000.00, sh020 excluded, hero 500.00, no sh030. */
const bidA = bid({
	id: 'bidA',
	vendorId: 'vA',
	currency: 'USD',
	lines: [
		line('a1', onShot('sh010'), usd(100_000)),
		line('a2', onShot('sh020'), usd(70_000), { excluded: true }),
		line('a3', onAsset('hero'), usd(50_000))
	],
	rebate: [{ jurisdiction: 'GB', workPercent: '100', rate: '39', base: { kind: 'all' } }]
});

/** Vendor B, in yen at 0.0066: sh010 100,000 yen (660.00), sh020 at zero, sh030 at 151,515 yen, no hero. */
const bidB = bid({
	id: 'bidB',
	vendorId: 'vB',
	currency: 'JPY',
	rate: rate('JPY', 'USD', '0.0066', '2026-11-20'),
	lines: [
		line('b1', onShot('sh010'), jpy(100_000)),
		line('b2', onShot('sh020'), jpy(0)),
		line('b3', onShot('sh030'), jpy(151_515))
	],
	rebate: [{ jurisdiction: 'CA-BC', workPercent: '100', rate: '36', base: { kind: 'labour' } }]
});

describe('compareBids', () => {
	const grid = compareBids(req, [bidA, bidB]);
	const row = (key: string) => {
		const found = grid.rows.find((r) => `${r.target.kind}:${r.target.id}` === key);
		if (!found) throw new Error(key);
		return found;
	};

	it('has a column per bid and a row per shot, then per asset', () => {
		expect(grid.columns.map((c) => c.bidId)).toEqual(['bidA', 'bidB']);
		expect(grid.rows.map((r) => r.label)).toEqual(['SH010', 'SH020', 'SH030', 'SH040', 'hero']);
		expect(row('shot:sh040').omitted).toBe(true);
		expect(grid.baseCurrency).toBe('USD');
	});

	it('converts each price to the base currency and marks the lowest', () => {
		expect(row('shot:sh010').cells).toEqual([
			// 1,000.00 over 660.00 is 51.52% over.
			{ kind: 'price', lineId: 'a1', amount: { bid: usd(100_000), base: usd(100_000) }, lowest: false, spreadBp: 5152 },
			{ kind: 'price', lineId: 'b1', amount: { bid: jpy(100_000), base: usd(66_000) }, lowest: true, spreadBp: 0 }
		]);
	});

	it('rounds each converted price to the cent', () => {
		// 151,515 yen × 0.0066 = 999.999 dollars.
		const cell = row('shot:sh030').cells[1];
		expect(cell.kind === 'price' && cell.amount.base).toEqual(usd(100_000));
	});

	it('tells an excluded line, a missing line and a zero price apart', () => {
		expect(row('shot:sh020').cells).toEqual([
			{ kind: 'excluded', lineId: 'a2' },
			{ kind: 'price', lineId: 'b2', amount: { bid: jpy(0), base: usd(0) }, lowest: true, spreadBp: 0 }
		]);
		expect(row('shot:sh030').cells[0]).toEqual({ kind: 'missing' });
		expect(row('asset:hero').cells[1]).toEqual({ kind: 'missing' });
	});

	it('marks no cell lowest in a row nobody priced', () => {
		expect(row('shot:sh040').cells).toEqual([{ kind: 'missing' }, { kind: 'missing' }]);
	});

	it('marks every tied price lowest', () => {
		const tied = compareBids(request({ shots: [shot('sh010')] }), [
			bid({ id: 'x', currency: 'USD', lines: [line('x1', onShot('sh010'), usd(500))] }),
			bid({ id: 'y', currency: 'USD', lines: [line('y1', onShot('sh010'), usd(500))] })
		]);
		expect(tied.rows[0].cells.map((c) => c.kind === 'price' && c.lowest)).toEqual([true, true]);
	});

	it('gives each vendor its totals, gross and after rebate', () => {
		expect(grid.totals[0]).toEqual({
			bidId: 'bidA',
			vendorId: 'vA',
			items: { bid: usd(150_000), base: usd(150_000) },
			costs: { bid: usd(0), base: usd(0) },
			discount: { bid: usd(0), base: usd(0) },
			tax: { bid: usd(0), base: usd(0) },
			grand: { bid: usd(150_000), base: usd(150_000) },
			rebate: { bid: usd(58_500), base: usd(58_500) },
			afterRebate: { bid: usd(91_500), base: usd(91_500) },
			splits: 1,
			coveredPercent: '100',
			labourDetailMissing: false,
			linesWithoutDetail: 0
		});
	});

	it('leaves the rebate empty when a labour base lacks detail', () => {
		// 251,515 yen × 0.0066 = 1,659.999 dollars.
		const t = grid.totals[1];
		expect(t.grand).toEqual({ bid: jpy(251_515), base: usd(166_000) });
		expect(t.rebate).toBeNull();
		expect(t.afterRebate).toBeNull();
		expect(t.labourDetailMissing).toBe(true);
		expect(t.linesWithoutDetail).toBe(3);
	});

	it('is an empty grid for an empty request', () => {
		const empty = compareBids(request(), [bid({ id: 'e', currency: 'USD' })]);
		expect(empty.rows).toEqual([]);
		expect(empty.totals[0].grand).toEqual({ bid: usd(0), base: usd(0) });
	});

	it('is an empty grid with no bids', () => {
		const none = compareBids(req, []);
		expect(none.columns).toEqual([]);
		expect(none.rows.every((r) => r.cells.length === 0)).toBe(true);
	});

	it('refuses a line for a shot the request does not have', () => {
		const stray = bid({ currency: 'USD', lines: [line('s1', onShot('sh999'), usd(1))] });
		expect(() => compareBids(req, [stray])).toThrow(/sh999/);
	});

	it('refuses two lines for the same shot in one bid', () => {
		const twice = bid({ currency: 'USD', lines: [line('t1', onShot('sh010'), usd(1)), line('t2', onShot('sh010'), usd(2))] });
		expect(() => compareBids(req, [twice])).toThrow();
	});

	it('refuses a bid for another request', () => {
		expect(() => compareBids(req, [bid({ currency: 'USD', requestId: 'other' })])).toThrow();
	});
});

describe('applyScenario', () => {
	const scenario = (picks: ScenarioPick[]): AwardScenario => ({ id: 's1', requestId: 'req1', name: 'Split', picks });
	const pick = (target: ScenarioPick['target'], ...shares: [string, string][]): ScenarioPick => ({
		target,
		shares: shares.map(([bidId, percent]) => ({ bidId, percent }))
	});

	it('totals a scenario in the base currency, with each vendor share', () => {
		const result = applyScenario(req, [bidA, bidB], scenario([pick(onShot('sh010'), ['bidB', '100']), pick(onAsset('hero'), ['bidA', '100'])]));
		expect(result.total).toEqual(usd(116_000));
		expect(result.perVendor).toEqual([
			{ vendorId: 'vA', amount: usd(50_000) },
			{ vendorId: 'vB', amount: usd(66_000) }
		]);
	});

	it('splits a shot between two vendors by share', () => {
		// sh010 half at 1,000.00 and half at 660.00.
		const result = applyScenario(req, [bidA, bidB], scenario([pick(onShot('sh010'), ['bidA', '50'], ['bidB', '50'])]));
		expect(result.total).toEqual(usd(83_000));
		expect(result.perVendor).toEqual([
			{ vendorId: 'vA', amount: usd(50_000) },
			{ vendorId: 'vB', amount: usd(33_000) }
		]);
	});

	it('rounds each share half away from zero in the base currency', () => {
		// 1/3 of 1,000.00 is 333.333…; 2/3 of 660.00 is 440.00 at 66.6667%: 440.00022.
		const result = applyScenario(req, [bidA, bidB], scenario([pick(onShot('sh010'), ['bidA', '33.3333'], ['bidB', '66.6667'])]));
		expect(result.perVendor).toEqual([
			{ vendorId: 'vA', amount: usd(33_333) },
			{ vendorId: 'vB', amount: usd(44_000) }
		]);
	});

	it('lists the live shots and assets nobody was picked for', () => {
		const result = applyScenario(req, [bidA, bidB], scenario([pick(onShot('sh010'), ['bidB', '100'])]));
		expect(result.unpicked).toEqual([onShot('sh020'), onShot('sh030'), onAsset('hero')]);
	});

	it('is zero for an empty scenario on an empty request', () => {
		const result = applyScenario(request(), [], scenario([]));
		expect(result).toEqual({ total: usd(0), perVendor: [], unpicked: [] });
	});

	it('refuses shares that do not sum to 100', () => {
		expect(() => applyScenario(req, [bidA, bidB], scenario([pick(onShot('sh010'), ['bidA', '50'], ['bidB', '40'])]))).toThrow();
	});

	it('refuses a pick of an excluded or missing line', () => {
		expect(() => applyScenario(req, [bidA, bidB], scenario([pick(onShot('sh020'), ['bidA', '100'])]))).toThrow(/excluded/);
		expect(() => applyScenario(req, [bidA, bidB], scenario([pick(onShot('sh030'), ['bidA', '100'])]))).toThrow(/no line/);
	});

	it('refuses an unknown bid, an unknown shot, or two picks for one shot', () => {
		expect(() => applyScenario(req, [bidA], scenario([pick(onShot('sh010'), ['bidZ', '100'])]))).toThrow();
		expect(() => applyScenario(req, [bidA], scenario([pick(onShot('sh999'), ['bidA', '100'])]))).toThrow();
		expect(() =>
			applyScenario(req, [bidA], scenario([pick(onShot('sh010'), ['bidA', '100']), pick(onShot('sh010'), ['bidA', '100'])]))
		).toThrow();
	});

	it('refuses a scenario for another request', () => {
		expect(() => applyScenario(req, [bidA], { id: 's', requestId: 'other', name: 'x', picks: [] })).toThrow();
	});
});

describe('compareBids, rows', () => {
	const grid = compareBids(req, [bidA, bidB]);

	it('keeps the request order, the lowest columns and the range', () => {
		expect(grid.rows.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
		const sh010 = grid.rows[0];
		expect(sh010.lowest).toBe(66_000);
		expect(sh010.lowestColumns).toEqual([1]);
		expect(sh010.rangeBp).toBe(5152);
		// One known price: no range.
		expect(grid.rows[2].rangeBp).toBeNull();
		expect(grid.rows[3].lowest).toBeNull();
	});

	it('carries the sequence, the episode and the description', () => {
		const seq = compareBids(request({ shots: [shot('sh010', { sequence: 'SEQ1', episode: 'EP1', description: 'Truck' })] }), []);
		expect(seq.rows[0]).toMatchObject({ sequence: 'SEQ1', episode: 'EP1', description: 'Truck' });
	});

	it('describes each column with its currency and rate', () => {
		expect(grid.columns[0]).toEqual({ bidId: 'bidA', vendorId: 'vA', currency: 'USD', rate: null, needsRate: false });
		expect(grid.columns[1].needsRate).toBe(false);
		expect(grid.columns[1].rate?.rate).toBe('0.0066');
	});
});

describe('compareBids, a bid with no rate yet', () => {
	const noRate = { ...bidB, rate: null };
	const grid = compareBids(req, [bidA, noRate]);

	it('shows its prices in its own currency, with no base figure', () => {
		expect(grid.columns[1].needsRate).toBe(true);
		expect(grid.rows[0].cells[1]).toEqual({ kind: 'price', lineId: 'b1', amount: { bid: jpy(100_000), base: null }, lowest: false, spreadBp: null });
		expect(grid.rows[0].unconverted).toBe(1);
	});

	it('marks the lowest among the known prices only', () => {
		expect(grid.rows[0].lowestColumns).toEqual([0]);
		expect(grid.rows[0].rangeBp).toBeNull();
	});

	it('keeps its totals in its currency and none in the base', () => {
		const t = grid.totals[1];
		expect(t.grand).toEqual({ bid: jpy(251_515), base: null });
		expect(t.items.base).toBeNull();
		expect(t.rebate).toBeNull();
	});
});

describe('applyRate', () => {
	it('sets production rate on a bid in another currency', () => {
		const r = rate('JPY', 'USD', '0.0067', '2026-11-21');
		expect(applyRate({ ...bidB, rate: null }, 'USD', r).rate).toEqual(r);
	});
	it('drops any rate on a bid in the base currency', () => {
		expect(applyRate(bidA, 'USD', null).rate).toBeNull();
	});
	it('refuses a rate for another pair', () => {
		expect(() => applyRate(bidB, 'USD', rate('GBP', 'USD', '1.2', '2026-11-21'))).toThrow(/JPY to USD/);
	});
	it('tells a bid that needs a rate', () => {
		expect(needsRate({ ...bidB, rate: null }, 'USD')).toBe(true);
		expect(needsRate(bidA, 'USD')).toBe(false);
	});
});

describe('spreadBp', () => {
	it('is basis points over the lowest, rounded half away from zero', () => {
		expect(spreadBp(100, 100)).toBe(0);
		expect(spreadBp(115, 100)).toBe(1500);
		// 1/3 over: 3333.33…
		expect(spreadBp(4, 3)).toBe(3333);
		// 0.005% rounds up.
		expect(spreadBp(20_001, 20_000)).toBe(1);
	});
	it('is infinite over a zero', () => {
		expect(spreadBp(5, 0)).toBe(Number.POSITIVE_INFINITY);
		expect(spreadBp(0, 0)).toBe(0);
	});
});

describe('shownVersions', () => {
	const records: BidRecord[] = [
		{ bidId: 'a1', vendorId: 'A', version: 1, status: 'submitted' },
		{ bidId: 'a2', vendorId: 'A', version: 2, status: 'submitted' },
		{ bidId: 'b1', vendorId: 'B', version: 1, status: 'submitted' },
		{ bidId: 'b2', vendorId: 'B', version: 2, status: 'withdrawn' },
		{ bidId: 'c1', vendorId: 'C', version: 1, status: 'withdrawn' }
	];
	it('shows the latest submitted version per vendor', () => {
		expect(shownVersions(records)).toEqual(['a2', 'b1']);
	});
	it('shows an earlier or a withdrawn version when asked', () => {
		expect(shownVersions(records, ['a1', 'c1'])).toEqual(['a1', 'b1', 'c1']);
	});
	it('ignores an unknown id', () => {
		expect(shownVersions(records, ['zz'])).toEqual(['a2', 'b1']);
	});
});
