import { describe, expect, it } from 'vitest';
import { add, convert, format, fromDecimal, minorDigits, money, rate, toDecimal } from './money';

/** Intl puts a no-break or narrow no-break space between number and symbol in some locales. */
const plain = (text: string): string => text.replace(/\s/g, ' ');

describe('minorDigits', () => {
	it('knows the ISO 4217 minor unit of a currency', () => {
		expect(minorDigits('USD')).toBe(2);
		expect(minorDigits('EUR')).toBe(2);
		expect(minorDigits('JPY')).toBe(0);
		expect(minorDigits('KRW')).toBe(0);
		expect(minorDigits('KWD')).toBe(3);
		expect(minorDigits('BHD')).toBe(3);
	});

	it('refuses a code that is not three capital letters', () => {
		expect(() => minorDigits('usd')).toThrow();
		expect(() => minorDigits('US')).toThrow();
		expect(() => minorDigits('')).toThrow();
	});
});

describe('money', () => {
	it('holds a whole number of minor units', () => {
		expect(money(1999, 'USD')).toEqual({ minor: 1999, currency: 'USD' });
		expect(money(-5, 'JPY')).toEqual({ minor: -5, currency: 'JPY' });
	});

	it('refuses a fraction or an unsafe integer', () => {
		expect(() => money(19.99, 'USD')).toThrow();
		expect(() => money(Number.MAX_SAFE_INTEGER + 1, 'USD')).toThrow();
		expect(() => money(Number.NaN, 'USD')).toThrow();
	});
});

describe('fromDecimal and toDecimal', () => {
	it('reads a decimal string into minor units exactly', () => {
		expect(fromDecimal('19.99', 'USD')).toEqual(money(1999, 'USD'));
		expect(fromDecimal('0.1', 'USD')).toEqual(money(10, 'USD'));
		expect(fromDecimal('-3', 'USD')).toEqual(money(-300, 'USD'));
		expect(fromDecimal('1500', 'JPY')).toEqual(money(1500, 'JPY'));
		expect(fromDecimal('1.005', 'KWD')).toEqual(money(1005, 'KWD'));
	});

	it('refuses more digits than the currency has', () => {
		expect(() => fromDecimal('0.001', 'USD')).toThrow();
		expect(() => fromDecimal('1.5', 'JPY')).toThrow();
		expect(() => fromDecimal('1.0001', 'KWD')).toThrow();
	});

	it('refuses what is not a plain decimal', () => {
		expect(() => fromDecimal('1e3', 'USD')).toThrow();
		expect(() => fromDecimal('1,50', 'USD')).toThrow();
		expect(() => fromDecimal('', 'USD')).toThrow();
	});

	it('writes minor units back as a decimal string with every minor digit', () => {
		expect(toDecimal(money(1999, 'USD'))).toBe('19.99');
		expect(toDecimal(money(5, 'USD'))).toBe('0.05');
		expect(toDecimal(money(-5, 'USD'))).toBe('-0.05');
		expect(toDecimal(money(1500, 'JPY'))).toBe('1500');
		expect(toDecimal(money(1005, 'KWD'))).toBe('1.005');
	});
});

describe('add', () => {
	it('adds 0.1 and 0.2 to exactly 0.3', () => {
		const sum = add(fromDecimal('0.1', 'USD'), fromDecimal('0.2', 'USD'));
		expect(sum).toEqual(fromDecimal('0.3', 'USD'));
		expect(toDecimal(sum)).toBe('0.30');
	});

	it('refuses to add two currencies', () => {
		expect(() => add(money(1, 'USD'), money(1, 'EUR'))).toThrow();
	});
});

describe('rate', () => {
	it('locks a rate as a decimal string with its date', () => {
		expect(rate('USD', 'EUR', '0.9234', '2026-11-20')).toEqual({ from: 'USD', to: 'EUR', rate: '0.9234', date: '2026-11-20' });
	});

	it('refuses a rate that is not a positive plain decimal', () => {
		expect(() => rate('USD', 'EUR', '0', '2026-11-20')).toThrow();
		expect(() => rate('USD', 'EUR', '-1.2', '2026-11-20')).toThrow();
		expect(() => rate('USD', 'EUR', '1e2', '2026-11-20')).toThrow();
		expect(() => rate('USD', 'EUR', 'abc', '2026-11-20')).toThrow();
	});

	it('refuses a date that is not a calendar day', () => {
		expect(() => rate('USD', 'EUR', '0.9', '2026-13-01')).toThrow();
		expect(() => rate('USD', 'EUR', '0.9', '2026-02-30')).toThrow();
		expect(() => rate('USD', 'EUR', '0.9', '20/11/2026')).toThrow();
	});
});

