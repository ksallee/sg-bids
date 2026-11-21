import { describe, expect, it } from 'vitest';
import { compareBids } from './compare';
import { asset, bid, line, onAsset, onShot, request, shot } from './fixtures';
import { groupRows, matchesFilter, offsetsOf, percentToBp, scrollToShow, sortRows, viewGrid, visibleRange, type ViewOptions } from './grid-view';
import { money, rate } from './money';
import { byPackage, byRow, packed } from './fixtures/packages';

const usd = (minor: number) => money(minor, 'USD');
const gbp = (minor: number) => money(minor, 'GBP');

const req = request({
	shots: [
		shot('a010', { sequence: 'SEQA', episode: 'EP1', description: 'Truck flips' }),
		shot('b010', { sequence: 'SEQB', episode: 'EP1' }),
		shot('a020', { sequence: 'SEQA', episode: 'EP2', description: 'Dust' }),
		shot('x010', { omitted: true }),
		shot('a030', { sequence: 'SEQA', episode: 'EP2' })
	],
	assets: [asset('hero')]
});

/** USD: a010 100, b010 300, a020 excluded, no a030, hero 50. */
const one = bid({
	id: 'one',
	vendorId: 'v1',
	currency: 'USD',
	lines: [
		line('1a', onShot('a010'), usd(10_000)),
		line('1b', onShot('b010'), usd(30_000)),
		line('1c', onShot('a020'), usd(0), { excluded: true }),
		line('1h', onAsset('hero'), usd(5_000))
	]
});

/** GBP at 1.25: a010 100 (125.00), b010 200 (250.00), a020 80 (100.00), a030 40 (50.00). */
const two = bid({
	id: 'two',
	vendorId: 'v2',
	currency: 'GBP',
	rate: rate('GBP', 'USD', '1.25', '2026-11-20'),
	lines: [
		line('2a', onShot('a010'), gbp(10_000)),
		line('2b', onShot('b010'), gbp(20_000)),
		line('2c', onShot('a020'), gbp(8_000)),
		line('2d', onShot('a030'), gbp(4_000))
	]
});

const grid = compareBids(req, [one, two]);
const codes = (rows: readonly { label: string }[]) => rows.map((r) => r.label);

describe('groupRows', () => {
	it('groups shots by sequence in first-seen order, unset shots then assets last', () => {
		const groups = groupRows(grid, 'sequence');
		expect(groups.map((g) => [g.key, g.label, codes(g.rows)])).toEqual([
			['seq:SEQA', 'SEQA', ['A010', 'A020', 'A030']],
			['seq:SEQB', 'SEQB', ['B010']],
			['unset:sequence', 'No sequence', ['X010']],
			['assets', 'Assets', ['hero']]
		]);
	});

	it('groups by episode', () => {
		expect(groupRows(grid, 'episode').map((g) => g.label)).toEqual(['EP1', 'EP2', 'No episode', 'Assets']);
	});

	it('keeps shots and assets apart with no grouping', () => {
		expect(groupRows(grid, 'none').map((g) => [g.label, g.rows.length])).toEqual([
			['Shots', 5],
			['Assets', 1]
		]);
	});

	it('subtotals each column in both currencies, counting what is excluded and missing', () => {
		const seqA = groupRows(grid, 'sequence')[0];
		expect(seqA.subtotals[0]).toEqual({ bid: usd(10_000), base: usd(10_000), priced: 1, excluded: 1, missing: 1, inPackage: 0, declined: 0 });
		expect(seqA.subtotals[1]).toEqual({ bid: gbp(22_000), base: usd(27_500), priced: 3, excluded: 0, missing: 0, inPackage: 0, declined: 0 });
	});

	it('has no base subtotal while a priced cell needs a rate', () => {
		const noRate = compareBids(req, [one, { ...two, rate: null }]);
		const seqA = groupRows(noRate, 'sequence')[0];
		expect(seqA.subtotals[1]).toEqual({ bid: gbp(22_000), base: null, priced: 3, excluded: 0, missing: 0, inPackage: 0, declined: 0 });
	});
});

