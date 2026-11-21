import { describe, expect, it } from 'vitest';
import { bid, line, onAsset, onShot } from './fixtures';
import type { RebateSplit } from './model';
import { money, rate } from './money';
import { estimateRebate, validateSplits } from './rebate';

const usd = (minor: number) => money(minor, 'USD');
const all = { kind: 'all' } as const;
const labour = { kind: 'labour' } as const;

function split(jurisdiction: string, workPercent: string, rate: string, base: RebateSplit['base'] = all): RebateSplit {
	return { jurisdiction, workPercent, rate, base };
}

/** One shot at 100,000.00 dollars, no department detail. */
const plain = (rebate: RebateSplit[]) =>
	bid({ currency: 'USD', lines: [line('l1', onShot('sh010'), usd(10_000_000))], rebate });

/** One shot with department detail: 10,000.00 of which 2,000.00 is compute. */
const detailed = (rebate: RebateSplit[], extra: Partial<Parameters<typeof bid>[0]> = {}) =>
	bid({
		currency: 'USD',
		lines: [
			line('l1', onShot('sh010'), usd(1_000_000), {
				departments: [
					{ department: 'comp', days: '10', cost: usd(500_000) },
					{ department: 'fx', days: '5', cost: usd(300_000) }
				],
				compute: usd(200_000)
			})
		],
		rebate,
		...extra
	});

describe('validateSplits', () => {
	it('takes no splits, splits under 100 and splits at exactly 100', () => {
		expect(validateSplits([])).toEqual([]);
		expect(validateSplits([split('GB', '60', '39')])).toEqual([]);
		expect(validateSplits([split('GB', '33.3', '39'), split('FR', '33.3', '30'), split('AU', '33.4', '30')])).toEqual([]);
		expect(validateSplits([split('GB', '0', '39')])).toEqual([]);
	});

	it('refuses splits over 100 percent of the work', () => {
		expect(validateSplits([split('GB', '60', '39'), split('FR', '40.01', '30')])).toHaveLength(1);
		expect(validateSplits([split('GB', '101', '39')]).length).toBeGreaterThan(0);
	});

	it('refuses a rate over 100, a contract share over 100, or a percent that does not parse', () => {
		expect(validateSplits([split('GB', '10', '101')])).toHaveLength(1);
		expect(validateSplits([split('CA-QC', '10', '25', { kind: 'contract', percent: '165' })])).toHaveLength(1);
		expect(validateSplits([split('GB', 'ten', '39')])).toHaveLength(1);
		expect(validateSplits([split('GB', '10', '-1')])).toHaveLength(1);
	});

	it('refuses an empty jurisdiction code', () => {
		expect(validateSplits([split('', '10', '39')])).toHaveLength(1);
	});
});

describe('estimateRebate', () => {
	it('is zero with no splits, and the total after rebate is the gross', () => {
		const result = estimateRebate(plain([]), 'USD');
		expect(result.rebate).toEqual({ bid: usd(0), base: usd(0) });
		expect(result.afterRebate).toEqual(result.gross);
		expect(result.coveredPercent).toBe('0');
	});

	it('earns nothing on a split at 0 percent of the work', () => {
		const result = estimateRebate(plain([split('GB', '0', '39')]), 'USD');
		expect(result.splits[0].rebate).toEqual({ bid: usd(0), base: usd(0) });
		expect(result.afterRebate?.bid).toEqual(usd(10_000_000));
	});

	it('takes the rate of the whole bid at 100 percent of the work', () => {
		const result = estimateRebate(plain([split('GB', '100', '39')]), 'USD');
		expect(result.splits[0].base).toEqual(usd(10_000_000));
		expect(result.rebate?.bid).toEqual(usd(3_900_000));
		expect(result.afterRebate?.bid).toEqual(usd(6_100_000));
		expect(result.coveredPercent).toBe('100');
	});

	it('leaves the uncovered share without a rebate', () => {
		// 60% in the UK at 39%: 23.4% of the bid.
		const result = estimateRebate(plain([split('GB', '60', '39')]), 'USD');
		expect(result.rebate?.bid).toEqual(usd(2_340_000));
		expect(result.coveredPercent).toBe('60');
	});

	it('throws on splits over 100 percent', () => {
		expect(() => estimateRebate(plain([split('GB', '60', '39'), split('FR', '41', '30')]), 'USD')).toThrow();
	});

	it('adds several jurisdictions', () => {
		// UK half at 39% of all: 19,500.00. France half at 30%: 15,000.00.
		const result = estimateRebate(plain([split('GB', '50', '39'), split('FR', '50', '30')]), 'USD');
		expect(result.splits.map((s) => s.rebate?.bid)).toEqual([usd(1_950_000), usd(1_500_000)]);
		expect(result.rebate?.bid).toEqual(usd(3_450_000));
	});

	it('applies a contract base: Quebec 25% on 65% of the contract', () => {
		const result = estimateRebate(plain([split('CA-QC', '100', '25', { kind: 'contract', percent: '65' })]), 'USD');
		expect(result.splits[0].base).toEqual(usd(6_500_000));
		expect(result.rebate?.bid).toEqual(usd(1_625_000));
	});

	it('leaves tax out of the base and takes the discount off it', () => {
		const result = estimateRebate(
			bid({
				currency: 'USD',
				lines: [line('l1', onShot('sh010'), usd(100_000))],
				discount: { kind: 'amount', amount: usd(10_000) },
				tax: { kind: 'percent', percent: '10' },
				rebate: [split('GB', '100', '10')]
			}),
			'USD'
		);
		expect(result.gross.bid).toEqual(usd(99_000));
		expect(result.splits[0].base).toEqual(usd(90_000));
		expect(result.rebate?.bid).toEqual(usd(9_000));
		expect(result.afterRebate?.bid).toEqual(usd(90_000));
	});

	it('rounds the rebate once, half away from zero', () => {
		// 1001 cents × 50% × 50% = 250.25 cents.
		const result = estimateRebate(
			bid({ currency: 'USD', lines: [line('l1', onShot('sh010'), usd(1001))], rebate: [split('GB', '50', '50')] }),
			'USD'
		);
		expect(result.rebate?.bid).toEqual(usd(250));
	});
});

