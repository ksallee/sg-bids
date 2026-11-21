import { describe, expect, it } from 'vitest';
import { applyScenario, compareBids } from './compare';
import { bid, line, onAsset, onShot, request, shot } from './fixtures';
import { byPackage, byRow, inPounds, packed } from './fixtures/packages';
import type { AwardScenario, ScenarioPick } from './model';
import { money } from './money';

const usd = (minor: number) => money(minor, 'USD');
const gbp = (minor: number) => money(minor, 'GBP');

describe('compareBids with packages', () => {
	const grid = compareBids(packed, [byPackage, byRow, inPounds]);
	const row = (id: string) => grid.rows.find((r) => r.target.id === id)!;

	it('shows a row of a package priced as one figure as in the package price, never a price or a gap', () => {
		expect(row('a').cells[0]).toEqual({ kind: 'package', lineId: 'Aa', package: 'p1' });
		expect(row('a').cells[2]).toEqual({ kind: 'package', lineId: 'Ca', package: 'p1' });
		expect(row('a').package).toBe('p1');
	});

	it('marks a row lowest among the row prices only', () => {
		expect(row('a').lowest).toBe(30_000);
		expect(row('a').lowestColumns).toEqual([1]);
		expect(row('a').rangeBp).toBeNull();
	});

	it('compares a package as a unit: a figure against the sum of a vendor row prices', () => {
		const creature = grid.packages.find((p) => p.id === 'p1')!;
		expect(creature.name).toBe('Creature');
		expect(creature.targets).toEqual([onShot('a'), onShot('b')]);
		expect(creature.cells[0]).toEqual({ kind: 'package', amount: { bid: usd(100_000), base: usd(100_000) }, lowest: false, spreadBp: 3333 });
		expect(creature.cells[1]).toEqual({ kind: 'rows', amount: { bid: usd(90_000), base: usd(90_000) }, complete: true, priced: 2, excluded: 0, missing: 0, lowest: false, spreadBp: 2000 });
		expect(creature.cells[2]).toEqual({ kind: 'package', amount: { bid: gbp(60_000), base: usd(75_000) }, lowest: true, spreadBp: 0 });
		expect(creature.lowest).toBe(75_000);
		expect(creature.lowestColumns).toEqual([2]);
		expect(creature.rangeBp).toBe(3333);
	});

	it('marks no lowest on a vendor that priced part of a package row by row', () => {
		const comp = grid.packages.find((p) => p.id === 'p2')!;
		expect(comp.cells[2]).toEqual({ kind: 'rows', amount: { bid: gbp(40_000), base: usd(50_000) }, complete: false, priced: 1, excluded: 0, missing: 1, lowest: false, spreadBp: null });
		expect(comp.lowestColumns).toEqual([0, 1]);
	});

	it('counts the figure once in the vendor total, and its rebate', () => {
		expect(grid.totals[0].items).toEqual({ bid: usd(150_000), base: usd(150_000) });
		expect(grid.totals[0].rebate).toEqual({ bid: usd(15_000), base: usd(15_000) });
		expect(grid.totals[2].items).toEqual({ bid: gbp(100_000), base: usd(125_000) });
	});

	it('has no base figure for a package while the bid needs a rate', () => {
		const noRate = compareBids(packed, [{ ...inPounds, rate: null }]);
		expect(noRate.packages[0].cells[0]).toEqual({ kind: 'package', amount: { bid: gbp(60_000), base: null }, lowest: false, spreadBp: null });
		expect(noRate.packages[0].lowest).toBeNull();
	});

	it('refuses a bid whose package price does not hold together', () => {
		const broken = { ...byPackage, lines: byPackage.lines.filter((l) => l.id !== 'Ab') };
		expect(() => compareBids(packed, [broken])).toThrow(/Creature is priced as one figure. B has no line in it/);
	});

	it('reads a request from before packages as one package', () => {
		const old = compareBids(request({ shots: [shot('a'), shot('b')] }), [bid({ id: 'Z', currency: 'USD', lines: [line('z1', onShot('a'), usd(1)), line('z2', onShot('b'), usd(2))] })]);
		expect(old.packages.map((p) => [p.id, p.name])).toEqual([['all', 'All shots and assets']]);
		expect(old.packages[0].cells[0]).toMatchObject({ kind: 'rows', complete: true, amount: { base: usd(3) } });
	});
});

