import { describe, expect, it } from 'vitest';
import { bid, line, onAsset, onShot } from './fixtures';
import { money, rate } from './money';
import { bidTotals, toBase } from './totals';

const day = '2026-11-20';

describe('bidTotals in one currency', () => {
	const usd = (minor: number) => money(minor, 'USD');

	it('sums lines and costs, takes off the discount, adds the tax', () => {
		const totals = bidTotals(
			bid({
				currency: 'USD',
				lines: [line('l1', onShot('sh010'), usd(1_000_000)), line('l2', onAsset('hero'), usd(500_000))],
				costs: [
					{ kind: 'overhead', label: 'Overhead', amount: usd(100_000), labour: false },
					{ kind: 'supervision', label: 'VFX supervisor', amount: usd(50_000), labour: true }
				],
				discount: { kind: 'percent', percent: '10' },
				tax: { kind: 'percent', percent: '5' }
			}),
			'USD'
		);
		expect(totals.lines.bid).toEqual(usd(1_500_000));
		expect(totals.costs.bid).toEqual(usd(150_000));
		expect(totals.subtotal.bid).toEqual(usd(1_650_000));
		expect(totals.discount.bid).toEqual(usd(165_000));
		// 5% of 1,485,000.
		expect(totals.tax.bid).toEqual(usd(74_250));
		expect(totals.grand.bid).toEqual(usd(1_559_250));
		expect(totals.grand.base).toEqual(usd(1_559_250));
	});

	it('skips an excluded line, whatever its total says', () => {
		const totals = bidTotals(
			bid({
				currency: 'USD',
				lines: [line('l1', onShot('sh010'), usd(1000)), line('l2', onShot('sh020'), usd(99_999), { excluded: true })]
			}),
			'USD'
		);
		expect(totals.lines.bid).toEqual(usd(1000));
		expect(totals.grand.bid).toEqual(usd(1000));
	});

	it('takes a discount and a tax given as amounts', () => {
		const totals = bidTotals(
			bid({
				currency: 'USD',
				lines: [line('l1', onShot('sh010'), usd(10_000))],
				discount: { kind: 'amount', amount: usd(1_000) },
				tax: { kind: 'amount', amount: usd(450) }
			}),
			'USD'
		);
		expect(totals.grand.bid).toEqual(usd(9_450));
	});

	it('rounds a percent discount half away from zero', () => {
		const totals = bidTotals(
			bid({ currency: 'USD', lines: [line('l1', onShot('sh010'), usd(1001))], discount: { kind: 'percent', percent: '50' } }),
			'USD'
		);
		expect(totals.discount.bid).toEqual(usd(501));
		expect(totals.grand.bid).toEqual(usd(500));
	});

	it('is zero for a bid with no lines and no costs', () => {
		const totals = bidTotals(bid({ currency: 'JPY' }), 'JPY');
		expect(totals.grand).toEqual({ bid: money(0, 'JPY'), base: money(0, 'JPY') });
		expect(totals.lines.bid).toEqual(money(0, 'JPY'));
	});
});

describe('bidTotals across currencies', () => {
	it('converts a zero-decimal bid at its locked rate, rounding to the cent', () => {
		// 333 yen × 0.0066 = 2.1978 dollars.
		const totals = bidTotals(
			bid({ currency: 'JPY', rate: rate('JPY', 'USD', '0.0066', day), lines: [line('l1', onShot('sh010'), money(333, 'JPY'))] }),
			'USD'
		);
		expect(totals.grand).toEqual({ bid: money(333, 'JPY'), base: money(220, 'USD') });
	});

	it('converts a three-decimal bid, rounding to the target minor unit', () => {
		// 1.234 dinar × 2.9851 = 3.6836134 euro.
		const totals = bidTotals(
			bid({ currency: 'KWD', rate: rate('KWD', 'EUR', '2.9851', day), lines: [line('l1', onShot('sh010'), money(1234, 'KWD'))] }),
			'EUR'
		);
		expect(totals.grand).toEqual({ bid: money(1234, 'KWD'), base: money(368, 'EUR') });
	});

	it('converts into a zero-decimal base, half away from zero', () => {
		// 2.50 dollars × 1 = 2.5 yen, rounds to 3.
		const totals = bidTotals(
			bid({ currency: 'USD', rate: rate('USD', 'JPY', '1', day), lines: [line('l1', onShot('sh010'), money(250, 'USD'))] }),
			'JPY'
		);
		expect(totals.grand.base).toEqual(money(3, 'JPY'));
	});

	it('converts each figure once from the bid currency', () => {
		// Two lines of 0.005 dinar: 0.010 dinar × 1 = 1 cent. Each line alone would round to 1 cent too.
		const totals = bidTotals(
			bid({
				currency: 'KWD',
				rate: rate('KWD', 'USD', '1', day),
				lines: [line('l1', onShot('sh010'), money(5, 'KWD')), line('l2', onShot('sh020'), money(5, 'KWD'))]
			}),
			'USD'
		);
		expect(totals.lines.base).toEqual(money(1, 'USD'));
	});

	it('refuses a bid in another currency with no rate', () => {
		expect(() => bidTotals(bid({ currency: 'EUR' }), 'USD')).toThrow();
	});

	it('refuses a rate that does not convert the bid currency to the base', () => {
		expect(() => bidTotals(bid({ currency: 'EUR', rate: rate('USD', 'EUR', '0.9', day) }), 'USD')).toThrow();
		expect(() => bidTotals(bid({ currency: 'EUR', rate: rate('EUR', 'GBP', '0.9', day) }), 'USD')).toThrow();
	});

	it('refuses a rate on a bid already in the base currency', () => {
		expect(() => bidTotals(bid({ currency: 'USD', rate: rate('USD', 'USD', '1', day) }), 'USD')).toThrow();
	});
});

