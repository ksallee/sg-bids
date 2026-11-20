/**
 * Figures as the comparison screen writes them. Display only: no amount is computed here.
 *
 * In a dense grid an amount with no minor part drops its zeros (`$12,500` for `$12,500.00`); one
 * with a minor part keeps every digit, so no figure is ever rounded for show.
 */

import { minorDigits, toDecimal, type Money } from './money';

export function formatAmount(amount: Money, locale: string | undefined = undefined, compact = true): string {
	const digits = minorDigits(amount.currency);
	const whole = compact && amount.minor % 10 ** digits === 0;
	return new Intl.NumberFormat(locale, {
		style: 'currency',
		currency: amount.currency,
		// `symbol`, not `narrowSymbol`: a Canadian dollar reads CA$, never a bare $ beside US dollars.
		currencyDisplay: 'symbol',
		minimumFractionDigits: whole ? 0 : digits,
		maximumFractionDigits: whole ? 0 : digits
	}).format(toDecimal(amount) as Intl.StringNumericLiteral);
}

/** A spread in basis points as a percent over the lowest: `+12.5%`, `+0.01%`. */
export function formatSpread(bp: number): string {
	if (!Number.isFinite(bp)) return 'over a zero';
	if (bp === 0) return '0%';
	const whole = Math.floor(bp / 100);
	const rest = bp % 100;
	const fraction = rest === 0 ? '' : `.${String(rest).padStart(2, '0').replace(/0$/, '')}`;
	return `+${whole}${fraction}%`;
}

/** A share in basis points as a whole percent for a summary: `59%`, `<1%`. */
export function formatShare(bp: number | null): string {
	if (bp === null) return '';
	if (bp > 0 && bp < 50) return '<1%';
	return `${Math.round(bp / 100)}%`;
}

/** A day `YYYY-MM-DD` as a short date in the locale, read as a calendar day. */
export function formatDay(day: string, locale: string | undefined = undefined): string {
	const [y, m, d] = day.split('-').map(Number);
	if (!y || !m || !d) return day;
	return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}
