import { describe, expect, it } from 'vitest';
import { compareBids } from './compare';
import { asset, bid, line, onAsset, onShot, request, shot } from './fixtures';
import { money, rate } from './money';
import {
	againstLowest,
	awardAll,
	awardLowest,
	awardRows,
	clearRow,
	differingRows,
	pickCell,
	picksFromList,
	picksToList,
	rowShares,
	setShares,
	summarize,
	type Picks
} from './scenario';

const usd = (minor: number) => money(minor, 'USD');
const gbp = (minor: number) => money(minor, 'GBP');

const req = request({
	shots: [shot('s1', { sequence: 'A' }), shot('s2', { sequence: 'A' }), shot('s3', { sequence: 'B' }), shot('s4', { omitted: true })],
	assets: [asset('hero')]
});

/** USD: s1 100.00, s2 excluded, s3 300.00, hero 50.00. Costs 20.00. */
const one = bid({
	id: 'one',
	vendorId: 'v1',
	currency: 'USD',
	lines: [line('1a', onShot('s1'), usd(10_000)), line('1b', onShot('s2'), usd(0), { excluded: true }), line('1c', onShot('s3'), usd(30_000)), line('1h', onAsset('hero'), usd(5_000))],
	costs: [{ kind: 'overhead', label: 'Overhead', amount: usd(2_000), labour: false }]
});

/** GBP at 1.5: s1 60.00 (90.00), s2 100.00 (150.00), s3 220.00 (330.00), s4 10.00. Costs 10.00 (15.00). */
const two = bid({
	id: 'two',
	vendorId: 'v2',
	currency: 'GBP',
	rate: rate('GBP', 'USD', '1.5', '2026-11-20'),
	lines: [line('2a', onShot('s1'), gbp(6_000)), line('2b', onShot('s2'), gbp(10_000)), line('2c', onShot('s3'), gbp(22_000)), line('2d', onShot('s4'), gbp(1_000))],
	costs: [{ kind: 'supervision', label: 'Supervisor', amount: gbp(1_000), labour: true }]
});

const grid = compareBids(req, [one, two]);
const row = (id: string) => grid.rows.find((r) => r.target.id === id)!;
const list = (picks: Picks) => Object.fromEntries([...picks].map(([k, v]) => [k, v.map((s) => `${s.bidId}:${s.percent}`).join(' ')]));

describe('pickCell', () => {
	it('picks the vendor at 100%, and a second click takes it off', () => {
		const a = pickCell(grid, new Map(), row('s1'), 1);
		expect(list(a)).toEqual({ 'shot:s1': 'two:100' });
		const b = pickCell(grid, a, row('s1'), 0);
		expect(list(b)).toEqual({ 'shot:s1': 'one:100' });
		expect(list(pickCell(grid, b, row('s1'), 0))).toEqual({});
	});

	it('ignores an excluded cell, a missing one and an omitted shot', () => {
		const none = new Map();
		expect(pickCell(grid, none, row('s2'), 0)).toBe(none);
		expect(pickCell(grid, none, row('hero'), 1)).toBe(none);
		expect(pickCell(grid, none, row('s4'), 1)).toBe(none);
	});

	it('replaces a split with a whole pick', () => {
		const split = new Map([['shot:s1', [{ bidId: 'one', percent: '50' }, { bidId: 'two', percent: '50' }]]]);
		expect(list(pickCell(grid, split, row('s1'), 0))).toEqual({ 'shot:s1': 'one:100' });
	});
});