describe('mixed currencies are an error', () => {
	const eur = money(100, 'EUR');

	it('refuses a line total in another currency', () => {
		expect(() => bidTotals(bid({ currency: 'USD', lines: [line('l1', onShot('sh010'), eur)] }), 'USD')).toThrow(/l1/);
	});

	it('refuses an excluded line in another currency too', () => {
		expect(() => bidTotals(bid({ currency: 'USD', lines: [line('l1', onShot('sh010'), eur, { excluded: true })] }), 'USD')).toThrow();
	});

	it('refuses a department cost, compute or markup in another currency', () => {
		const ok = money(100, 'USD');
		const cases = [
			{ departments: [{ department: 'comp', cost: eur }] },
			{ compute: eur },
			{ markup: eur }
		];
		for (const extra of cases) {
			expect(() => bidTotals(bid({ currency: 'USD', lines: [line('l1', onShot('sh010'), ok, extra)] }), 'USD')).toThrow();
		}
	});

	it('refuses a cost, a discount or a tax in another currency', () => {
		expect(() =>
			bidTotals(bid({ currency: 'USD', costs: [{ kind: 'overhead', label: 'x', amount: eur, labour: false }] }), 'USD')
		).toThrow();
		expect(() => bidTotals(bid({ currency: 'USD', discount: { kind: 'amount', amount: eur } }), 'USD')).toThrow();
		expect(() => bidTotals(bid({ currency: 'USD', tax: { kind: 'amount', amount: eur } }), 'USD')).toThrow();
	});
});

describe('toBase', () => {
	it('converts an amount of the bid to the base currency', () => {
		const b = bid({ currency: 'JPY', rate: rate('JPY', 'USD', '0.0066', day) });
		expect(toBase(money(1000, 'JPY'), b, 'USD')).toEqual(money(660, 'USD'));
	});

	it('returns the amount as is when the bid is in the base currency', () => {
		expect(toBase(money(5, 'USD'), bid({ currency: 'USD' }), 'USD')).toEqual(money(5, 'USD'));
	});
});

describe('a package priced as one figure', () => {
	const usd = (minor: number) => money(minor, 'USD');

	it('counts the figure once with the lines; its rows add nothing', () => {
		const totals = bidTotals(
			bid({
				currency: 'USD',
				lines: [line('l1', onShot('sh010'), usd(0), { inPackage: true }), line('l2', onShot('sh020'), usd(0), { inPackage: true }), line('l3', onShot('sh030'), usd(400))],
				packages: [{ package: 'p1', total: usd(1_000) }],
				discount: { kind: 'percent', percent: '10' }
			}),
			'USD'
		);
		expect(totals.lines.bid).toEqual(usd(1_400));
		expect(totals.discount.bid).toEqual(usd(140));
		expect(totals.grand.bid).toEqual(usd(1_260));
	});

	it('refuses a figure in another currency', () => {
		expect(() => bidTotals(bid({ currency: 'USD', packages: [{ package: 'p1', total: money(5, 'EUR') }] }), 'USD')).toThrow(/package p1/);
	});

	it('refuses a line in a package price that carries a price, or is excluded', () => {
		expect(() => bidTotals(bid({ currency: 'USD', lines: [line('l1', onShot('sh010'), usd(5), { inPackage: true })] }), 'USD')).toThrow(/l1 is in a package price/);
		expect(() => bidTotals(bid({ currency: 'USD', lines: [line('l1', onShot('sh010'), usd(0), { inPackage: true, excluded: true })] }), 'USD')).toThrow(/l1 is in a package price/);
	});
});
