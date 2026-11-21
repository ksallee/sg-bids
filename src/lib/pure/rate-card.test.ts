import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { emptyForm, formFromBid, formToDraft, formTotals, setBidding, switchMode, type BidForm } from './bid-form';
import { asset, request, shot } from './fixtures';
import type { BidRequest } from './model';
import { add, money } from './money';
import { applyRates, difficultiesOf, hasPlainRows, lineSource, rateForm, setRate, typePrice, useRate } from './rate-card';

const TODAY = '2026-11-20';

const req = request({
	shots: [
		shot('sh010', { difficulty: 'Hard', package: 'p1' }),
		shot('sh020', { difficulty: 'Easy', package: 'p1' }),
		shot('sh030', { package: 'p1' }),
		shot('sh040', { difficulty: 'Hard', package: 'p2' }),
		shot('sh050', { difficulty: 'Hard', package: 'p1', omitted: true })
	],
	assets: [asset('tree', { difficulty: 'Easy', package: 'p2' })],
	packages: [
		{ id: 'p1', name: 'Bid 1' },
		{ id: 'p2', name: 'Hero' }
	]
});

const price = (form: BidForm, key: string) => form.lines.find((l) => l.key === key)!.price;

describe('the rate card', () => {
	it('offers one rate per difficulty in the vendor’s rows, in order, and one for rows with none', () => {
		const form = emptyForm(req, TODAY);
		expect(form.rates).toEqual({ tiers: [{ difficulty: 'Hard', price: '' }, { difficulty: 'Easy', price: '' }], fallback: '' });
		expect(difficultiesOf(form.lines)).toEqual(['Hard', 'Easy']);
		expect(hasPlainRows(form.lines)).toBe(true);
	});

	it('fills every line of its difficulty, and the rows with none from their rate, never an omitted row', () => {
		let form = setRate(emptyForm(req, TODAY), 'Hard', '1500');
		form = setRate(form, null, '400');
		expect([price(form, 'shot:sh010'), price(form, 'shot:sh020'), price(form, 'shot:sh030'), price(form, 'shot:sh040'), price(form, 'shot:sh050')]).toEqual(['1500', '', '400', '1500', '']);
		expect(lineSource(form, form.lines[0])).toBe('rate');
		expect(lineSource(form, form.lines[1])).toBe('none');
	});

	it('keeps a price the vendor typed as an override, through any rate change, until it uses the rate again', () => {
		let form = setRate(emptyForm(req, TODAY), 'Hard', '1500');
		form = typePrice(form, 'shot:sh010', '1800');
		expect(lineSource(form, form.lines[0])).toBe('override');
		form = setRate(form, 'Hard', '1600');
		expect([price(form, 'shot:sh010'), price(form, 'shot:sh040')]).toEqual(['1800', '1600']);
		form = useRate(form, 'shot:sh010');
		expect(price(form, 'shot:sh010')).toBe('1600');
		expect(lineSource(form, form.lines[0])).toBe('rate');
	});

	it('gives a line back to its rate when its typed price is cleared', () => {
		let form = typePrice(setRate(emptyForm(req, TODAY), 'Easy', '90'), 'shot:sh020', '120');
		form = typePrice(form, 'shot:sh020', '');
		expect(price(form, 'shot:sh020')).toBe('90');
	});

	it('fills no row of a bid priced as one figure or not bid on, and fills it again when it is back to row by row', () => {
		let form = setRate(emptyForm(req, TODAY), 'Hard', '1500');
		form = switchMode(form, 'p2', 'package');
		expect(price(form, 'shot:sh040')).toBe('');
		form = setRate(form, 'Hard', '1700');
		expect([price(form, 'shot:sh010'), price(form, 'shot:sh040')]).toEqual(['1700', '']);
		form = switchMode(form, 'p2', 'rows');
		expect(price(form, 'shot:sh040')).toBe('1700');
		form = setBidding(form, 'p1', false);
		expect(price(form, 'shot:sh010')).toBe('');
	});

	it('goes with the bid: lines from it marked, the card kept, and read back the same', () => {
		let form = setRate(setRate(emptyForm(req, TODAY), 'Hard', '1500'), null, '400');
		form = typePrice(form, 'shot:sh020', '80');
		const { draft, errors } = formToDraft(form, '.');
		expect(errors).toEqual({});
		expect(draft.rateCard).toEqual({ rates: [{ difficulty: 'Hard', amount: money(150_000, 'USD') }], fallback: money(40_000, 'USD') });
		expect(draft.lines.map((l) => [l.target.id, l.total.minor, l.fromRate === true])).toEqual([
			['sh010', 150_000, true],
			['sh020', 8_000, false],
			['sh030', 40_000, true],
			['sh040', 150_000, true]
		]);
		const back = formFromBid({ ...draft, lines: draft.lines.map((l, i) => ({ ...l, id: `l${i}` })) }, req, '.');
		expect(back.rates).toEqual(form.rates);
		expect(back.lines.map((l) => [l.key, l.price, l.typed])).toEqual(form.lines.map((l) => [l.key, l.price, l.typed]));
	});

	it('names a rate that does not read once, and leaves its lines not bid', () => {
		const form = setRate(emptyForm(req, TODAY), 'Hard', 'abc');
		const result = formToDraft(form, '.');
		expect(Object.keys(result.errors)).toEqual(['rate:0']);
		expect(result.problems.map((p) => p.label)).toContain('Your rate for Hard');
		expect(result.draft.lines).toEqual([]);
	});

	it('reads a line saved before rates as the vendor’s own', () => {
		const form = formFromBid(
			{ ...formToDraft(typePrice(emptyForm(req, TODAY), 'shot:sh010', '900'), '.').draft, lines: [{ id: 'l1', target: { kind: 'shot', id: 'sh010' }, total: money(90_000, 'USD'), excluded: false }] },
			req,
			'.'
		);
		expect(form.lines[0]).toMatchObject({ price: '900', typed: true });
		expect(rateForm(form.lines)).toEqual(form.rates);
	});
});