describe('convert', () => {
	const day = '2026-11-20';

	it('converts at the locked rate to the target currency', () => {
		expect(convert(money(10000, 'USD'), rate('USD', 'EUR', '0.9234', day))).toEqual(money(9234, 'EUR'));
	});

	it('rounds to the target minor unit: none for JPY, three for KWD', () => {
		// 19.99 × 151.37 = 3025.8863 yen.
		expect(convert(money(1999, 'USD'), rate('USD', 'JPY', '151.37', day))).toEqual(money(3026, 'JPY'));
		// 1000 yen × 0.0066 = 6.60 dollars.
		expect(convert(money(1000, 'JPY'), rate('JPY', 'USD', '0.0066', day))).toEqual(money(660, 'USD'));
		// 100.00 × 0.30745 = 30.745 dinar.
		expect(convert(money(10000, 'USD'), rate('USD', 'KWD', '0.30745', day))).toEqual(money(30745, 'KWD'));
		// 0.001 dinar × 3.2526 = 0.0032526 dollars, under half a cent.
		expect(convert(money(1, 'KWD'), rate('KWD', 'USD', '3.2526', day))).toEqual(money(0, 'USD'));
	});

	it('rounds half away from zero', () => {
		expect(convert(money(50, 'USD'), rate('USD', 'JPY', '1', day))).toEqual(money(1, 'JPY'));
		expect(convert(money(-50, 'USD'), rate('USD', 'JPY', '1', day))).toEqual(money(-1, 'JPY'));
		expect(convert(money(25, 'USD'), rate('USD', 'EUR', '0.5', day))).toEqual(money(13, 'EUR'));
		expect(convert(money(-25, 'USD'), rate('USD', 'EUR', '0.5', day))).toEqual(money(-13, 'EUR'));
		expect(convert(money(49, 'USD'), rate('USD', 'JPY', '1', day))).toEqual(money(0, 'JPY'));
	});

	it('does not drift where floating point does', () => {
		// Math.round(1.005 * 100) is 100: the float is 100.49999999999999.
		expect(convert(fromDecimal('1.005', 'KWD'), rate('KWD', 'USD', '1', day))).toEqual(money(101, 'USD'));
		// 0.1 + 0.2 dollars, then at 10: three dollars, not 3.0000000000000004.
		const sum = add(fromDecimal('0.1', 'USD'), fromDecimal('0.2', 'USD'));
		expect(convert(sum, rate('USD', 'EUR', '10', day))).toEqual(money(300, 'EUR'));
		// 0.07 × 100 is 7.000000000000001 in floats.
		expect(convert(fromDecimal('0.07', 'USD'), rate('USD', 'JPY', '100', day))).toEqual(money(7, 'JPY'));
	});

	it('stays exact on large amounts and long rates', () => {
		// 90 trillion yen at a ten-digit rate.
		expect(convert(money(90_000_000_000_000, 'JPY'), rate('JPY', 'USD', '0.0066123457', day))).toEqual(
			money(59_511_111_300_000, 'USD')
		);
	});

	it('refuses an amount in another currency than the rate', () => {
		expect(() => convert(money(100, 'GBP'), rate('USD', 'EUR', '0.9', day))).toThrow();
	});

	it('refuses a result past the safe integer range', () => {
		expect(() => convert(money(Number.MAX_SAFE_INTEGER, 'USD'), rate('USD', 'JPY', '200', day))).toThrow();
	});
});

describe('format', () => {
	it('formats with every minor digit of the currency', () => {
		expect(format(money(123456, 'USD'), 'en-US')).toBe('$1,234.56');
		expect(format(money(-1234, 'USD'), 'en-US')).toBe('-$12.34');
		expect(format(money(1235, 'JPY'), 'en-US')).toBe('¥1,235');
		expect(plain(format(money(1234567, 'KWD'), 'en-US'))).toBe('KWD 1,234.567');
		expect(plain(format(money(123456, 'EUR'), 'de-DE'))).toBe('1.234,56 €');
	});

	it('keeps a large amount exact', () => {
		expect(format(money(Number.MAX_SAFE_INTEGER, 'USD'), 'en-US')).toBe('$90,071,992,547,409.91');
	});
});
