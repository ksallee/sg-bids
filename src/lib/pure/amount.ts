/**
 * Amounts as people type or paste them: `12,500.00`, `12 500,50 €`, `1'234.50`. Read into a plain
 * decimal string that `money.ts` takes, never a float.
 *
 * Which mark is the decimal:
 *
 * - Both `.` and `,` appear: the last one is the decimal, the other groups thousands.
 * - One mark appears more than once: it groups thousands.
 * - One mark appears once, not followed by exactly three digits: it is the decimal, in any locale.
 * - One mark followed by exactly three digits (`1,234`): the locale settles it. A leading `0`
 *   (`0,125`) is always a decimal.
 *
 * Grouping must be in threes after the first group. Indian grouping (`1,23,456`) is refused.
 */

import { fromDecimal, minorDigits } from './money';

export type DecimalMark = '.' | ',';

export type ParsedAmount =
	| { readonly kind: 'blank' }
	| { readonly kind: 'amount'; readonly decimal: string }
	| { readonly kind: 'error'; readonly message: string };

const NOT_A_NUMBER: ParsedAmount = { kind: 'error', message: 'Not a number.' };

/** The decimal mark of a locale, `.` when the locale cannot be read. */
export function decimalSeparator(locale: string): DecimalMark {
	try {
		const part = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal');
		return part?.value === ',' ? ',' : '.';
	} catch {
		return '.';
	}
}

function digitsWord(currency: string, digits: number): string {
	return digits === 0 ? `${currency} takes no decimals.` : `${currency} takes ${digits} decimals.`;
}

/** Whole part with its grouping mark taken out, when the groups are in threes. */
function ungroup(whole: string, mark: string | null): string | null {
	if (mark === null) return /^\d*$/.test(whole) ? whole : null;
	const groups = whole.split(mark);
	if (!/^\d+$/.test(groups[0])) return null;
	if (groups.slice(1).some((group) => !/^\d{3}$/.test(group))) return null;
	return groups.join('');
}

export function parseAmount(text: string, currency: string, locale: DecimalMark): ParsedAmount {
	const digits = minorDigits(currency);
	let t = text
		.replace(/\p{Sc}/gu, '')
		.replace(/\b[A-Z]{3}\b/g, '')
		.replace(/[\s   '’]/g, '');
	if (t === '') return { kind: 'blank' };
	if (/^[-−]/.test(t) || /^\(.*\)$/.test(t)) return { kind: 'error', message: 'Use an amount of zero or more.' };
	if (!/^[\d.,]+$/.test(t)) return NOT_A_NUMBER;
	if (/^[.,]/.test(t)) t = `0${t}`;

	const dots = t.split('.').length - 1;
	const commas = t.split(',').length - 1;
	let decimal: string | null = null;
	let group: string | null = null;
	if (dots > 0 && commas > 0) {
		decimal = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
		group = decimal === '.' ? ',' : '.';
		if ((decimal === '.' ? dots : commas) > 1) return NOT_A_NUMBER;
	} else if (dots + commas > 1) {
		group = dots > 0 ? '.' : ',';
	} else if (dots + commas === 1) {
		const mark = dots > 0 ? '.' : ',';
		const [whole, after] = t.split(mark);
		if (after.length !== 3 || /^0*$/.test(whole) || mark === locale) decimal = mark;
		else group = mark;
	}

	const [rawWhole, fraction = ''] = decimal === null ? [t] : t.split(decimal);
	const whole = ungroup(rawWhole, group);
	if (whole === null || whole === '' || (decimal !== null && !/^\d+$/.test(fraction))) return NOT_A_NUMBER;
	if (fraction.length > digits) return { kind: 'error', message: digitsWord(currency, digits) };
	const plain = fraction ? `${whole}.${fraction}` : whole;
	try {
		fromDecimal(plain, currency);
	} catch {
		return { kind: 'error', message: 'That amount is too large.' };
	}
	return { kind: 'amount', decimal: plain };
}

/** A plain decimal written for an input: the locale's mark, a zero fraction dropped. */
export function showAmount(decimal: string, mark: DecimalMark): string {
	const [whole, fraction = ''] = decimal.split('.');
	if (/^0*$/.test(fraction)) return whole;
	return `${whole}${mark}${fraction}`;
}