describe('applyScenario with packages', () => {
	const scenario = (picks: ScenarioPick[]): AwardScenario => ({ id: 's', requestId: packed.id, name: 'S', picks });
	const whole = (id: string, bidId: string): ScenarioPick => ({ target: onShot(id), shares: [{ bidId, percent: '100' }] });

	it('counts a package awarded whole to the vendor that priced it as one figure, once', () => {
		const result = applyScenario(packed, [byPackage, byRow], scenario([whole('a', 'A'), whole('b', 'A'), whole('c', 'B')]));
		expect(result.perVendor).toEqual([
			{ vendorId: 'vA', amount: usd(100_000) },
			{ vendorId: 'vB', amount: usd(25_000) }
		]);
		expect(result.total).toEqual(usd(125_000));
		expect(result.unpicked).toEqual([onAsset('x')]);
	});

	it('converts a figure in another currency once', () => {
		const result = applyScenario(packed, [inPounds], scenario([whole('a', 'C'), whole('b', 'C')]));
		expect(result.total).toEqual(usd(75_000));
	});

	it('refuses part of a package priced as one figure', () => {
		expect(() => applyScenario(packed, [byPackage, byRow], scenario([whole('a', 'A'), whole('b', 'B')]))).toThrow(
			'Bid A priced Creature as one figure. The scenario gives it part of it: it is awarded whole or not at all.'
		);
	});

	it('refuses a split of a row in a package priced as one figure', () => {
		const split: ScenarioPick = {
			target: onShot('a'),
			shares: [
				{ bidId: 'A', percent: '50' },
				{ bidId: 'B', percent: '50' }
			]
		};
		expect(() => applyScenario(packed, [byPackage, byRow], scenario([split, whole('b', 'A')]))).toThrow(/A is in Creature, which bid A priced as one figure. It cannot be split/);
	});

	it('splits a package priced row by row as today', () => {
		const other = bid({ ...byRow, id: 'B2', vendorId: 'vB2' });
		const split: ScenarioPick = {
			target: onShot('a'),
			shares: [
				{ bidId: 'B', percent: '50' },
				{ bidId: 'B2', percent: '50' }
			]
		};
		const result = applyScenario(packed, [byRow, other], scenario([split]));
		expect(result.total).toEqual(usd(30_000));
	});
});

describe('a package a vendor is not bidding on', () => {
	const declining = bid({
		id: 'D',
		vendorId: 'vD',
		currency: 'USD',
		lines: [line('Dc', onShot('c'), usd(10_000)), line('Dx', onAsset('x'), usd(10_000))],
		declined: ['p1']
	});
	const grid = compareBids(packed, [byRow, declining]);

	it('shows Not bidding on its rows and as a unit, never a zero or a gap', () => {
		expect(grid.rows.find((r) => r.target.id === 'a')!.cells[1]).toEqual({ kind: 'declined', package: 'p1' });
		expect(grid.packages.find((p) => p.id === 'p1')!.cells[1]).toEqual({ kind: 'declined' });
		expect(grid.packages.find((p) => p.id === 'p1')!.lowestColumns).toEqual([0]);
	});

	it('refuses a scenario that gives one of its rows to that vendor', () => {
		const picks: ScenarioPick[] = [{ target: onShot('a'), shares: [{ bidId: 'D', percent: '100' }] }];
		expect(() => applyScenario(packed, [byRow, declining], { id: 's', requestId: packed.id, name: 'S', picks })).toThrow(/Bid D is not bidding on Creature/);
	});

	it('refuses a bid that prices a row of a package it declined', () => {
		expect(() => compareBids(packed, [{ ...declining, lines: [...declining.lines, line('Da', onShot('a'), usd(1))] }])).toThrow(/not bidding on/);
	});
});

