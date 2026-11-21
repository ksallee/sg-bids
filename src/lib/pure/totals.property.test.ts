import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { answerArb } from './arbitraries';
import type { Adjustment, VendorBid } from './model';
import { targetKey } from './model';
import { add, convert, money, subtract, sum, type Money } from './money';
import { lineAmounts, resolvePackages } from './packages';
import { percentOf } from './percent';
import { bidTotals } from './totals';

const base = (b: { request: { header: { baseCurrency: string } } }) => b.request.header.baseCurrency;

function adjust(value: Adjustment | null, of: Money): Money {
	if (value === null) return money(0, of.currency);
	return value.kind === 'amount' ? value.amount : percentOf(of, value.percent);
}

/** What a package adds to the lines total: its figure, or its live rows' prices. */
function contribution(bid: VendorBid, packageOf: ReadonlyMap<string, string>, pkg: string): Money {
	const figure = bid.packages?.find((p) => p.package === pkg)?.total;
	if (figure) return figure;
	return sum(
		bid.lines.filter((l) => packageOf.get(targetKey(l.target)) === pkg && !l.excluded && !l.inPackage).map((l) => l.total),
		bid.currency
	);
}

describe('a bid’s totals, for any answer', () => {
	it('are lines plus one-figure bids plus non-shot costs, less the discount, plus the tax', () => {
		fc.assert(
			fc.property(answerArb(), (answer) => {
				const { bid } = answer;
				const totals = bidTotals(bid, base(answer));
				const lines = sum([...bid.lines.filter((l) => !l.excluded).map((l) => l.total), ...(bid.packages ?? []).map((p) => p.total)], bid.currency);
				const costs = sum(
					bid.costs.map((c) => c.amount),
					bid.currency
				);
				const subtotal = add(lines, costs);
				const discount = adjust(bid.discount, subtotal);
				const tax = adjust(bid.tax, subtract(subtotal, discount));
				expect(totals.lines.bid).toEqual(lines);
				expect(totals.costs.bid).toEqual(costs);
				expect(totals.subtotal.bid).toEqual(subtotal);
				expect(totals.discount.bid).toEqual(discount);
				expect(totals.tax.bid).toEqual(tax);
				expect(totals.grand.bid).toEqual(add(subtract(subtotal, discount), tax));
			})
		);
	});

	it('converts each figure once, at the bid’s locked rate', () => {
		fc.assert(
			fc.property(answerArb(), (answer) => {
				const { bid } = answer;
				const totals = bidTotals(bid, base(answer));
				for (const dual of Object.values(totals)) {
					expect(dual.base).toEqual(bid.rate ? convert(dual.bid, bid.rate) : dual.bid);
				}
			})
		);
	});

	it('takes a declined bid’s rows and figure out of the lines, and nothing else', () => {
		const arb = answerArb().filter(({ request, bid }) => {
			const answered = resolvePackages(request).packages.filter((p) => !bid.declined?.includes(p.id) && (bid.lines.length > 0 || bid.packages?.length));
			return !resolvePackages(request).implicit && answered.length >= 2;
		});
		fc.assert(
			fc.property(arb, fc.nat(), (answer, n) => {
				const { request, bid } = answer;
				const resolved = resolvePackages(request);
				const answered = resolved.packages.map((p) => p.id).filter((id) => !bid.declined?.includes(id));
				const pkg = answered[n % answered.length];
				const declined: VendorBid = {
					...bid,
					lines: bid.lines.filter((l) => resolved.of.get(targetKey(l.target)) !== pkg),
					packages: bid.packages?.filter((p) => p.package !== pkg),
					declined: [...(bid.declined ?? []), pkg]
				};
				const before = bidTotals(bid, base(answer));
				const after = bidTotals(declined, base(answer));
				expect(after.lines.bid).toEqual(subtract(before.lines.bid, contribution(bid, resolved.of, pkg)));
				expect(after.costs).toEqual(before.costs);
			})
		);
	});

	it('never grows when a row is excluded', () => {
		const arb = answerArb().filter(({ bid }) => bid.lines.some((l) => !l.excluded && !l.inPackage));
		fc.assert(
			fc.property(arb, fc.nat(), (answer, n) => {
				const { bid } = answer;
				const priced = bid.lines.filter((l) => !l.excluded && !l.inPackage);
				const out = priced[n % priced.length];
				const excluded: VendorBid = { ...bid, lines: bid.lines.map((l) => (l === out ? { ...l, excluded: true } : l)) };
				const before = bidTotals(bid, base(answer));
				const after = bidTotals(excluded, base(answer));
				expect(after.grand.bid.minor).toBeLessThanOrEqual(before.grand.bid.minor);
				expect(after.grand.base.minor).toBeLessThanOrEqual(before.grand.base.minor);
			})
		);
	});
});

describe('a bid priced as one figure, for any answer', () => {
	it('shares its figure over its rows exactly, in the bid currency and in the base currency', () => {
		const arb = answerArb().filter(({ bid }) => (bid.packages ?? []).length > 0);
		fc.assert(
			fc.property(arb, (answer) => {
				const { request, bid } = answer;
				const resolved = resolvePackages(request);
				const amounts = lineAmounts(request, bid, base(answer));
				for (const price of bid.packages ?? []) {
					const rows = (resolved.live.get(price.package) ?? []).map((t) => amounts.get(targetKey(t))!);
					if (rows.length === 0) continue;
					const converted = bid.rate ? convert(price.total, bid.rate) : price.total;
					expect(sum(
						rows.map((r) => r.bid),
						bid.currency
					)).toEqual(price.total);
					expect(sum(
						rows.map((r) => r.base!),
						base(answer)
					)).toEqual(converted);
				}
			})
		);
	});
});
