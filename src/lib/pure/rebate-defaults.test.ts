import { describe, expect, it } from 'vitest';
import { comparePercent, isPercent } from './percent';
import { REBATE_DEFAULTS, rebateDefault } from './rebate-defaults';

describe('REBATE_DEFAULTS', () => {
	it('holds the eight researched jurisdictions, once each', () => {
		const codes = REBATE_DEFAULTS.map((entry) => entry.code);
		expect(codes).toEqual(['GB', 'CA', 'CA-BC', 'CA-QC', 'CA-ON', 'AU', 'FR', 'NZ']);
		expect(new Set(codes).size).toBe(codes.length);
	});

	it('gives every entry a source URL, the date checked and a base', () => {
		for (const entry of REBATE_DEFAULTS) {
			expect(entry.source, entry.code).toMatch(/^https:\/\/\S+$/);
			expect(entry.checked, entry.code).toBe('2026-11-20');
			expect(['all', 'labour', 'contract'], entry.code).toContain(entry.base.kind);
			expect(entry.label.length, entry.code).toBeGreaterThan(0);
			expect(['production', 'vendor', 'either'], entry.code).toContain(entry.claimedBy);
		}
	});

	it('writes every rate as a percent of 100 or less, starting with one base rate', () => {
		for (const entry of REBATE_DEFAULTS) {
			expect(entry.rates.length, entry.code).toBeGreaterThan(0);
			expect(entry.rates[0].kind, entry.code).toBe('base');
			for (const component of entry.rates) {
				expect(isPercent(component.rate), entry.code).toBe(true);
				expect(comparePercent(component.rate, '100'), entry.code).toBeLessThanOrEqual(0);
			}
		}
	});

	it('keeps stacked rates as components, never one combined number', () => {
		const rates = (code: string) => rebateDefault(code)?.rates.map((r) => [r.kind, r.rate]);
		expect(rates('CA-BC')).toEqual([['base', '36'], ['uplift', '16']]);
		expect(rates('CA-QC')).toEqual([['base', '25'], ['uplift', '16']]);
		expect(rates('FR')).toEqual([['base', '30'], ['instead', '40']]);
		expect(rates('NZ')).toEqual([['base', '20'], ['uplift', '5']]);
	});

	it('carries the researched rates, bases and claimants', () => {
		const summary = REBATE_DEFAULTS.map((e) => [e.code, e.rates[0].rate, e.base, e.claimedBy]);
		expect(summary).toEqual([
			['GB', '39', { kind: 'all' }, 'production'],
			['CA', '16', { kind: 'labour' }, 'production'],
			['CA-BC', '36', { kind: 'labour' }, 'production'],
			['CA-QC', '25', { kind: 'contract', percent: '65' }, 'production'],
			['CA-ON', '18', { kind: 'labour' }, 'vendor'],
			['AU', '30', { kind: 'all' }, 'either'],
			['FR', '30', { kind: 'all' }, 'production'],
			['NZ', '20', { kind: 'all' }, 'either']
		]);
	});
});

describe('rebateDefault', () => {
	it('finds an entry by code, or nothing', () => {
		expect(rebateDefault('CA-ON')?.label).toMatch(/OCASE/);
		expect(rebateDefault('XX')).toBeUndefined();
	});
});
