import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decimalSeparator, parseAmount } from './amount';
import { amountArb, BY_DIGITS, currencyArb, percentArb, rateArb } from './arbitraries';
import { add, convert, format, fromDecimal, minorDigits, money, subtract, sum, toDecimal } from './money';
import { allocate } from './packages';
import { percentOf } from './percent';

/** Any whole number of minor units an amount may hold, signed. */
const minorArb = fc.integer({ min: -1e14, max: 1e14 });
const LOCALES = ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'nl-NL', 'pt-BR', 'ja-JP', 'de-CH', 'sv-SE'];

/**
 * The locale writes the currency as a word with no sign and no code: `Ikr` for ISK in sv-SE.
 * `parseAmount` reads signs and codes only: a known gap, issue #40.
 */
function writtenAsWord(currency: string, locale: string): boolean {
	const symbol = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(1).find((p) => p.type === 'currency')?.value ?? '';
	return !/\p{Sc}/u.test(symbol) && !/^[A-Z]{3}$/.test(symbol);
}

describe('money, for any amounts', () => {
	it('adds and subtracts in whole minor units, exactly', () => {
		fc.assert(
			fc.property(currencyArb, minorArb, minorArb, (currency, a, b) => {
				const x = money(a, currency);
				const y = money(b, currency);
				expect(add(x, y)).toEqual({ minor: a + b, currency });
				expect(subtract(x, y)).toEqual({ minor: a - b, currency });
				expect(subtract(add(x, y), y)).toEqual(x);
			})
		);
	});

	it('takes a percent as a whole number of minor units, within half a unit of the exact figure', () => {
		fc.assert(
			fc.property(currencyArb, minorArb, percentArb(), (currency, minor, percent) => {
				const out = percentOf(money(minor, currency), percent);
				expect(Number.isSafeInteger(out.minor)).toBe(true);
				// |out - minor × percent / 100| ≤ ½, in integers: |200 × scale × out - 2 × minor × digits| ≤ 100 × scale.
				const [whole, fraction = ''] = percent.split('.');
				const digits = BigInt(whole + fraction);
				const scale = 10n ** BigInt(fraction.length);
				const gap = 200n * scale * BigInt(out.minor) - 2n * BigInt(minor) * digits;
				expect((gap < 0n ? -gap : gap) <= 100n * scale).toBe(true);
			})
		);
	});

	it('shares a figure by weight into parts that sum back to it exactly, none below zero', () => {
		fc.assert(
			fc.property(currencyArb, fc.integer({ min: 0, max: 1e12 }), fc.array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 12 }), (currency, minor, weights) => {
				const total = money(minor, currency);
				const parts = allocate(total, weights);
				expect(parts).toHaveLength(weights.length);
				expect(sum(parts, currency)).toEqual(total);
				for (const part of parts) expect(part.minor).toBeGreaterThanOrEqual(0);
			})
		);
	});

	it('shares a figure by percents into parts that sum back to it exactly', () => {
		const percentsArb = fc.array(fc.integer({ min: 1, max: 100_000 }), { minLength: 1, maxLength: 6 });
		fc.assert(
			fc.property(currencyArb, fc.integer({ min: 0, max: 1e12 }), percentsArb, (currency, minor, thousandths) => {
				const total = money(minor, currency);
				expect(sum(allocate(total, thousandths), currency)).toEqual(total);
			})
		);
	});

	it('writes then reads a decimal back to the same amount, for 0, 2 and 3 minor digits', () => {
		fc.assert(
			fc.property(currencyArb, minorArb, (currency, minor) => {
				const amount = money(minor, currency);
				expect(fromDecimal(toDecimal(amount), currency)).toEqual(amount);
			})
		);
	});

	for (const digits of [0, 2, 3] as const) {
		it(`formats then reads back the same amount in every locale that writes a sign or a code, for ${digits} minor digits`, () => {
			const arb = fc
				.constantFrom(...BY_DIGITS[digits])
				.chain((currency) => fc.tuple(amountArb(currency, 50_000_000), fc.constantFrom(...LOCALES.filter((l) => !writtenAsWord(currency, l)))));
			fc.assert(
				fc.property(arb, ([amount, locale]) => {
					const text = format(amount, locale);
					const read = parseAmount(text, amount.currency, decimalSeparator(locale));
					expect(read, `${text} in ${locale}`).toEqual({ kind: 'amount', decimal: expect.any(String) });
					if (read.kind === 'amount') expect(fromDecimal(read.decimal, amount.currency)).toEqual(amount);
				})
			);
		});
	}
});

describe('a conversion, for any amounts and any rate', () => {
	const pairArb = fc.tuple(currencyArb, currencyArb).filter(([a, b]) => a !== b);

	it('converts each line and sums within half a minor unit per figure of converting the sum', () => {
		const arb = pairArb.chain(([from, to]) => fc.tuple(rateArb(from, to), fc.array(amountArb(from, 500_000), { minLength: 1, maxLength: 20 })));
		fc.assert(
			fc.property(arb, ([locked, lines]) => {
				const each = sum(
					lines.map((l) => convert(l, locked)),
					locked.to
				);
				const whole = convert(sum(lines, locked.from), locked);
				// Each conversion rounds by half a unit at most: n lines and the sum, n + 1 roundings.
				expect(Math.abs(each.minor - whole.minor)).toBeLessThanOrEqual(Math.floor((lines.length + 1) / 2));
			})
		);
	});

	it('rounds half away from zero: never more than half a minor unit from the exact figure', () => {
		const arb = pairArb.chain(([from, to]) => fc.tuple(rateArb(from, to), amountArb(from)));
		fc.assert(
			fc.property(arb, ([locked, amount]) => {
				const out = convert(amount, locked);
				const [whole, fraction = ''] = locked.rate.split('.');
				// exact = minor × rate × 10^to / 10^from; compare 2 × out × D against 2 × N.
				const n = BigInt(amount.minor) * BigInt(whole + fraction) * 10n ** BigInt(minorDigits(locked.to));
				const d = 10n ** BigInt(fraction.length + minorDigits(locked.from));
				const gap = 2n * BigInt(out.minor) * d - 2n * n;
				expect((gap < 0n ? -gap : gap) <= d).toBe(true);
			})
		);
	});
});
