import { describe, expect, it } from 'vitest';
import { money } from './money';
import { comparePercent, isPercent, percentOf, sumPercents } from './percent';

describe('isPercent', () => {
	it('takes a plain non-negative decimal', () => {
		expect(isPercent('0')).toBe(true);
		expect(isPercent('39')).toBe(true);
		expect(isPercent('12.5')).toBe(true);
		expect(isPercent('100')).toBe(true);
	});

	it('refuses a negative, an exponent, a comma or an empty string', () => {
		expect(isPercent('-1')).toBe(false);
		expect(isPercent('1e2')).toBe(false);
		expect(isPercent('1,5')).toBe(false);
		expect(isPercent('')).toBe(false);
	});
});

describe('percentOf', () => {
	it('takes a percent of an amount', () => {
		expect(percentOf(money(10000, 'USD'), '39')).toEqual(money(3900, 'USD'));
		expect(percentOf(money(10000, 'USD'), '0')).toEqual(money(0, 'USD'));
		expect(percentOf(money(10000, 'USD'), '100')).toEqual(money(10000, 'USD'));
	});

	it('chains several percents and rounds once, half away from zero', () => {
		// 1001 × 50% × 50% = 250.25, one rounding: 250. Two roundings would give 250.5 → 251 → 125.5.
		expect(percentOf(money(1001, 'USD'), '50', '50')).toEqual(money(250, 'USD'));
		// 333 yen × 65% × 25% = 54.1125 yen.
		expect(percentOf(money(333, 'JPY'), '65', '25')).toEqual(money(54, 'JPY'));
		// 1 × 50% = 0.5, away from zero.
		expect(percentOf(money(1, 'KWD'), '50')).toEqual(money(1, 'KWD'));
		expect(percentOf(money(-1, 'KWD'), '50')).toEqual(money(-1, 'KWD'));
	});

	it('takes a decimal percent exactly', () => {
		// 2000 × 12.5% = 250.
		expect(percentOf(money(2000, 'USD'), '12.5')).toEqual(money(250, 'USD'));
	});

	it('refuses what is not a percent', () => {
		expect(() => percentOf(money(1, 'USD'), '-5')).toThrow();
		expect(() => percentOf(money(1, 'USD'), 'ten')).toThrow();
	});
});

describe('sumPercents and comparePercent', () => {
	it('adds percents exactly', () => {
		expect(sumPercents([])).toBe('0');
		expect(sumPercents(['60', '40'])).toBe('100');
		expect(sumPercents(['33.3', '33.3', '33.4'])).toBe('100');
		expect(sumPercents(['0.1', '0.2'])).toBe('0.3');
		expect(sumPercents(['12.25', '7'])).toBe('19.25');
	});

	it('compares two percents', () => {
		expect(comparePercent('100', '100.0')).toBe(0);
		expect(comparePercent('99.99', '100')).toBe(-1);
		expect(comparePercent('100.01', '100')).toBe(1);
	});
});