describe('setShares', () => {
	it('splits a row by percent', () => {
		const result = setShares(grid, new Map(), row('s1'), [
			{ bidId: 'one', percent: '60' },
			{ bidId: 'two', percent: '40' }
		]);
		expect(result.ok && list(result.picks)).toEqual({ 'shot:s1': 'one:60 two:40' });
	});

	it('drops zero shares and clears the row when nothing is left', () => {
		const r1 = setShares(grid, new Map(), row('s1'), [
			{ bidId: 'one', percent: '100' },
			{ bidId: 'two', percent: '0' }
		]);
		expect(r1.ok && list(r1.picks)).toEqual({ 'shot:s1': 'one:100' });
		const r2 = setShares(grid, new Map([['shot:s1', [{ bidId: 'one', percent: '100' }]]]), row('s1'), [{ bidId: 'one', percent: '0' }]);
		expect(r2.ok && list(r2.picks)).toEqual({});
	});

	it('refuses shares off 100, a vendor that did not price the row, a bad percent', () => {
		expect(setShares(grid, new Map(), row('s1'), [{ bidId: 'one', percent: '60' }])).toEqual({ ok: false, message: 'The shares sum to 60%. They must sum to 100%.' });
		expect(setShares(grid, new Map(), row('s2'), [{ bidId: 'one', percent: '100' }]).ok).toBe(false);
		expect(setShares(grid, new Map(), row('s1'), [{ bidId: 'one', percent: 'half' }]).ok).toBe(false);
		expect(setShares(grid, new Map(), row('s4'), [{ bidId: 'two', percent: '100' }]).ok).toBe(false);
	});
});

describe('bulk picks', () => {
	it('gives everything to one vendor, skipping what it did not price', () => {
		const { picks, skipped } = awardAll(grid, new Map(), 0);
		expect(list(picks)).toEqual({ 'shot:s1': 'one:100', 'shot:s3': 'one:100', 'asset:hero': 'one:100' });
		// s2 excluded; s4 omitted is not counted.
		expect(skipped).toBe(1);
	});

	it('replaces the picks it covers', () => {
		const before = new Map([['shot:s2', [{ bidId: 'two', percent: '100' }]]]);
		expect(list(awardAll(grid, before, 0).picks)).not.toHaveProperty('shot:s2');
	});

	it('gives each row to its lowest price', () => {
		const { picks, skipped } = awardLowest(grid, new Map());
		expect(list(picks)).toEqual({ 'shot:s1': 'two:100', 'shot:s2': 'two:100', 'shot:s3': 'one:100', 'asset:hero': 'one:100' });
		expect(skipped).toBe(0);
	});

	it('skips a row whose lowest is not known yet', () => {
		const noRate = compareBids(req, [one, { ...two, rate: null }]);
		const { picks, skipped } = awardLowest(noRate, new Map());
		expect(list(picks)).not.toHaveProperty('shot:s2');
		expect(skipped).toBe(1);
	});

	it('gives a sequence to a vendor and leaves the rest alone', () => {
		const start = new Map([['asset:hero', [{ bidId: 'one', percent: '100' }]]]);
		const { picks } = awardRows(grid, start, [row('s1'), row('s2')], 1);
		expect(list(picks)).toEqual({ 'asset:hero': 'one:100', 'shot:s1': 'two:100', 'shot:s2': 'two:100' });
	});

	it('clears a row', () => {
		expect(list(clearRow(new Map([['shot:s1', [{ bidId: 'one', percent: '100' }]]]), row('s1')))).toEqual({});
	});
});

