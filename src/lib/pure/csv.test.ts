import { describe, expect, it } from 'vitest';
import { compareBids } from './compare';
import { bpText, csvField, gridCsv, scenarioCsv, toCsv } from './csv';
import { asset, bid, line, onAsset, onShot, request, shot } from './fixtures';
import { groupRows } from './grid-view';
import { money, rate } from './money';
import { pickCell, setShares, summarize } from './scenario';
import { byPackage, byRow, packed } from './fixtures/packages';

const usd = (minor: number) => money(minor, 'USD');
const gbp = (minor: number) => money(minor, 'GBP');

const req = request({
	shots: [shot('s1', { sequence: 'SEQ A', description: 'Truck, flips' }), shot('s2', { sequence: 'SEQ A' }), shot('s3', { omitted: true })],
	assets: [asset('hero')]
});
const one = bid({
	id: 'one',
	vendorId: 'v1',
	currency: 'USD',
	lines: [line('1a', onShot('s1'), usd(10_000)), line('1b', onShot('s2'), usd(0), { excluded: true }), line('1h', onAsset('hero'), usd(5_000))],
	costs: [{ kind: 'overhead', label: 'Overhead', amount: usd(2_000), labour: false }],
	rebate: [{ jurisdiction: 'CA-BC', workPercent: '100', rate: '36', base: { kind: 'labour' } }]
});
const two = bid({
	id: 'two',
	vendorId: 'v2',
	currency: 'GBP',
	rate: rate('GBP', 'USD', '1.5', '2026-11-20'),
	lines: [line('2a', onShot('s1'), gbp(6_000)), line('2b', onShot('s2'), gbp(10_000))]
});
const grid = compareBids(req, [one, two]);
const names = ['North, Ltd', 'South'];

describe('csvField and toCsv', () => {
	it('quotes commas, quotes and line breaks', () => {
		expect(csvField('a,b')).toBe('"a,b"');
		expect(csvField('say "hi"')).toBe('"say ""hi"""');
		expect(csvField('two\nlines')).toBe('"two\nlines"');
		expect(csvField('plain')).toBe('plain');
	});

	it('defuses a formula but keeps a negative number', () => {
		expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
		expect(csvField('@cmd')).toBe("'@cmd");
		expect(csvField('-12.50')).toBe('-12.50');
		expect(csvField('-x')).toBe("'-x");
	});

	it('joins records with CRLF and ends with one', () => {
		expect(toCsv([['a', 'b'], ['c']])).toBe('a,b\r\nc\r\n');
	});
});

describe('bpText', () => {
	it('writes basis points as a percent', () => {
		expect(bpText(2550)).toBe('25.50');
		expect(bpText(5)).toBe('0.05');
		expect(bpText(-120)).toBe('-1.20');
		expect(bpText(null)).toBe('');
		expect(bpText(Number.POSITIVE_INFINITY)).toBe('');
	});
});

describe('gridCsv', () => {
	const lines = gridCsv(grid, groupRows(grid, 'sequence'), names).split('\r\n');

	it('heads a price in both currencies and a status per vendor', () => {
		expect(lines[0]).toBe(
			'Group,Kind,Code,Description,Cut this round,"North, Ltd (USD)","North, Ltd (USD)","North, Ltd status",South (GBP),South (USD),South status,Lowest vendor,Spread %'
		);
	});

	it('writes each row, telling excluded, not bid and lowest apart', () => {
		// s1: 100.00 against 60.00 GBP = 90.00, so South is lowest and North 11.11% over.
		expect(lines[1]).toBe('SEQ A,shot,S1,"Truck, flips",,100.00,100.00,price,60.00,90.00,lowest,South,11.11');
		expect(lines[2]).toBe('SEQ A,shot,S2,,,,,excluded,100.00,150.00,lowest,South,');
		expect(lines[3]).toBe('No sequence,shot,S3,,yes,,,not bid,,,not bid,,');
		expect(lines[4]).toBe('Assets,asset,hero,,,50.00,50.00,lowest,,,not bid,"North, Ltd",');
	});

	it('ends with the totals, the rebate as an estimate, and the rates', () => {
		expect(lines).toContain('Totals,total,Grand total,,,170.00,170.00,,160.00,240.00,,,');
		expect(lines).toContain('Totals,total,Estimated rebate,,,,,estimate unknown: labour split unknown,,,no rebate,,');
		expect(lines).toContain('Totals,rate,Rate to USD,,,,1,base currency,,1.5,locked 2026-11-20,,');
	});

	it('says a figure needs a rate rather than leaving a zero', () => {
		const noRate = compareBids(req, [one, { ...two, rate: null }]);
		const out = gridCsv(noRate, groupRows(noRate, 'none'), names);
		expect(out).toContain('60.00,,needs a rate');
		expect(out).toContain('Totals,total,Grand total,,,170.00,170.00,,160.00,needs a rate,,,');
	});
});

describe('scenarioCsv', () => {
	it('writes a record per share, the unawarded rows, each vendor part and the totals', () => {
		const split = setShares(grid, new Map(), grid.rows[0], [
			{ bidId: 'one', percent: '40' },
			{ bidId: 'two', percent: '60' }
		]);
		if (!split.ok) throw new Error(split.message);
		const picks = new Map(split.picks);
		picks.set('asset:hero', [{ bidId: 'one', percent: '100' }]);
		const summary = summarize(grid, picks, new Set(['one']));
		const lines = scenarioCsv(grid, 'Mostly South', picks, summary, names).split('\r\n');
		expect(lines[0]).toBe('Scenario,Mostly South');
		expect(lines).toContain('shot,S1,SEQ A,"North, Ltd",40,100.00,USD,40.00,split');
		expect(lines).toContain('shot,S1,SEQ A,South,60,60.00,GBP,54.00,split');
		expect(lines).toContain('shot,S2,SEQ A,,,,,,unawarded');
		expect(lines.some((l) => l.includes('S3'))).toBe(false);
		expect(lines).toContain('"North, Ltd",2,90.00,20.00,no,90.00,62.50');
		expect(lines).toContain('Total,144.00');
		expect(lines).toContain('Rows awarded,2 of 3');
	});
});

describe('packages in the CSV', () => {
	const grid = compareBids(packed, [byPackage, byRow]);
	const names = ['A Studio', 'B Studio'];

	it('says in package price on a row, and gives the package as a unit', () => {
		const lines = gridCsv(grid, groupRows(grid, 'package'), names).split('\r\n');
		expect(lines).toContain("Creature,shot,A,,,,,in the bid's figure,300.00,300.00,lowest,B Studio,");
		expect(lines).toContain('Bids,bid,Creature,,,1000.00,1000.00,one figure,900.00,900.00,rows summed,B Studio,11.11');
	});

	it('writes the figure once for a package given whole', () => {
		const picks = pickCell(grid, new Map(), grid.rows[0], 0);
		const lines = scenarioCsv(grid, 'Packages', picks, summarize(grid, picks), names).split('\r\n');
		expect(lines).toContain("shot,A,,A Studio,100,,USD,,in the bid's figure");
		expect(lines).toContain('bid,Creature,,A Studio,100,1000.00,USD,1000.00,one figure for the bid');
	});
});
