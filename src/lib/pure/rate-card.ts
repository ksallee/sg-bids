/**
 * The vendor's rate card, in the bid form: a price per difficulty that appears in its rows, and one
 * for rows with no difficulty. Pure, no I/O.
 *
 * - A line follows its rate until the vendor types its own price there: then it is an override, and
 *   stays as typed whatever the rates do. Using the rate again puts it back.
 * - A rate fills the lines of bids priced row by row, not omitted. A bid priced as one figure, or not
 *   bid on, takes none.
 * - Changing a rate changes every line that follows it, and no override.
 * - Every total, the comparison, the award and Flow PT read the lines' amounts, as before: a line
 *   filled from a rate goes as its amount, marked `fromRate`, and the card goes with the bid.
 */

import type { BidForm, LineForm } from './bid-form';
import type { Id, RateCard } from './model';
import { showAmount, type DecimalMark } from './amount';
import { toDecimal } from './money';

export interface RateTier {
	readonly difficulty: string;
	/** As typed. */
	readonly price: string;
}

export interface RateForm {
	/** One per difficulty that appears in the vendor's rows, in the order they first appear. */
	readonly tiers: readonly RateTier[];
	/** For a row with no difficulty, as typed. */
	readonly fallback: string;
}

/** The difficulties of the lines, each once, in the order they first appear. */
export function difficultiesOf(lines: readonly Pick<LineForm, 'difficulty' | 'omitted'>[]): string[] {
	const out: string[] = [];
	for (const line of lines) {
		const d = line.difficulty?.trim();
		if (!line.omitted && d && !out.includes(d)) out.push(d);
	}
	return out;
}

/** A card with no price, one tier per difficulty of the lines. A saved card's prices are kept. */
export function rateForm(lines: readonly Pick<LineForm, 'difficulty' | 'omitted'>[], saved?: RateCard, mark: DecimalMark = '.'): RateForm {
	const shown = (minor: RateCard['fallback']) => (minor ? showAmount(toDecimal(minor), mark) : '');
	return {
		tiers: difficultiesOf(lines).map((difficulty) => ({ difficulty, price: shown(saved?.rates.find((r) => r.difficulty === difficulty)?.amount) })),
		fallback: shown(saved?.fallback)
	};
}

/** Some line of the vendor's has no difficulty: the card offers a price for those. */
export function hasPlainRows(lines: readonly Pick<LineForm, 'difficulty' | 'omitted'>[]): boolean {
	return lines.some((l) => !l.omitted && !l.difficulty?.trim());
}

/** Whether a rate may fill the line: in a bid priced row by row and bid on, and not omitted. */
export function rateable(form: Pick<BidForm, 'packages'>, line: LineForm): boolean {
	if (line.omitted) return false;
	const packages = form.packages ?? [];
	if (packages.length === 0) return true;
	const pkg = packages.find((p) => p.id === (line.package ?? 'all'));
	return pkg === undefined || (pkg.bidding && pkg.mode === 'rows');
}

/** The rate as typed for a line: its difficulty's, or the one for rows with none. Blank when none is set. */
export function rateText(rates: RateForm, difficulty: string | undefined): string {
	const d = difficulty?.trim();
	if (d) return rates.tiers.find((t) => t.difficulty === d)?.price ?? '';
	return rates.fallback;
}

/** The rate a line would take, or null when no rate may fill it. */
export function rateFor(form: Pick<BidForm, 'packages' | 'rates'>, line: LineForm): string | null {
	return rateable(form, line) ? rateText(form.rates, line.difficulty) : null;
}

/** The line follows its rate now: not typed, and its price is the rate's. */
export function followsRate(form: Pick<BidForm, 'packages' | 'rates'>, line: LineForm): boolean {
	const rate = rateFor(form, line);
	return !line.typed && rate !== null && rate.trim() !== '' && line.price === rate;
}

/** Every line not typed, where a rate may fill it, takes its rate. Typed lines stay as they are. */
export function applyRates(form: BidForm): BidForm {
	let changed = false;
	const lines = form.lines.map((line) => {
		if (line.typed) return line;
		const rate = rateFor(form, line);
		if (rate === null || line.price === rate) return line;
		changed = true;
		return { ...line, price: rate };
	});
	return changed ? { ...form, lines } : form;
}

/** A rate changed: `difficulty` null is the one for rows with none. Every line that follows it changes; no override does. */
export function setRate(form: BidForm, difficulty: string | null, price: string): BidForm {
	const rates: RateForm =
		difficulty === null
			? { ...form.rates, fallback: price }
			: { ...form.rates, tiers: form.rates.tiers.map((t) => (t.difficulty === difficulty ? { ...t, price } : t)) };
	return applyRates({ ...form, rates });
}

/**
 * The vendor types a line's price: an override, kept whatever the rates do. Clearing it gives the
 * line back to its rate.
 */
export function typePrice(form: BidForm, key: string, price: string): BidForm {
	const next = { ...form, lines: form.lines.map((l) => (l.key === key ? { ...l, price, typed: price.trim() !== '' } : l)) };
	return price.trim() === '' ? applyRates(next) : next;
}

/** The line goes back to its rate. */
export function useRate(form: BidForm, key: Id): BidForm {
	return applyRates({ ...form, lines: form.lines.map((l) => (l.key === key ? { ...l, typed: false } : l)) });
}

export type LineSource = 'rate' | 'override' | 'typed' | 'none';

/**
 * Where a line's price comes from, for its mark: its rate, an override of a rate there is, a price
 * typed where no rate is set, or nothing yet.
 */
export function lineSource(form: Pick<BidForm, 'packages' | 'rates'>, line: LineForm): LineSource {
	if (followsRate(form, line)) return 'rate';
	if (line.price.trim() === '') return 'none';
	const rate = rateFor(form, line);
	return line.typed && rate !== null && rate.trim() !== '' ? 'override' : 'typed';
}