/* Property tests ------------------------------------------------------------ */

const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Hero'];

/** A request of up to 12 shots over two bids, each with a difficulty or none, some omitted. */
const requestArb = fc
	.array(fc.record({ difficulty: fc.option(fc.constantFrom(...DIFFICULTIES), { nil: undefined }), pkg: fc.constantFrom('p1', 'p2'), omitted: fc.boolean() }), { minLength: 1, maxLength: 12 })
	.map(
		(rows): BidRequest =>
			request({
				shots: rows.map((r, i) => shot(`sh${i}`, { difficulty: r.difficulty, package: r.pkg, omitted: r.omitted })),
				packages: [
					{ id: 'p1', name: 'Bid 1' },
					{ id: 'p2', name: 'Hero' }
				]
			})
	);

/** A price as a vendor types it: whole units, or units and cents. */
const priceArb = fc.oneof(
	fc.integer({ min: 0, max: 99_999 }).map(String),
	fc.tuple(fc.integer({ min: 0, max: 9_999 }), fc.integer({ min: 0, max: 99 })).map(([u, c]) => `${u}.${String(c).padStart(2, '0')}`)
);

type Step = { kind: 'rate'; difficulty: string | null; price: string } | { kind: 'type'; index: number; price: string } | { kind: 'use'; index: number } | { kind: 'mode'; pkg: string; mode: 'rows' | 'package' };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
	fc.record({ kind: fc.constant('rate' as const), difficulty: fc.option(fc.constantFrom(...DIFFICULTIES), { nil: null }), price: fc.oneof(priceArb, fc.constant('')) }),
	fc.record({ kind: fc.constant('type' as const), index: fc.nat(11), price: priceArb }),
	fc.record({ kind: fc.constant('use' as const), index: fc.nat(11) }),
	fc.record({ kind: fc.constant('mode' as const), pkg: fc.constantFrom('p1', 'p2'), mode: fc.constantFrom('rows' as const, 'package' as const) })
);

function play(form: BidForm, steps: readonly Step[]): BidForm {
	return steps.reduce((f, step) => {
		const line = f.lines[step.kind === 'type' || step.kind === 'use' ? step.index % f.lines.length : 0];
		if (step.kind === 'rate') return setRate(f, step.difficulty, step.price);
		if (step.kind === 'type') return typePrice(f, line.key, step.price);
		if (step.kind === 'use') return useRate(f, line.key);
		return switchMode(f, step.pkg, step.mode);
	}, form);
}

const formArb = fc.tuple(requestArb, fc.array(stepArb, { maxLength: 25 })).map(([r, steps]) => play(emptyForm(r, TODAY), steps));

describe('the rate card, for any rates and any edits', () => {
	it('sums its lines to the bid’s subtotal', () => {
		fc.assert(
			fc.property(formArb, (form) => {
				const { draft } = formToDraft(form, '.');
				const { totals } = formTotals(draft);
				const lines = draft.lines.filter((l) => !l.excluded).reduce((sum, l) => add(sum, l.total), money(0, 'USD'));
				expect(totals.subtotal.bid).toEqual(lines);
				expect(totals.lines.bid).toEqual(lines);
			}),
			{ numRuns: 300 }
		);
	});

	it('changes nothing when applied twice', () => {
		fc.assert(
			fc.property(formArb, (form) => {
				const once = applyRates(form);
				expect(applyRates(once)).toEqual(once);
			}),
			{ numRuns: 300 }
		);
	});

	it('never changes an override, whatever rate changes', () => {
		fc.assert(
			fc.property(formArb, fc.option(fc.constantFrom(...DIFFICULTIES), { nil: null }), fc.oneof(priceArb, fc.constant('')), (form, difficulty, next) => {
				const after = setRate(form, difficulty, next);
				form.lines.forEach((line, i) => {
					if (line.typed) expect(after.lines[i].price).toBe(line.price);
				});
			}),
			{ numRuns: 300 }
		);
	});

	it('fills every line not typed, where a rate may, with exactly its rate', () => {
		fc.assert(
			fc.property(formArb, (form) => {
				const { draft } = formToDraft(form, '.');
				for (const line of draft.lines.filter((l) => l.fromRate)) {
					const row = form.lines.find((l) => l.target.id === line.target.id)!;
					const rate = row.difficulty ? draft.rateCard?.rates.find((r) => r.difficulty === row.difficulty)?.amount : draft.rateCard?.fallback;
					expect(line.total).toEqual(rate);
				}
			}),
			{ numRuns: 300 }
		);
	});
});
