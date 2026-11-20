/**
 * What a bid must hold to be submitted, beyond its amounts being in its own currency
 * (`totals.checkBid`). Pure, no I/O.
 *
 * - The currency is on the ISO 4217 list (`currencies.ts`), not only three capitals.
 * - A discount percent is 0 to 100, a tax percent 0 to 100 (no rate anywhere is above that), the
 *   rebate's rates and shares 0 to 100 and the shares 100 at most in all (`rebate.validateSplits`).
 * - A discount amount is not more than the subtotal, and the grand total is above zero.
 *
 * The draft reader refuses the ranges at every save (`draft-input.ts`). The totals are checked at
 * submit only: a draft is saved as it is typed, and a discount may come before the prices.
 */

import { isCurrency } from './currencies';
import type { Adjustment, VendorBid } from './model';
import { comparePercent, isPercent } from './percent';
import { validateSplits } from './rebate';
import { bidTotals } from './totals';

export const MAX_DISCOUNT_PERCENT = '100';
export const MAX_TAX_PERCENT = '100';

function over(value: Adjustment | null, max: string): boolean {
	return value?.kind === 'percent' && (!isPercent(value.percent) || comparePercent(value.percent, max) > 0);
}

/** The ranges alone, which hold whatever the totals: discount, tax, rebate. */
export function rangeProblems(bid: Pick<VendorBid, 'discount' | 'tax' | 'rebate'>): string[] {
	const problems: string[] = [];
	if (over(bid.discount, MAX_DISCOUNT_PERCENT)) problems.push(`A discount is ${MAX_DISCOUNT_PERCENT}% at most.`);
	if (over(bid.tax, MAX_TAX_PERCENT)) problems.push(`A tax is ${MAX_TAX_PERCENT}% at most.`);
	return [...problems, ...validateSplits(bid.rebate)];
}

/** The totals: a discount within the subtotal, and a grand total above zero. Assumes `checkBid` passes. */
export function totalProblems(bid: VendorBid, base: string): string[] {
	const totals = bidTotals(bid, base);
	const problems: string[] = [];
	if (totals.discount.bid.minor > totals.subtotal.bid.minor) problems.push('The discount is more than the subtotal.');
	if (totals.grand.bid.minor <= 0) problems.push('The total must be above zero.');
	return problems;
}

/** Every reason the bid cannot be submitted, in words. Empty when it can. */
export function submitProblems(bid: VendorBid, base: string): string[] {
	if (!isCurrency(bid.currency)) return [`${bid.currency} is not a currency on the ISO 4217 list.`];
	const ranges = rangeProblems(bid);
	if (ranges.length > 0) return ranges;
	return totalProblems(bid, base);
}
