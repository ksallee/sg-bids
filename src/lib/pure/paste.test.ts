import { describe, expect, it } from 'vitest';
import { pasteCells, planPaste } from './paste';

describe('pasteCells', () => {
	it('splits rows on any line break and cells on tabs', () => {
		expect(pasteCells('1\r\n2\n3\r4')).toEqual([['1'], ['2'], ['3'], ['4']]);
		expect(pasteCells('SH010\t1200\nSH020\t900')).toEqual([
			['SH010', '1200'],
			['SH020', '900']
		]);
	});

	it('drops the one trailing line break a spreadsheet adds', () => {
		expect(pasteCells('1\n2\n')).toEqual([['1'], ['2']]);
		expect(pasteCells('1\r\n\r\n')).toEqual([['1'], ['']]);
	});

	it('keeps a blank row in the middle: it lines up with a row', () => {
		expect(pasteCells('1\n\n3')).toEqual([['1'], [''], ['3']]);
	});

	it('reads a quoted cell as a spreadsheet writes it', () => {
		expect(pasteCells('"1,200"\n"note ""x"""')).toEqual([['1,200'], ['note "x"']]);
	});
});

const order = ['shot:a', 'shot:b', 'shot:c', 'shot:d'];
const codes = new Map([
	['SH010', 'shot:a'],
	['SH020', 'shot:b'],
	['SH030', 'shot:c'],
	['SH040', 'shot:d']
]);
const plan = (text: string, start = 'shot:a', mark: '.' | ',' = '.') => planPaste(text, { start, order, codes, currency: 'USD', mark });

describe('planPaste, a column', () => {
	it('is null for a single value: the input takes it as typed', () => {
		expect(plan('1200')).toBeNull();
		expect(plan('1200\n')).toBeNull();
	});

	it('fills down from the cell pasted into, in the order shown', () => {
		const result = plan('1,200\n900.5\n0', 'shot:b');
		expect(result?.mode).toBe('column');
		expect(result?.updates).toEqual([
			{ key: 'shot:b', price: '1200' },
			{ key: 'shot:c', price: '900.5' },
			{ key: 'shot:d', price: '0' }
		]);
		expect(result?.overflow).toBe(0);
		expect(result?.errors).toEqual([]);
	});

	it('counts rows past the last shot and fills none of them', () => {
		const result = plan('1\n2\n3', 'shot:c');
		expect(result?.updates.map((u) => u.key)).toEqual(['shot:c', 'shot:d']);
		expect(result?.overflow).toBe(1);
	});

	it('writes prices with the locale’s mark', () => {
		expect(plan('1.234,5\n2,5', 'shot:a', ',')?.updates).toEqual([
			{ key: 'shot:a', price: '1234,5' },
			{ key: 'shot:b', price: '2,5' }
		]);
	});

	it('clears a blank cell, marks "excluded", and reports a bad cell without stopping', () => {
		const result = plan('100\n\nExcluded\nabc');
		expect(result?.updates).toEqual([
			{ key: 'shot:a', price: '100' },
			{ key: 'shot:b', price: '' },
			{ key: 'shot:c', excluded: true }
		]);
		expect(result?.errors).toEqual([{ row: 4, text: 'abc', message: 'Not a number.' }]);
	});

	it('takes the first cell of each row when there are several and no codes', () => {
		expect(plan('100\tfoo\n200\tbar')?.updates).toEqual([
			{ key: 'shot:a', price: '100' },
			{ key: 'shot:b', price: '200' }
		]);
	});
});

describe('planPaste, code and price', () => {
	it('matches rows by code when every row starts with a known code, wherever it was pasted', () => {
		const result = plan('SH030\t1500\nsh010\t$2,000.00\n', 'shot:d');
		expect(result?.mode).toBe('codes');
		expect(result?.updates).toEqual([
			{ key: 'shot:c', price: '1500' },
			{ key: 'shot:a', price: '2000' }
		]);
	});

	it('skips a header row and reports unknown codes', () => {
		const result = plan('Shot\tPrice\nSH020\t10\nSH999\t20\nSH040\t30');
		expect(result?.mode).toBe('codes');
		expect(result?.updates).toEqual([
			{ key: 'shot:b', price: '10' },
			{ key: 'shot:d', price: '30' }
		]);
		expect(result?.unknown).toEqual(['SH999']);
	});

	it('uses the last cell of a row as the price', () => {
		expect(plan('SH010\tComp\t1200\nSH020\tFX\t800')?.updates).toEqual([
			{ key: 'shot:a', price: '1200' },
			{ key: 'shot:b', price: '800' }
		]);
	});

	it('falls back to a column when too few rows start with a code', () => {
		expect(plan('1\tSH010\n2\tSH020')?.mode).toBe('column');
	});
});
