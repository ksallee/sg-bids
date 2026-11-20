import { describe, expect, it } from 'vitest';
import { CURRENCIES, currencyLabel, isCurrency } from './currencies';
import { minorDigits } from './money';

describe('currencies', () => {
	it('lists each code once, sorted, every one a code money.ts reads', () => {
		const codes = CURRENCIES.map((c) => c.code);
		expect(new Set(codes).size).toBe(codes.length);
		expect([...codes].sort()).toEqual(codes);
		for (const code of codes) expect(() => minorDigits(code)).not.toThrow();
	});

	it('holds the currencies a VFX bid is usually in', () => {
		for (const code of ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'INR', 'JPY', 'KRW']) expect(isCurrency(code)).toBe(true);
	});

	it('leaves out funds, metals and withdrawn codes', () => {
		for (const code of ['XAU', 'XDR', 'USN', 'CLF', 'BGN', 'HRK', 'SLL', 'CUC', 'usd', '']) expect(isCurrency(code)).toBe(false);
	});

	it('labels a code with its name', () => {
		expect(currencyLabel('EUR')).toBe('EUR · Euro');
		expect(currencyLabel('ZZZ')).toBe('ZZZ');
	});
});
