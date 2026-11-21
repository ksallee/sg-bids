/**
 * The estimated rebate of a vendor bid. Several jurisdictions per bid, at bid level. Always an
 * estimate: the vendor quotes gross, and the rates are what the user typed.
 *
 * Each split earns `base × share of the work × rate`, rounded once, half away from zero. The base:
 *
 * - `all`: the bid before tax, discount taken off.
 * - `contract`: a fixed percent of that, as Quebec's 65% of a service contract.
 * - `labour`: each live line's total less its compute, plus the non-shot costs marked labour. The
 *   discount is not taken off. A line's labour is known only when it has department detail. When
 *   a live line has none, the split's base and rebate are null and the result says which lines.
 *   The total rebate and the total after rebate are then null too: an unknown is not a zero. A
 *   package priced as one figure carries no detail, so its labour is unknown the same way.
 *
 * Splits may cover less than 100% of the work. The rest earns nothing. Over 100% is an error.
 */

import type { Dual, Id, Percent, RebateSplit, VendorBid } from './model';
import { money, subtract, sum, type Money } from './money';
import { comparePercent, isPercent, percentOf, sumPercents } from './percent';
import { bidTotals, toBase } from './totals';

export interface SplitEstimate {
	readonly split: RebateSplit;
	/** The base in the bid currency, before the share of the work. Null when unknown. */
	readonly base: Money | null;
	readonly rebate: Dual | null;
}

export interface RebateEstimate {
	/** The bid's grand total. */
	readonly gross: Dual;
	readonly splits: readonly SplitEstimate[];
	/** Null when a split is unknown. */
	readonly rebate: Dual | null;
	/** Gross less rebate. Null when a split is unknown. */
	readonly afterRebate: Dual | null;
	/** The share of the work the splits cover. */
	readonly coveredPercent: Percent;
	/** A split has a labour base and a live line has no department detail. */
	readonly labourDetailMissing: boolean;
	/**
	 * The live lines with no department detail, and each package figure as `package:<id>`. Empty
	 * unless a split has a labour base.
	 */
	readonly linesWithoutDetail: readonly Id[];
}

/** Every problem with the splits, in words. Empty when they are fine. */
export function validateSplits(splits: readonly RebateSplit[]): string[] {
	const errors: string[] = [];
	const percentUpTo100 = (text: string, what: string) => {
		if (!isPercent(text)) errors.push(`${what}: '${text}' is not a percent.`);
		else if (comparePercent(text, '100') > 0) errors.push(`${what}: ${text}% is over 100%.`);
	};
	for (const [index, split] of splits.entries()) {
		const name = split.jurisdiction || `Split ${index + 1}`;
		if (!split.jurisdiction.trim()) errors.push(`Split ${index + 1} has no jurisdiction.`);
		percentUpTo100(split.workPercent, `${name}, share of the work`);
		percentUpTo100(split.rate, `${name}, rate`);
		if (split.base.kind === 'contract') percentUpTo100(split.base.percent, `${name}, share of the contract`);
	}
	const shares = splits.map((s) => s.workPercent);
	if (shares.every(isPercent) && comparePercent(sumPercents(shares), '100') > 0) {
		errors.push(`The splits cover ${sumPercents(shares)}% of the work; 100% at most.`);
	}
	return errors;
}

export function estimateRebate(bid: VendorBid, baseCurrency: string): RebateEstimate {
	const errors = validateSplits(bid.rebate);
	if (errors.length > 0) throw new Error(errors.join(' '));

	const totals = bidTotals(bid, baseCurrency);
	const beforeTax = subtract(totals.subtotal.bid, totals.discount.bid);
	const dual = (amount: Money): Dual => ({ bid: amount, base: toBase(amount, bid, baseCurrency) });

	// A row in a package price has its labour in the figure, which carries no department detail.
	const live = bid.lines.filter((line) => !line.excluded && !line.inPackage);
	const hasLabourSplit = bid.rebate.some((split) => split.base.kind === 'labour');
	const withoutDetail = hasLabourSplit
		? [...live.filter((line) => !line.departments?.length).map((line) => line.id), ...(bid.packages ?? []).map((p) => `package:${p.package}`)]
		: [];
	const labour =
		withoutDetail.length > 0
			? null
			: sum(
					[
						...live.map((line) => subtract(line.total, line.compute ?? money(0, bid.currency))),
						...bid.costs.filter((cost) => cost.labour).map((cost) => cost.amount)
					],
					bid.currency
				);

	const splits = bid.rebate.map((split): SplitEstimate => {
		if (split.base.kind === 'contract') {
			// From the bid before tax, so the rebate rounds once.
			const rebate = percentOf(beforeTax, split.base.percent, split.workPercent, split.rate);
			return { split, base: percentOf(beforeTax, split.base.percent), rebate: dual(rebate) };
		}
		const base = split.base.kind === 'all' ? beforeTax : labour;
		const rebate = base === null ? null : dual(percentOf(base, split.workPercent, split.rate));
		return { split, base, rebate };
	});

	const known = splits.every((s) => s.rebate !== null);
	const rebate = known
		? sum(
				splits.map((s) => s.rebate!.bid),
				bid.currency
			)
		: null;

	return {
		gross: totals.grand,
		splits,
		rebate: rebate && dual(rebate),
		afterRebate: rebate && dual(subtract(totals.grand.bid, rebate)),
		coveredPercent: sumPercents(bid.rebate.map((s) => s.workPercent)),
		labourDetailMissing: withoutDetail.length > 0,
		linesWithoutDetail: withoutDetail
	};
}
