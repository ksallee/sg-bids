import { describe, expect, it } from 'vitest';
import { decimalSeparator, parseAmount, showAmount } from './amount';

describe('decimalSeparator', () => {
	it('reads the locale’s decimal mark', () => {
		expect(decimalSeparator('en-US')).toBe('.');
		expect(decimalSeparator('en-GB')).toBe('.');
		expect(decimalSeparator('fr-FR')).toBe(',');
		expect(decimalSeparator('de-DE')).toBe(',');
	});

	it('falls back to a point for a locale it cannot read', () => {
		expect(decimalSeparator('not a locale')).toBe('.');
	});
});

describe('parseAmount', () => {
	const en = (text: string, currency = 'USD') => parseAmount(text, currency, '.');
	const fr = (text: string, currency = 'EUR') => parseAmount(text, currency, ',');

	it('is blank for an empty cell', () => {
		expect(en('')).toEqual({ kind: 'blank' });
		expect(en('   ')).toEqual({ kind: 'blank' });
		expect(en(' ')).toEqual({ kind: 'blank' });
	});

	it('reads plain numbers', () => {
		expect(en('12500')).toEqual({ kind: 'amount', decimal: '12500' });
		expect(en('12500.5')).toEqual({ kind: 'amount', decimal: '12500.5' });
		expect(en('0.75')).toEqual({ kind: 'amount', decimal: '0.75' });
	});

	it('drops currency signs, codes and spaces', () => {
		expect(en('$12,500.00')).toEqual({ kind: 'amount', decimal: '12500.00' });
		expect(en('USD 12500')).toEqual({ kind: 'amount', decimal: '12500' });
		expect(fr('12 500,50 €')).toEqual({ kind: 'amount', decimal: '12500.50' });
		expect(fr('12 500,50 €')).toEqual({ kind: 'amount', decimal: '12500.50' });
		expect(en("1'234.50", 'CHF')).toEqual({ kind: 'amount', decimal: '1234.50' });
	});

	// Found by the round trip in money.property.test.ts: the app's own figures, pasted back.
	it('drops a sign with letters of its currency code on it, as the app formats them', () => {
		expect(fr('0,00 US$', 'USD')).toEqual({ kind: 'amount', decimal: '0.00' });
		expect(fr('0,24 NZ$', 'NZD')).toEqual({ kind: 'amount', decimal: '0.24' });
		expect(en('CA$1,234.50', 'CAD')).toEqual({ kind: 'amount', decimal: '1234.50' });
		expect(fr('1 234,50 $ US', 'USD')).toEqual({ kind: 'amount', decimal: '1234.50' });
		expect(fr('1 234,50 R$', 'BRL')).toEqual({ kind: 'amount', decimal: '1234.50' });
		expect(en('JP¥1,235', 'JPY')).toEqual({ kind: 'amount', decimal: '1235' });
		expect(fr('1 234,50 £GB', 'GBP')).toEqual({ kind: 'amount', decimal: '1234.50' });
	});

	it('keeps letters on a sign that are not of the currency’s code, and refuses them', () => {
		expect(fr('12 M$', 'USD')).toEqual({ kind: 'error', message: 'Not a number.' });
		expect(en('CA$12', 'USD')).toEqual({ kind: 'error', message: 'Not a number.' });
	});

	it('takes the last mark as the decimal when both appear', () => {
		expect(en('1.234,56')).toEqual({ kind: 'amount', decimal: '1234.56' });
		expect(fr('1,234.56')).toEqual({ kind: 'amount', decimal: '1234.56' });
		expect(en('1,234,567.8')).toEqual({ kind: 'amount', decimal: '1234567.8' });
	});

	it('reads a mark that repeats as grouping', () => {
		expect(en('1,234,567')).toEqual({ kind: 'amount', decimal: '1234567' });
		expect(fr('1.234.567')).toEqual({ kind: 'amount', decimal: '1234567' });
	});

	it('reads one mark not followed by three digits as the decimal, in any locale', () => {
		expect(en('12,5')).toEqual({ kind: 'amount', decimal: '12.5' });
		expect(en('12,50')).toEqual({ kind: 'amount', decimal: '12.50' });
		expect(fr('12.5')).toEqual({ kind: 'amount', decimal: '12.5' });
	});

	it('settles one mark followed by three digits by the locale', () => {
		expect(en('1,234')).toEqual({ kind: 'amount', decimal: '1234' });
		expect(fr('1,234', 'KWD')).toEqual({ kind: 'amount', decimal: '1.234' });
		expect(fr('1.234')).toEqual({ kind: 'amount', decimal: '1234' });
		expect(en('1.234', 'KWD')).toEqual({ kind: 'amount', decimal: '1.234' });
	});

	it('reads a leading zero before three digits as a decimal', () => {
		expect(en('0,125', 'KWD')).toEqual({ kind: 'amount', decimal: '0.125' });
	});

	it('refuses more decimals than the currency has', () => {
		expect(en('12.345')).toEqual({ kind: 'error', message: 'USD takes 2 decimals.' });
		expect(en('1200.5', 'JPY')).toEqual({ kind: 'error', message: 'JPY takes no decimals.' });
	});

	it('refuses a negative amount and text that is not a number', () => {
		expect(en('-100')).toEqual({ kind: 'error', message: 'Use an amount of zero or more.' });
		expect(en('(100)')).toEqual({ kind: 'error', message: 'Use an amount of zero or more.' });
		expect(en('abc')).toEqual({ kind: 'error', message: 'Not a number.' });
		expect(en('12..5')).toEqual({ kind: 'error', message: 'Not a number.' });
		expect(en('1,2,3.4.5')).toEqual({ kind: 'error', message: 'Not a number.' });
		expect(en('1e5')).toEqual({ kind: 'error', message: 'Not a number.' });
	});

	it('refuses an amount too large to hold', () => {
		expect(en('99999999999999999999')).toEqual({ kind: 'error', message: 'That amount is too large.' });
	});
});

describe('showAmount', () => {
	it('writes a plain decimal with the locale’s mark, a zero fraction dropped', () => {
		expect(showAmount('12500.00', '.')).toBe('12500');
		expect(showAmount('12500.50', ',')).toBe('12500,50');
		expect(showAmount('0.75', ',')).toBe('0,75');
		expect(showAmount('1500', '.')).toBe('1500');
	});
});
