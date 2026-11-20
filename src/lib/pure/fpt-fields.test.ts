import { describe, expect, it } from 'vitest';
import { BID, BID_FIELDS, LINE, LINE_FIELDS, fieldName, linkTypes, sameCurrency, toFptCurrency } from './fpt-fields';
import { money } from './money';

describe('fieldName', () => {
	it('follows the site rule for ASCII display names (117)', () => {
		expect(fieldName('zzprobe 117 currency')).toBe('sg_zzprobe_117_currency');
		expect(fieldName('zzprobe 117 a--b..c!!d  e_f')).toBe('sg_zzprobe_117_a__b__c__d__e_f');
		expect(fieldName('  zzprobe 117 spaces  ')).toBe('sg___zzprobe_117_spaces__');
		expect(fieldName('117 zzprobe digit')).toBe('sg_117_zzprobe_digit');
	});

	it('gives no name for a non-ASCII display name: the site names it sg_<data_type>', () => {
		expect(fieldName('Durée')).toBeNull();
	});
});

describe('the field set', () => {
	for (const [label, fields] of [
		['Bid', BID_FIELDS],
		['Bid Line', LINE_FIELDS]
	] as const) {
		it(`${label}: every custom field's name is the one its display name derives`, () => {
			for (const f of fields.filter((f) => !f.stock)) expect(f.name).toBe(fieldName(f.display));
		});

		it(`${label}: no two fields share a name or a key`, () => {
			expect(new Set(fields.map((f) => f.name)).size).toBe(fields.length);
			expect(new Set(fields.map((f) => f.key)).size).toBe(fields.length);
		});

		it(`${label}: no field takes a probe's name`, () => {
			expect(fields.filter((f) => f.name.startsWith('sg_zzprobe'))).toEqual([]);
		});

		it(`${label}: entity fields name their targets, others none`, () => {
			for (const f of fields) expect(f.validTypes !== undefined).toBe(f.dataType === 'entity');
		});
	}

	it('keeps the code beside every amount', () => {
		expect(BID.total).toBe('sg_total');
		expect(BID.currency).toBe('sg_currency');
		expect(BID.totalBase).toBe('sg_total_base');
		expect(BID.baseCurrency).toBe('sg_base_currency');
		expect(LINE.amount).toBe('sg_amount');
		expect(LINE.currency).toBe('sg_currency');
	});

	it('holds a share as a float: percent and number take whole numbers only', () => {
		expect(LINE_FIELDS.find((f) => f.key === 'share')?.dataType).toBe('float');
	});

	it('links a line to the Bid slot, the Shot or Asset, and a Bid to a Group', () => {
		expect(linkTypes(LINE_FIELDS.find((f) => f.key === 'bid')!.validTypes!, 'CustomEntity14')).toEqual(['CustomEntity14']);
		expect(LINE_FIELDS.find((f) => f.key === 'item')!.validTypes).toEqual(['Shot', 'Asset']);
		expect(BID_FIELDS.find((f) => f.key === 'vendor')!.validTypes).toEqual(['Group']);
	});
});

describe('toFptCurrency', () => {
	it('writes a two-digit currency as is, always with a point', () => {
		expect(toFptCurrency(money(123456, 'USD'))).toEqual({ value: '1234.56', lost: null });
		expect(toFptCurrency(money(5, 'USD'))).toEqual({ value: '0.05', lost: null });
		expect(toFptCurrency(money(0, 'EUR'))).toEqual({ value: '0.00', lost: null });
		expect(toFptCurrency(money(-9999, 'GBP'))).toEqual({ value: '-99.99', lost: null });
	});

	it('writes a zero-digit currency in whole units', () => {
		expect(toFptCurrency(money(1500, 'JPY'))).toEqual({ value: '1500.0', lost: null });
	});

	it('rounds a three-digit currency half away from zero and says what was lost', () => {
		expect(toFptCurrency(money(12345, 'KWD'))).toEqual({ value: '12.35', lost: { minor: -5, currency: 'KWD' } });
		expect(toFptCurrency(money(12344, 'KWD'))).toEqual({ value: '12.34', lost: { minor: 4, currency: 'KWD' } });
		expect(toFptCurrency(money(12340, 'BHD'))).toEqual({ value: '12.34', lost: null });
		expect(toFptCurrency(money(-12345, 'KWD'))).toEqual({ value: '-12.35', lost: { minor: 5, currency: 'KWD' } });
	});

	it('rounds a four-digit currency to two', () => {
		expect(toFptCurrency(money(123456, 'CLF'))).toEqual({ value: '12.35', lost: { minor: -44, currency: 'CLF' } });
	});
});

describe('sameCurrency', () => {
	it('matches the string the site reads back and the number _summarize answers', () => {
		expect(sameCurrency('1234.5', '1234.50')).toBe(true);
		expect(sameCurrency('1500.0', '1500.0')).toBe(true);
		expect(sameCurrency(2000, '2000.00')).toBe(true);
		expect(sameCurrency('12.34', '12.35')).toBe(false);
	});

	it('matches null with null only', () => {
		expect(sameCurrency(null, null)).toBe(true);
		expect(sameCurrency('0.0', null)).toBe(false);
		expect(sameCurrency(null, '0.00')).toBe(false);
	});
});