describe('percentToBp', () => {
	it('reads a typed percent as basis points', () => {
		expect(percentToBp('15')).toBe(1500);
		expect(percentToBp('12.5')).toBe(1250);
		expect(percentToBp(' 0.01 ')).toBe(1);
		expect(percentToBp('12.345')).toBe(1235);
	});
	it('is null for anything else', () => {
		expect(percentToBp('abc')).toBeNull();
		expect(percentToBp('-3')).toBeNull();
		expect(percentToBp('')).toBeNull();
	});
});

describe('matchesFilter', () => {
	const row = (code: string) => grid.rows.find((r) => r.label === code)!;

	it('finds every word in the code or the description', () => {
		expect(matchesFilter(row('A010'), { text: 'truck a01' })).toBe(true);
		expect(matchesFilter(row('A010'), { text: 'dust' })).toBe(false);
	});

	it('keeps rows whose prices differ by more than a percent', () => {
		// A010: 100.00 against 125.00, 25% apart. B010: 300.00 against 250.00, 20%.
		expect(matchesFilter(row('A010'), { differsOver: '20' })).toBe(true);
		expect(matchesFilter(row('B010'), { differsOver: '20' })).toBe(false);
		// One known price is no difference.
		expect(matchesFilter(row('A030'), { differsOver: '0' })).toBe(false);
		// A filter that is not a percent filters nothing.
		expect(matchesFilter(row('A030'), { differsOver: 'x' })).toBe(true);
	});

	it('keeps rows with a gap, an exclusion, or a price needing a rate', () => {
		expect(matchesFilter(row('A030'), { only: 'missing' })).toBe(true);
		expect(matchesFilter(row('A010'), { only: 'missing' })).toBe(false);
		expect(matchesFilter(row('A020'), { only: 'excluded' })).toBe(true);
		expect(matchesFilter(row('A010'), { only: 'unconverted' })).toBe(false);
		const noRate = compareBids(req, [one, { ...two, rate: null }]);
		expect(matchesFilter(noRate.rows[0], { only: 'unconverted' })).toBe(true);
	});

	it('keeps only the rows named by key', () => {
		expect(matchesFilter(row('A010'), { keys: new Set(['shot:a010']) })).toBe(true);
		expect(matchesFilter(row('B010'), { keys: new Set(['shot:a010']) })).toBe(false);
		expect(matchesFilter(row('B010'), { keys: null })).toBe(true);
	});

	it('keeps rows where one vendor is lowest, and hides omitted ones', () => {
		expect(matchesFilter(row('A010'), { lowestColumn: 0 })).toBe(true);
		expect(matchesFilter(row('B010'), { lowestColumn: 0 })).toBe(false);
		expect(matchesFilter(row('X010'), { hideOmitted: true })).toBe(false);
	});
});

describe('sortRows', () => {
	it('keeps the request order by default and sorts codes naturally', () => {
		expect(codes(sortRows(grid.rows, 'order'))).toEqual(['A010', 'B010', 'A020', 'X010', 'A030', 'hero']);
		expect(codes(sortRows(grid.rows, 'code'))).toEqual(['A010', 'A020', 'A030', 'B010', 'hero', 'X010']);
	});

	it('sorts by spread, unknowns last either way', () => {
		expect(codes(sortRows(grid.rows, 'spread', 'desc'))).toEqual(['A010', 'B010', 'A020', 'X010', 'A030', 'hero']);
		expect(codes(sortRows(grid.rows, 'spread', 'asc'))).toEqual(['B010', 'A010', 'A020', 'X010', 'A030', 'hero']);
	});

	it('sorts by lowest price, ties in the request order', () => {
		expect(codes(sortRows(grid.rows, 'lowest'))).toEqual(['A030', 'hero', 'A010', 'A020', 'B010', 'X010']);
	});

	it('sorts by the lowest vendor, widest spread first inside it', () => {
		expect(codes(sortRows(grid.rows, 'lowestVendor'))).toEqual(['A010', 'hero', 'B010', 'A020', 'A030', 'X010']);
	});
});

