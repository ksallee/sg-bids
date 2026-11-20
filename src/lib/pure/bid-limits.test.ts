import { describe, expect, it } from 'vitest';
import { submitProblems } from './bid-limits';
import { bid, line, onShot } from './fixtures';
import { money } from './money';

const usd = (minor: number) => money(minor, 'USD');
const base = () => bid({ currency: 'USD', lines: [line('l1', onShot('sh010'), usd(10_000)), line('l2', onShot('sh020'), usd(5_000), { excluded: true })] });

describe('submitProblems', () => {
	it('passes a bid with a total above zero', () => {
		expect(submitProblems(base(), 'USD')).toEqual([]);
		expect(submitProblems({ ...base(), discount: { kind: 'amount', amount: usd(9_999) } }, 'USD')).toEqual([]);
		expect(submitProblems({ ...base(), discount: { kind: 'percent', percent: '99.99' }, tax: { kind: 'percent', percent: '100' } }, 'USD')).toEqual([]);
	});

	it('refuses a total at or below zero, however it comes', () => {
		expect(submitProblems({ ...base(), discount: { kind: 'amount', amount: usd(10_000) } }, 'USD')).toEqual(['The total must be above zero.']);
		expect(submitProblems({ ...base(), discount: { kind: 'percent', percent: '100' } }, 'USD')).toEqual(['The total must be above zero.']);
		expect(submitProblems({ ...base(), lines: [line('l1', onShot('sh010'), usd(0))] }, 'USD')).toEqual(['The total must be above zero.']);
		expect(submitProblems({ ...base(), lines: [] }, 'USD')).toEqual(['The total must be above zero.']);
	});

	it('refuses a discount above the subtotal, with the total it makes', () => {
		expect(submitProblems({ ...base(), discount: { kind: 'amount', amount: usd(20_000) } }, 'USD')).toEqual([
			'The discount is more than the subtotal.',
			'The total must be above zero.'
		]);
	});

	it('refuses percents out of range, whatever the totals', () => {
		expect(submitProblems({ ...base(), discount: { kind: 'percent', percent: '150' } }, 'USD')).toContain('A discount is 100% at most.');
		expect(submitProblems({ ...base(), tax: { kind: 'percent', percent: '250' } }, 'USD')).toContain('A tax is 100% at most.');
		expect(submitProblems({ ...base(), rebate: [{ jurisdiction: 'GB', workPercent: '50', rate: '120', base: { kind: 'all' } }] }, 'USD')).toEqual([
			'GB, rate: 120% is over 100%.'
		]);
	});

	it('refuses a currency off the ISO list', () => {
		expect(submitProblems({ ...base(), currency: 'XYZ', lines: [line('l1', onShot('sh010'), money(10_000, 'XYZ'))] }, 'XYZ')).toEqual([
			'XYZ is not a currency on the ISO 4217 list.'
		]);
	});
});
