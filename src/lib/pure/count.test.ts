import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canCount, countLock, countOf, countProblems, extend, framesOf, isCount, isCounted, MAX_COUNT, parseCount, unitsLine, withCount } from './count';
import { money } from './money';

describe('the count of a row', () => {
	it('is 1 when absent, and for a row linked to Flow PT whatever it holds', () => {
		expect(countOf({})).toBe(1);
		expect(countOf({ count: 120 })).toBe(120);
		expect(countOf({ count: 120, fpt: { type: 'Shot', id: 7 } })).toBe(1);
		expect(isCounted({ count: 2 })).toBe(true);
		expect(isCounted({ count: 1 })).toBe(false);
	});

	it('reads a stored count that does not hold as 1', () => {
		for (const bad of [0, -3, 1.5, MAX_COUNT + 1, Number.NaN]) expect(countOf({ count: bad })).toBe(1);
	});

	it('belongs to rows in this request only', () => {
		expect(canCount({})).toBe(true);
		expect(canCount({ fpt: { type: 'Asset', id: 1 } })).toBe(false);
		expect(countLock('shot')).toBe('This row is one Shot in Flow PT. Its count is 1.');
	});

	it('reads as typed: blank is 1, a whole number from 1, no more than the cap', () => {
		expect(parseCount('')).toEqual({ value: 1 });
		expect(parseCount(null)).toEqual({ value: 1 });
		expect(parseCount(' 120 ')).toEqual({ value: 120 });
		expect(parseCount(40)).toEqual({ value: 40 });
		expect(parseCount('0')).toEqual({ error: 'A count is 1 at least.' });
		expect(parseCount(2.5)).toEqual({ error: 'A count is a whole number.' });
		expect(parseCount('ten')).toEqual({ error: 'A count is a whole number.' });
		expect(parseCount(MAX_COUNT + 1)).toEqual({ error: 'A count is 100,000 at most.' });
		expect(isCount(MAX_COUNT)).toBe(true);
	});

	it('is set on a row, and 1 leaves the field off', () => {
		expect(withCount({ id: 'a' }, 120)).toEqual({ id: 'a', count: 120 });
		expect(withCount({ id: 'a', count: 120 }, 1)).toEqual({ id: 'a' });
		expect(withCount({ id: 'a', fpt: { type: 'Shot', id: 1 } }, 5)).toEqual({ id: 'a', fpt: { type: 'Shot', id: 1 } });
		expect(() => withCount({ id: 'a' }, 0)).toThrow();
	});

	it('takes frames per unit: the row in all is frames times count', () => {
		expect(framesOf({ frames: 80, count: 120 })).toBe(9600);
		expect(framesOf({ frames: 80 })).toBe(80);
		expect(framesOf({ count: 3 })).toBeUndefined();
	});

	it('says shots in rows where they differ', () => {
		expect(unitsLine(170, 3, 'shot')).toBe('170 shots in 3 rows');
		expect(unitsLine(3, 3, 'shot')).toBe('3 shots');
		expect(unitsLine(1, 1, 'asset')).toBe('1 asset');
		expect(unitsLine(12, 1, 'asset')).toBe('12 assets in 1 row');
	});
});

describe('a unit price times a count', () => {
	it('is exact in whole minor units', () => {
		expect(extend(money(150_000, 'USD'), 120)).toEqual(money(18_000_000, 'USD'));
		expect(extend(money(1, 'JPY'), 1)).toEqual(money(1, 'JPY'));
	});

	it('refuses a total past a safe integer, and a count out of range', () => {
		expect(() => extend(money(Number.MAX_SAFE_INTEGER, 'USD'), 2)).toThrow('too large');
		expect(() => extend(money(1, 'USD'), 0)).toThrow();
	});

	it('is the unit times the count for any values in range (property)', () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 90_000_000_000 }), fc.integer({ min: 1, max: MAX_COUNT }), (unit, count) => {
				const total = extend(money(unit, 'USD'), count);
				expect(BigInt(total.minor)).toBe(BigInt(unit) * BigInt(count));
				expect(total.currency).toBe('USD');
			})
		);
	});

	it('of count 1 is the unit itself (property)', () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (unit) => {
				expect(extend(money(unit, 'EUR'), 1)).toEqual(money(unit, 'EUR'));
			})
		);
	});
});

describe('the lines against the counts', () => {
	const rows = [
		{ key: 'shot:a', label: 'SIMPLE', count: 120 },
		{ key: 'shot:b', label: 'SH010', count: 1 }
	];
	const line = (id: string, total: number, extra: object = {}) => ({ target: { kind: 'shot' as const, id }, total: money(total, 'USD'), excluded: false, ...extra });

	it('holds a counted line with its unit price and a row of 1 without one', () => {
		expect(countProblems(rows, [line('a', 18_000_000, { unit: money(150_000, 'USD') }), line('b', 5000)])).toEqual([]);
	});

	it('names a counted line with no unit price, a total that is not the product, and a unit on a row of 1', () => {
		expect(countProblems(rows, [line('a', 18_000_000)])).toEqual(['SIMPLE stands for 120. Its line needs its unit price. Reload the page.']);
		expect(countProblems(rows, [line('a', 18_000_001, { unit: money(150_000, 'USD') })])).toEqual(['SIMPLE: the line total is not its unit price times 120. Reload the page.']);
		expect(countProblems(rows, [line('b', 5000, { unit: money(5000, 'USD') })])).toEqual(['SH010 is not priced per unit. Reload the page.']);
		expect(countProblems(rows, [line('a', 18_000_000, { unit: money(150_000, 'EUR') })])).toEqual(['SIMPLE: the unit price is in EUR, the line in USD.']);
	});

	it('lets an excluded counted row with no price go as a zero, and a line in a figure carry no unit', () => {
		expect(countProblems(rows, [line('a', 0, { excluded: true })])).toEqual([]);
		expect(countProblems(rows, [line('a', 0, { inPackage: true })])).toEqual([]);
		expect(countProblems(rows, [line('a', 0, { inPackage: true, unit: money(1, 'USD') })])).toHaveLength(1);
	});
});