describe('estimateRebate on a labour base', () => {
	it('leaves compute out when the line has department detail', () => {
		// Labour is 10,000.00 less 2,000.00 compute. BC basic 36% on it.
		const result = estimateRebate(detailed([split('CA-BC', '100', '36', labour)]), 'USD');
		expect(result.splits[0].base).toEqual(usd(800_000));
		expect(result.rebate?.bid).toEqual(usd(288_000));
		expect(result.labourDetailMissing).toBe(false);
	});

	it('counts the non-shot costs marked as labour, and only those', () => {
		const result = estimateRebate(
			detailed([split('CA-BC', '100', '36', labour)], {
				costs: [
					{ kind: 'supervision', label: 'VFX supervisor', amount: usd(100_000), labour: true },
					{ kind: 'overhead', label: 'Overhead', amount: usd(50_000), labour: false }
				]
			}),
			'USD'
		);
		expect(result.splits[0].base).toEqual(usd(900_000));
	});

	it('flags a bid with no department detail and does not guess', () => {
		const result = estimateRebate(plain([split('CA-BC', '100', '36', labour)]), 'USD');
		expect(result.labourDetailMissing).toBe(true);
		expect(result.linesWithoutDetail).toEqual(['l1']);
		expect(result.splits[0].base).toBeNull();
		expect(result.splits[0].rebate).toBeNull();
		expect(result.rebate).toBeNull();
		expect(result.afterRebate).toBeNull();
	});

	it('still estimates the other splits when one is unknown', () => {
		const result = estimateRebate(plain([split('CA-BC', '50', '36', labour), split('GB', '50', '39')]), 'USD');
		expect(result.splits[0].rebate).toBeNull();
		expect(result.splits[1].rebate?.bid).toEqual(usd(1_950_000));
		expect(result.rebate).toBeNull();
	});

	it('names only the lines that lack detail, skipping excluded ones', () => {
		const b = bid({
			currency: 'USD',
			lines: [
				...detailed([]).lines,
				line('l2', onAsset('hero'), usd(1000)),
				line('l3', onShot('sh030'), usd(1000), { excluded: true })
			],
			rebate: [split('CA-ON', '100', '18', labour)]
		});
		expect(estimateRebate(b, 'USD').linesWithoutDetail).toEqual(['l2']);
	});

	it('does not flag missing detail when no split has a labour base', () => {
		expect(estimateRebate(plain([split('GB', '100', '39')]), 'USD').labourDetailMissing).toBe(false);
	});

	it('knows no labour in a package figure: the figure is named, its rows are not', () => {
		const b = bid({
			currency: 'USD',
			lines: [...detailed([]).lines, line('l2', onShot('sh020'), usd(0), { inPackage: true })],
			packages: [{ package: 'p1', total: usd(5_000) }],
			rebate: [split('CA-ON', '100', '18', labour)]
		});
		const result = estimateRebate(b, 'USD');
		expect(result.linesWithoutDetail).toEqual(['package:p1']);
		expect(result.rebate).toBeNull();
	});

	it('takes a package figure into an all base', () => {
		const b = bid({
			currency: 'USD',
			lines: [line('l2', onShot('sh020'), usd(0), { inPackage: true })],
			packages: [{ package: 'p1', total: usd(10_000) }],
			rebate: [split('GB', '100', '10')]
		});
		expect(estimateRebate(b, 'USD').rebate?.bid).toEqual(usd(1_000));
	});
});

describe('estimateRebate in the base currency', () => {
	it('converts the rebate and the total after rebate at the bid rate', () => {
		// 100,000 yen, 39% in the UK: 39,000 yen, 61,000 yen after. At 0.0066: 257.40 and 402.60 dollars.
		const result = estimateRebate(
			bid({
				currency: 'JPY',
				rate: rate('JPY', 'USD', '0.0066', '2026-11-20'),
				lines: [line('l1', onShot('sh010'), money(100_000, 'JPY'))],
				rebate: [split('GB', '100', '39')]
			}),
			'USD'
		);
		expect(result.rebate).toEqual({ bid: money(39_000, 'JPY'), base: usd(25_740) });
		expect(result.afterRebate).toEqual({ bid: money(61_000, 'JPY'), base: usd(40_260) });
	});
});