describe('viewGrid', () => {
	const options: ViewOptions = { by: 'sequence', filter: {}, sort: 'order', dir: 'asc', collapsed: new Set() };

	it('lays out a header per group, then its rows', () => {
		const view = viewGrid(grid, options);
		expect(view.display.map((d) => (d.kind === 'group' ? `# ${d.group.label} ${d.shown}` : d.row.label))).toEqual([
			'# SEQA 3',
			'A010',
			'A020',
			'A030',
			'# SEQB 1',
			'B010',
			'# No sequence 1',
			'X010',
			'# Assets 1',
			'hero'
		]);
		expect(view.shown).toBe(6);
		expect(view.total).toBe(6);
	});

	it('folds a collapsed group to its header', () => {
		const view = viewGrid(grid, { ...options, collapsed: new Set(['seq:SEQA']) });
		expect(view.display.slice(0, 2).map((d) => d.kind)).toEqual(['group', 'group']);
		expect(view.display[0].kind === 'group' && view.display[0].collapsed).toBe(true);
		expect(view.shown).toBe(6);
	});

	it('drops a group the filter empties, and keeps its subtotal whole', () => {
		const view = viewGrid(grid, { ...options, filter: { only: 'missing' } });
		expect(view.display.map((d) => (d.kind === 'group' ? d.group.label : d.row.label))).toEqual(['SEQA', 'A030', 'No sequence', 'X010', 'Assets', 'hero']);
		const header = view.display[0];
		expect(header.kind === 'group' && header.group.subtotals[1].priced).toBe(3);
	});
});

describe('windowing', () => {
	const view = viewGrid(grid, { by: 'sequence', filter: {}, sort: 'order', dir: 'asc', collapsed: new Set() });
	// Headers 40, rows 48: # 0, row 40, row 88, row 136, # 184, row 224, # 272, row 312, # 360, row 400, end 448.
	const offsets = offsetsOf(view.display, { group: 40, row: 48 });

	it('gives each row its start and the total last', () => {
		expect(offsets).toEqual([0, 40, 88, 136, 184, 224, 272, 312, 360, 400, 448]);
	});

	it('finds the rows meeting the viewport, with overscan', () => {
		expect(visibleRange(offsets, 0, 100, 0)).toEqual({ from: 0, to: 2 });
		expect(visibleRange(offsets, 90, 100, 0)).toEqual({ from: 2, to: 4 });
		expect(visibleRange(offsets, 90, 100, 2)).toEqual({ from: 0, to: 6 });
		expect(visibleRange(offsets, 1000, 100, 0)).toEqual({ from: 9, to: 9 });
		expect(visibleRange([0], 0, 100)).toEqual({ from: 0, to: -1 });
	});

	it('scrolls just enough to show a row below a sticky header', () => {
		expect(scrollToShow(offsets, 1, 0, 200, 50)).toBeNull();
		expect(scrollToShow(offsets, 0, 100, 200)).toBe(0);
		// Row 5 ends at 272; 200 high less a 50 header shows to 150.
		expect(scrollToShow(offsets, 5, 0, 200, 50)).toBe(122);
		expect(scrollToShow(offsets, 99, 0, 200)).toBeNull();
	});
});

describe('grouped by package', () => {
	const grid = compareBids(packed, [byPackage, byRow]);

	it('makes a group per package, shots and assets together, each with the package as a unit', () => {
		const groups = groupRows(grid, 'package');
		expect(groups.map((g) => [g.key, g.label, g.rows.map((r) => r.target.id)])).toEqual([
			['pkg:p1', 'Creature', ['a', 'b', 'd']],
			['pkg:p2', 'Comp', ['c', 'x']]
		]);
		expect(groups[0].unit?.cells[0]).toMatchObject({ kind: 'package', amount: { base: usd(100_000) } });
		expect(groups[0].subtotals[0]).toEqual({ bid: usd(0), base: usd(0), priced: 0, excluded: 0, missing: 1, inPackage: 2, declined: 0 });
	});

	it('counts the cells in a package price apart in any grouping', () => {
		const groups = groupRows(grid, 'none');
		expect(groups[0].subtotals[0].inPackage).toBe(2);
	});
});