describe('summarize', () => {
	it('totals the picked lines and each vendor non-shot costs', () => {
		const picks = awardLowest(grid, new Map()).picks;
		const s = summarize(grid, picks);
		// Lines: s1 90.00 + s2 150.00 (two), s3 300.00 + hero 50.00 (one).
		expect(s.lines).toEqual(usd(59_000));
		// Costs: one 20.00, two 15.00.
		expect(s.costs).toEqual(usd(3_500));
		expect(s.total).toEqual(usd(62_500));
		expect(s.vendors.map((v) => [v.bidId, v.rows, v.lines?.minor, v.total?.minor, v.shareBp])).toEqual([
			['one', 2, 35_000, 37_000, 5920],
			['two', 2, 24_000, 25_500, 4080]
		]);
		expect(s.awarded).toBe(4);
		expect(s.live).toBe(4);
		expect(s.unawarded).toEqual([]);
	});

	it('leaves a vendor non-shot costs out when asked', () => {
		const s = summarize(grid, awardLowest(grid, new Map()).picks, new Set(['one']));
		expect(s.costs).toEqual(usd(1_500));
		expect(s.vendors[0].costsIncluded).toBe(false);
		expect(s.vendors[0].total).toEqual(usd(35_000));
	});

	it('counts a split row for each vendor, at its share', () => {
		const result = setShares(grid, new Map(), row('s1'), [
			{ bidId: 'one', percent: '50' },
			{ bidId: 'two', percent: '50' }
		]);
		if (!result.ok) throw new Error(result.message);
		const s = summarize(grid, result.picks);
		// Half of 100.00 and half of 90.00.
		expect(s.lines).toEqual(usd(9_500));
		expect(s.vendors.map((v) => [v.rows, v.splitRows])).toEqual([
			[1, 1],
			[1, 1]
		]);
	});

	it('lists unawarded rows, and invalid picks among them', () => {
		const picks = new Map([
			['shot:s1', [{ bidId: 'one', percent: '100' }]],
			['shot:s2', [{ bidId: 'one', percent: '100' }]],
			['shot:s3', [{ bidId: 'old-version', percent: '100' }]]
		]);
		const s = summarize(grid, picks);
		expect(s.unawarded.map((t) => t.id)).toEqual(['s2', 's3', 'hero']);
		expect(s.invalid.map((t) => t.id)).toEqual(['s2', 's3']);
		expect(s.awarded).toBe(1);
	});

	it('is unknown, never zero, while a picked bid needs a rate', () => {
		const noRate = compareBids(req, [one, { ...two, rate: null }]);
		const s = summarize(noRate, new Map([['shot:s1', [{ bidId: 'two', percent: '100' }]]]));
		expect(s.total).toBeNull();
		expect(s.vendors[0].lines).toBeNull();
		expect(s.vendors[0].shareBp).toBeNull();
		expect(s.needsRate).toEqual(['two']);
	});

	it('is zero for no picks', () => {
		const s = summarize(grid, new Map());
		expect(s.total).toEqual(usd(0));
		expect(s.vendors).toEqual([]);
		expect(s.unawarded).toHaveLength(4);
	});
});

describe('againstLowest', () => {
	it('gives the difference from the all lowest scenario', () => {
		const all = awardAll(grid, new Map(), 0).picks;
		const s = summarize(grid, all);
		// One: 450.00 lines + 20.00 costs = 470.00. Lowest: 625.00. s2 is unawarded here.
		const against = againstLowest(grid, s);
		expect(against.lowest.total).toEqual(usd(62_500));
		expect(against.difference).toEqual(usd(47_000 - 62_500));
	});
});

describe('the stored form and comparing two', () => {
	it('round trips the model picks in the grid order', () => {
		const picks = awardLowest(grid, new Map()).picks;
		const stored = picksToList(grid, picks);
		expect(stored.map((p) => p.target.id)).toEqual(['s1', 's2', 's3', 'hero']);
		expect(list(picksFromList(stored))).toEqual(list(picks));
	});

	it('counts the rows two scenarios pick differently', () => {
		const a = awardLowest(grid, new Map()).picks;
		const b = awardAll(grid, new Map(), 0).picks;
		// s1 and s2 differ; s3 and hero are the same.
		expect(differingRows(a, b)).toBe(2);
		expect(differingRows(a, a)).toBe(0);
	});

	it('gives a row shares by column', () => {
		const picks = new Map([['shot:s1', [{ bidId: 'two', percent: '30' }, { bidId: 'one', percent: '70' }]]]);
		expect([...rowShares(grid, picks, row('s1'))]).toEqual([
			[1, '30'],
			[0, '70']
		]);
	});
});
