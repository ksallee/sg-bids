/**
 * Money, as whole minor units with an ISO 4217 currency code. No floating point touches an
 * amount: decimals come in and go out as strings, and arithmetic runs on bigint.
 *
 * A conversion uses one locked rate, typed as a decimal string with the day it was locked. It
 * rounds half away from zero to the target currency's minor unit.
 *
 * The minor unit is ISO 4217's, from the table below: two digits unless listed. Intl is not asked,
 * because CLDR's digits differ from ISO's for a few currencies (IQD, LBP), and a stored amount must
 * not depend on the runtime's locale data.
 */

export interface Money {
	/** Whole minor units: cents for USD, yen for JPY, fils for KWD. */
	readonly minor: number;
	/** ISO 4217 code, three capital letters. */
	readonly currency: string;
}

/** One unit of `from` is worth `rate` units of `to`, locked on `date`. */
export interface Rate {
	readonly from: string;
	readonly to: string;
	/** A positive plain decimal, as typed: `0.9234`. */
	readonly rate: string;
	/** The day the rate was locked, `YYYY-MM-DD`. */
	readonly date: string;
}

/** ISO 4217 currencies whose minor unit is not two digits. */
const DIGITS: Readonly<Record<string, number>> = {
	BIF: 0,
	CLP: 0,
	DJF: 0,
	GNF: 0,
	ISK: 0,
	JPY: 0,
	KMF: 0,
	KRW: 0,
	PYG: 0,
	RWF: 0,
	UGX: 0,
	UYI: 0,
	VND: 0,
	VUV: 0,
	XAF: 0,
	XOF: 0,
	XPF: 0,
	BHD: 3,
	IQD: 3,
	JOD: 3,
	KWD: 3,
	LYD: 3,
	OMR: 3,
	TND: 3,
	CLF: 4,
	UYW: 4
};

const CODE = /^[A-Z]{3}$/;
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The number of digits after the point in the currency's minor unit. */
export function minorDigits(currency: string): number {
	if (!CODE.test(currency)) throw new Error(`'${currency}' is not an ISO 4217 code.`);
	return DIGITS[currency] ?? 2;
}

/** An amount of whole minor units. */
export function money(minor: number, currency: string): Money {
	minorDigits(currency);
	if (!Number.isSafeInteger(minor)) throw new Error(`${minor} is not a whole number of minor units.`);
	return { minor, currency };
}

function fromBig(minor: bigint, currency: string): Money {
	if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) {
		throw new Error('The amount is too large to hold exactly.');
	}
	return money(Number(minor), currency);
}

/** Read a plain decimal string (`19.99`, `-3`) as an amount. More digits than the currency has is an error. */
export function fromDecimal(text: string, currency: string): Money {
	const digits = minorDigits(currency);
	const parts = DECIMAL.exec(text);
	if (!parts) throw new Error(`'${text}' is not a plain decimal.`);
	const [, sign, whole, fraction = ''] = parts;
	if (fraction.length > digits) throw new Error(`${currency} has ${digits} minor digits; '${text}' has ${fraction.length}.`);
	const minor = BigInt(whole + fraction.padEnd(digits, '0'));
	return fromBig(sign ? -minor : minor, currency);
}

/** The amount as a plain decimal string, every minor digit written: `19.99`, `0.05`, `1500`. */
export function toDecimal(amount: Money): string {
	const digits = minorDigits(amount.currency);
	const sign = amount.minor < 0 ? '-' : '';
	const units = String(Math.abs(amount.minor)).padStart(digits + 1, '0');
	if (digits === 0) return sign + units;
	return `${sign}${units.slice(0, -digits)}.${units.slice(-digits)}`;
}

export function add(a: Money, b: Money): Money {
	if (a.currency !== b.currency) throw new Error(`Cannot add ${a.currency} and ${b.currency}.`);
	return fromBig(BigInt(a.minor) + BigInt(b.minor), a.currency);
}

export function subtract(a: Money, b: Money): Money {
	if (a.currency !== b.currency) throw new Error(`Cannot subtract ${b.currency} from ${a.currency}.`);
	return fromBig(BigInt(a.minor) - BigInt(b.minor), a.currency);
}

/** The sum of a list, every amount in `currency`. Zero for an empty list. */
export function sum(amounts: readonly Money[], currency: string): Money {
	return amounts.reduce((total, amount) => add(total, amount), money(0, currency));
}

function validDay(text: string): boolean {
	const parts = DAY.exec(text);
	if (!parts) return false;
	const [year, month, day] = parts.slice(1).map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Lock a rate: one `from` is worth `value` of `to`, on `date`. */
export function rate(from: string, to: string, value: string, date: string): Rate {
	minorDigits(from);
	minorDigits(to);
	const parts = DECIMAL.exec(value);
	const negative = parts?.[1] === '-';
	const zero = parts !== null && /^0+$/.test(parts[2] + (parts[3] ?? ''));
	if (!parts || negative || zero) {
		throw new Error(`'${value}' is not a positive plain decimal.`);
	}
	if (!validDay(date)) throw new Error(`'${date}' is not a day written YYYY-MM-DD.`);
	return { from, to, rate: value, date };
}

/** `n / d` for a positive `d`, rounded half away from zero. */
export function divideRounded(n: bigint, d: bigint): bigint {
	const quotient = n / d;
	const remainder = n % d;
	const abs = remainder < 0n ? -remainder : remainder;
	if (abs * 2n < d) return quotient;
	return n < 0n ? quotient - 1n : quotient + 1n;
}

/** The amount in the rate's target currency, rounded half away from zero to its minor unit. */
export function convert(amount: Money, locked: Rate): Money {
	if (amount.currency !== locked.from) {
		throw new Error(`The amount is in ${amount.currency}; the rate converts ${locked.from}.`);
	}
	const [whole, fraction = ''] = locked.rate.split('.');
	const scaled = BigInt(whole + fraction);
	const numerator = BigInt(amount.minor) * scaled * 10n ** BigInt(minorDigits(locked.to));
	const denominator = 10n ** BigInt(fraction.length + minorDigits(locked.from));
	return fromBig(divideRounded(numerator, denominator), locked.to);
}

/** The amount for people to read, in the locale's way, with every minor digit of its currency. */
export function format(amount: Money, locale: string): string {
	const digits = minorDigits(amount.currency);
	return new Intl.NumberFormat(locale, {
		style: 'currency',
		currency: amount.currency,
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	}).format(toDecimal(amount) as Intl.StringNumericLiteral);
}
