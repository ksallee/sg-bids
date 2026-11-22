import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { answerArb } from './arbitraries';
import type { VendorBid } from './model';
import { convert, subtract, sum, type Money } from './money';
import { estimateRebate } from './rebate';

const inBase = (bid: VendorBid, amount: Money) => (bid.rate ? convert(amount, bid.rate) : amount);

describe('a rebate estimate, for any answer', () => {
	it('reports the sum of its splits’ estimates as the rebate', () => {
		fc.assert(
			fc.property(answerArb(), ({ request, bid }) => {
				const estimate = estimateRebate(bid, request.header.baseCurrency);
				if (estimate.rebate === null) {
					expect(estimate.splits.some((s) => s.rebate === null)).toBe(true);
					expect(estimate.afterRebate).toBeNull();
					return;
				}
				expect(estimate.rebate.bid).toEqual(
					sum(
						estimate.splits.map((s) => s.rebate!.bid),
						bid.currency
					)
				);
				expect(estimate.rebate.base).toEqual(inBase(bid, estimate.rebate.bid));
			})
		);
	});

	it('gives the total after rebate as the total less the rebate, exactly', () => {
		fc.assert(
			fc.property(answerArb(), ({ request, bid }) => {
				const estimate = estimateRebate(bid, request.header.baseCurrency);
				if (estimate.rebate === null || estimate.afterRebate === null) return;
				expect(estimate.afterRebate.bid).toEqual(subtract(estimate.gross.bid, estimate.rebate.bid));
				expect(estimate.afterRebate.base).toEqual(inBase(bid, estimate.afterRebate.bid));
			})
		);
	});

	it('is never negative, split by split', () => {
		fc.assert(
			fc.property(answerArb({ maxRebateRate: 100 }), ({ request, bid }) => {
				const estimate = estimateRebate(bid, request.header.baseCurrency);
				for (const split of estimate.splits) if (split.rebate) expect(split.rebate.bid.minor).toBeGreaterThanOrEqual(0);
				if (estimate.rebate) expect(estimate.rebate.bid.minor).toBeGreaterThanOrEqual(0);
			})
		);
	});

	// With rates at 50% at most, rounding each split cannot take the rebate past the bid before tax.
	// A labour base keeps the discount in (rebate.ts), so a labour split beside a discount may.
	it('never leaves the total after rebate below zero, at rates up to 50%, unless a labour split meets a discount', () => {
		const arb = answerArb({ maxRebateRate: 50 }).filter(({ bid }) => !(bid.discount && bid.rebate.some((s) => s.base.kind === 'labour')));
		fc.assert(
			fc.property(arb, ({ request, bid }) => {
				const estimate = estimateRebate(bid, request.header.baseCurrency);
				if (estimate.afterRebate) expect(estimate.afterRebate.bid.minor).toBeGreaterThanOrEqual(0);
			})
		);
	});

	it('earns nothing on a split with 0% of the work or a 0% rate', () => {
		const arb = fc.tuple(
			answerArb().filter(({ bid }) => bid.rebate.length > 0),
			fc.nat(),
			fc.constantFrom('workPercent' as const, 'rate' as const)
		);
		fc.assert(
			fc.property(arb, ([{ request, bid }, n, field]) => {
				const at = n % bid.rebate.length;
				const zeroed: VendorBid = { ...bid, rebate: bid.rebate.map((s, i) => (i === at ? { ...s, [field]: '0' } : s)) };
				const split = estimateRebate(zeroed, request.header.baseCurrency).splits[at];
				if (split.rebate) expect(split.rebate.bid.minor).toBe(0);
			})
		);
	});
});
