import { describe, expect, it } from 'vitest';
import { applyScenario, compareBids } from './compare';
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
			{ kind: 'price', lineId: 'a1', amount: { bid: usd(100_000), base: usd(100_000) }, lowest: false },
			{ kind: 'price', lineId: 'b1', amount: { bid: jpy(100_000), base: usd(66_000) }, lowest: true }
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
			{ kind: 'price', lineId: 'b2', amount: { bid: jpy(0), base: usd(0) }, lowest: true }
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

	it('gives each vendor its grand total gross and after rebate', () => {
		expect(grid.totals[0]).toEqual({
			bidId: 'bidA',
			vendorId: 'vA',
			gross: { bid: usd(150_000), base: usd(150_000) },
			afterRebate: { bid: usd(91_500), base: usd(91_500) },
			labourDetailMissing: false
		});
	});

	it('leaves the after-rebate total empty when a labour base lacks detail', () => {
		// 251,515 yen × 0.0066 = 1,659.999 dollars.
		expect(grid.totals[1]).toEqual({
			bidId: 'bidB',
			vendorId: 'vB',
			gross: { bid: jpy(251_515), base: usd(166_000) },
			afterRebate: null,
			labourDetailMissing: true
		});
	});

	it('is an empty grid for an empty request', () => {
		const empty = compareBids(request(), [bid({ id: 'e', currency: 'USD' })]);
		expect(empty.rows).toEqual([]);
		expect(empty.totals[0].gross).toEqual({ bid: usd(0), base: usd(0) });
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
