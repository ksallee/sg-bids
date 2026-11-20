import { describe, expect, it } from 'vitest';
import { formatAmount, formatDay, formatShare, formatSpread } from './display';
import { money } from './money';

describe('formatAmount', () => {
	it('drops zero minor digits in compact mode and keeps any others', () => {
		expect(formatAmount(money(1_250_000, 'USD'), 'en-US')).toBe('$12,500');
		expect(formatAmount(money(1_250_050, 'USD'), 'en-US')).toBe('$12,500.50');
		expect(formatAmount(money(1_250_000, 'USD'), 'en-US', false)).toBe('$12,500.00');
	});
	it('never writes another dollar as a bare $', () => {
		expect(formatAmount(money(453_600, 'CAD'), 'en-US')).toBe('CA$4,536');
	});
	it('follows the currency minor unit', () => {
		expect(formatAmount(money(1500, 'JPY'), 'en-US')).toBe('¥1,500');
		expect(formatAmount(money(1234, 'GBP'), 'en-GB')).toBe('£12.34');
	});
});

describe('formatSpread', () => {
	it('writes basis points as a percent over', () => {
		expect(formatSpread(0)).toBe('0%');
		expect(formatSpread(1250)).toBe('+12.5%');
		expect(formatSpread(1)).toBe('+0.01%');
		expect(formatSpread(5152)).toBe('+51.52%');
		expect(formatSpread(1500)).toBe('+15%');
		expect(formatSpread(Number.POSITIVE_INFINITY)).toBe('over a zero');
	});
});

describe('formatShare', () => {
	it('rounds to a whole percent and shows a sliver as under one', () => {
		expect(formatShare(5920)).toBe('59%');
		expect(formatShare(20)).toBe('<1%');
		expect(formatShare(0)).toBe('0%');
		expect(formatShare(null)).toBe('');
	});
});

describe('formatDay', () => {
	it('reads a calendar day, whatever the time zone', () => {
		expect(formatDay('2026-11-20', 'en-GB')).toBe('20 Nov 2026');
		expect(formatDay('nope', 'en-GB')).toBe('nope');
	});
});
