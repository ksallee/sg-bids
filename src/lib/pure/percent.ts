/**
 * Percents, as typed: plain non-negative decimal strings (`39`, `12.5`). Like a rate in
 * `money.ts`, no floating point touches them. A percent of an amount runs on bigint and rounds
 * once, half away from zero, to the amount's minor unit.
 */

import { divideRounded, money, type Money } from './money';

const PLAIN = /^(\d+)(?:\.(\d+))?$/;

/** A percent as a fraction: `12.5` is 125 / 10. Still in percent, not a share of one. */
interface Scaled {
	readonly digits: bigint;
	readonly scale: bigint;
}

export function isPercent(text: string): boolean {
	return PLAIN.test(text);
}

function scaled(text: string): Scaled {
	const parts = PLAIN.exec(text);
	if (!parts) throw new Error(`'${text}' is not a percent: a plain non-negative decimal.`);
	const [, whole, fraction = ''] = parts;
	return { digits: BigInt(whole + fraction), scale: 10n ** BigInt(fraction.length) };
}

/** The amount times each percent, rounded once at the end. */
export function percentOf(amount: Money, ...percents: string[]): Money {
	let numerator = BigInt(amount.minor);
	let denominator = 1n;
	for (const text of percents) {
		const { digits, scale } = scaled(text);
		numerator *= digits;
		denominator *= scale * 100n;
	}
	const minor = divideRounded(numerator, denominator);
	if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) {
		throw new Error('The amount is too large to hold exactly.');
	}
	return money(Number(minor), amount.currency);
}

function toCommon(texts: readonly string[]): { values: bigint[]; places: number } {
	const parsed = texts.map((text) => {
		scaled(text);
		const [whole, fraction = ''] = text.split('.');
		return { whole, fraction };
	});
	const places = Math.max(0, ...parsed.map((p) => p.fraction.length));
	return { values: parsed.map((p) => BigInt(p.whole + p.fraction.padEnd(places, '0'))), places };
}

function write(value: bigint, places: number): string {
	if (places === 0) return String(value);
	const text = String(value).padStart(places + 1, '0');
	const fraction = text.slice(-places).replace(/0+$/, '');
	const whole = text.slice(0, -places);
	return fraction ? `${whole}.${fraction}` : whole;
}

/** The exact sum, written with no trailing zeros: `33.3 + 33.3 + 33.4` is `100`. */
export function sumPercents(texts: readonly string[]): string {
	const { values, places } = toCommon(texts);
	return write(
		values.reduce((a, b) => a + b, 0n),
		places
	);
}

/** -1, 0 or 1 as `a` is under, equal to or over `b`. */
export function comparePercent(a: string, b: string): -1 | 0 | 1 {
	const [x, y] = toCommon([a, b]).values;
	return x < y ? -1 : x > y ? 1 : 0;
}
