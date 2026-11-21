import { describe, expect, it } from 'vitest';
import { compareBids } from './compare';
import { bid, line, onAsset, onShot } from './fixtures';
import { byPackage, byRow, inPounds, packed } from './fixtures/packages';
import { money } from './money';
import { awardAll, awardLowest, awardRows, clearRow, pickCell, setShares, summarize, wholePackages, type Picks } from './scenario';

const usd = (minor: number) => money(minor, 'USD');

const grid = compareBids(packed, [byPackage, byRow, inPounds]);
const row = (id: string) => grid.rows.find((r) => r.target.id === id)!;
const whole = (bidId: string) => [{ bidId, percent: '100' }];
const keys = (picks: Picks) => Object.fromEntries([...picks].map(([k, shares]) => [k, shares.map((s) => `${s.bidId}${s.percent === '100' ? '' : `@${s.percent}`}`).join('+')]));

describe('picking a package priced as one figure', () => {
	it('a click on a row in the package price gives the whole package to that vendor', () => {
		const picks = pickCell(grid, new Map(), row('a'), 0);
		expect(keys(picks)).toEqual({ 'shot:a': 'A', 'shot:b': 'A' });
		expect(wholePackages(grid, picks)).toEqual([{ bidId: 'A', package: 'p1' }]);
	});

	it('a second click takes the whole package off', () => {
		const once = pickCell(grid, new Map(), row('b'), 0);
		expect(keys(pickCell(grid, once, row('a'), 0))).toEqual({});
	});

	it('a row price picked in its place takes the rest of the package off that vendor', () => {
		const once = pickCell(grid, new Map(), row('a'), 0);
		expect(keys(pickCell(grid, once, row('a'), 1))).toEqual({ 'shot:a': 'B' });
	});

	it('clearing a row of a whole package clears the package', () => {
		const once = pickCell(grid, new Map(), row('a'), 0);
		expect(keys(clearRow(once, row('b'), grid))).toEqual({});
	});

	it('refuses a split with the vendor that priced it as one figure', () => {
		const result = setShares(grid, new Map(), row('a'), [
			{ bidId: 'A', percent: '50' },
			{ bidId: 'B', percent: '50' }
		]);
		expect(result).toEqual({ ok: false, message: 'Creature was priced as one figure by a vendor here. Give that vendor the whole bid, or none of it.' });
	});

	it('takes a single whole share as the whole package', () => {
		const result = setShares(grid, new Map(), row('a'), whole('C'));
		expect(result.ok && keys(result.picks)).toEqual({ 'shot:a': 'C', 'shot:b': 'C' });
	});

	it('a bulk pick over part of a package skips its rows for that vendor', () => {
		const result = awardRows(grid, new Map(), [row('a')], 0);
		expect(keys(result.picks)).toEqual({});
		expect(result.skipped).toBe(1);
	});

	it('everything to one vendor takes its packages whole', () => {
		const result = awardAll(grid, new Map(), 0);
		expect(keys(result.picks)).toEqual({ 'shot:a': 'A', 'shot:b': 'A', 'shot:c': 'A', 'asset:x': 'A' });
		expect(result.skipped).toBe(0);
	});
});

describe('the lowest with packages', () => {
	it('gives a package to its lowest figure when it beats the lowest row prices summed', () => {
		// Creature: C's 750.00 against B's rows, 900.00. Comp row by row: c to B 250.00, x to A 200.00.
		const result = awardLowest(grid, new Map());
		expect(keys(result.picks)).toEqual({ 'shot:a': 'C', 'shot:b': 'C', 'shot:c': 'B', 'asset:x': 'A' });
	});

	it('keeps rows apart when their lowest prices summed beat every figure', () => {
		const cheap = compareBids(packed, [byPackage, { ...byRow, lines: byRow.lines.map((l) => (l.target.id === 'b' ? { ...l, total: usd(10_000) } : l)) }]);
		const result = awardLowest(cheap, new Map());
		expect(keys(result.picks)).toEqual({ 'shot:a': 'B', 'shot:b': 'B', 'shot:c': 'B', 'asset:x': 'A' });
	});
});

describe('summarize with packages', () => {
	it('counts a whole package figure once for its vendor', () => {
		const picks = new Map([
			['shot:a', whole('A')],
			['shot:b', whole('A')],
			['shot:c', whole('B')]
		]);
		const summary = summarize(grid, picks, new Set(['A', 'B', 'C']));
		expect(summary.lines).toEqual(usd(125_000));
		expect(summary.vendors.map((v) => [v.bidId, v.rows, v.lines])).toEqual([
			['A', 2, usd(100_000)],
			['B', 1, usd(25_000)]
		]);
		expect(summary.awarded).toBe(3);
		expect(summary.unawarded).toEqual([onAsset('x')]);
		expect(summary.partial).toEqual([]);
	});

	it('lists a part of a package priced as one figure as not fitting, with why', () => {
		const picks = new Map([['shot:a', whole('A')]]);
		const summary = summarize(grid, picks);
		expect(summary.invalid).toEqual([onShot('a')]);
		expect(summary.partial).toEqual([{ bidId: 'A', package: 'p1', name: 'Creature' }]);
		expect(summary.awarded).toBe(0);
		expect(summary.lines).toEqual(usd(0));
	});

	it('converts a figure in another currency once', () => {
		const summary = summarize(
			grid,
			new Map([
				['shot:a', whole('C')],
				['shot:b', whole('C')]
			])
		);
		expect(summary.lines).toEqual(usd(75_000));
	});
});

describe('a package a vendor is not bidding on', () => {
	const declining = bid({ id: 'D', vendorId: 'vD', currency: 'USD', lines: [line('Dc', onShot('c'), usd(1_000)), line('Dx', onAsset('x'), usd(1_000))], declined: ['p1'] });
	const g = compareBids(packed, [byRow, declining]);
	const r = (id: string) => g.rows.find((x) => x.target.id === id)!;

	it('cannot be picked for that vendor, one row or in bulk', () => {
		expect(keys(pickCell(g, new Map(), r('a'), 1))).toEqual({});
		const all = awardAll(g, new Map(), 1);
		expect(keys(all.picks)).toEqual({ 'shot:c': 'D', 'asset:x': 'D' });
		expect(all.skipped).toBe(2);
		expect(setShares(g, new Map(), r('a'), whole('D')).ok).toBe(false);
	});

	it('goes to the lowest of the others', () => {
		expect(keys(awardLowest(g, new Map()).picks)).toEqual({ 'shot:a': 'B', 'shot:b': 'B', 'shot:c': 'D', 'asset:x': 'D' });
	});
});

