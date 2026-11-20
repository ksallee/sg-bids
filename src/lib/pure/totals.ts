/**
 * A vendor bid's totals, in the bid currency and in the request's base currency.
 *
 * Lines (excluded ones skipped) plus non-shot costs make the subtotal. The discount comes off the
 * subtotal, the tax goes on what is left. A percent discount or tax rounds half away from zero.
 *
 * Each base figure is its bid figure converted once at the bid's locked rate. So base figures may
 * not add up to the base grand total by a minor unit: the bid currency is the one that adds up.
 *
 * Every amount in a bid must be in the bid currency. Another currency is an error, never a silent
 * sum.
 */

import type { Adjustment, Dual, VendorBid } from './model';
import { add, convert, money, subtract, sum, type Money } from './money';
import { percentOf } from './percent';

export interface BidTotals {
	/** Lines, excluded ones skipped. */
	readonly lines: Dual;
	/** Non-shot costs: overhead, supervision, on-set, contingency. */
	readonly costs: Dual;
	/** Lines plus costs. */
	readonly subtotal: Dual;
	/** The discount, as a positive amount taken off. */
	readonly discount: Dual;
	readonly tax: Dual;
	/** Subtotal less discount plus tax. */
	readonly grand: Dual;
}

/** Throws unless every amount in the bid is in its currency and its rate converts it to `base`. */
export function checkBid(bid: VendorBid, base: string): void {
	const want = bid.currency;
	const check = (amount: Money | undefined, where: string) => {
		if (amount && amount.currency !== want) {
			throw new Error(`Bid ${bid.id} is in ${want}; ${where} is in ${amount.currency}.`);
		}
	};
	for (const line of bid.lines) {
		check(line.total, `line ${line.id}`);
		check(line.compute, `the compute of line ${line.id}`);
		check(line.markup, `the markup of line ${line.id}`);
		for (const department of line.departments ?? []) {
			check(department.cost, `the ${department.department} cost of line ${line.id}`);
		}
	}
	for (const cost of bid.costs) check(cost.amount, `the cost '${cost.label}'`);
	if (bid.discount?.kind === 'amount') check(bid.discount.amount, 'the discount');
	if (bid.tax?.kind === 'amount') check(bid.tax.amount, 'the tax');

	if (want === base) {
		if (bid.rate !== null) throw new Error(`Bid ${bid.id} is in the base currency ${base}; it takes no rate.`);
		return;
	}
	if (bid.rate === null) throw new Error(`Bid ${bid.id} is in ${want}; it needs a rate locked to ${base}.`);
	if (bid.rate.from !== want || bid.rate.to !== base) {
		throw new Error(`Bid ${bid.id} needs a rate from ${want} to ${base}; it has ${bid.rate.from} to ${bid.rate.to}.`);
	}
}

/** An amount of the bid in the base currency, at the bid's locked rate. Assumes `checkBid` passed. */
export function toBase(amount: Money, bid: VendorBid, base: string): Money {
	if (bid.currency === base) {
		if (amount.currency !== base) throw new Error(`The amount is in ${amount.currency}; the bid is in ${base}.`);
		return amount;
	}
	if (!bid.rate) throw new Error(`Bid ${bid.id} has no rate to ${base}.`);
	return convert(amount, bid.rate);
}

function adjustment(value: Adjustment | null, of: Money): Money {
	if (value === null) return money(0, of.currency);
	return value.kind === 'amount' ? value.amount : percentOf(of, value.percent);
}

export function bidTotals(bid: VendorBid, base: string): BidTotals {
	checkBid(bid, base);
	const live = bid.lines.filter((line) => !line.excluded);
	const lines = sum(
		live.map((line) => line.total),
		bid.currency
	);
	const costs = sum(
		bid.costs.map((cost) => cost.amount),
		bid.currency
	);
	const subtotal = add(lines, costs);
	const discount = adjustment(bid.discount, subtotal);
	const tax = adjustment(bid.tax, subtract(subtotal, discount));
	const grand = add(subtract(subtotal, discount), tax);
	const dual = (amount: Money): Dual => ({ bid: amount, base: toBase(amount, bid, base) });
	return {
		lines: dual(lines),
		costs: dual(costs),
		subtotal: dual(subtotal),
		discount: dual(discount),
		tax: dual(tax),
		grand: dual(grand)
	};
}
