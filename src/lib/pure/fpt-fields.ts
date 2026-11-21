/**
 * The fields sg-bids keeps on its two custom entities in Flow PT, Bid and Bid Line, and how an amount
 * is written into a `currency` field. Facts from `../sg-groundtruth/corpus`:
 *
 * - A custom entity is found by its display name, trimmed. The slot number differs per site (008).
 * - A field is created from a display name. The name is `sg_` plus the display name lowercased, every
 *   character outside `[a-z0-9_]` turned into `_`. One non-ASCII character and the field is named
 *   `sg_<data_type>` instead (117). So every display name here is ASCII and its name is predicted.
 * - A field is matched on its programmatic name, never its display name: a duplicate display name
 *   makes `<name>_1` (019).
 * - `checkbox` needs a `default_value` at creation; `entity` takes several `valid_types` (116).
 * - `percent` and `number` hold whole numbers only; `float` holds a decimal and reads as a string
 *   (field_types). A share of a split shot can be `33.33`, so it is a `float`.
 * - `currency` keeps two decimals, rounds half up silently, reads back a string, refuses a JSON
 *   integer, and holds no currency code (field_types/currency). The code goes in a text field beside
 *   it. Three- and four-digit currencies lose digits: the write is rounded here, so the loss is known.
 * - A `url` field takes `{url, name}` and mints an Attachment per write (field_types/url).
 * - A `number` is a signed 32 bit whole number; a decimal is refused (field_types/number). A line's
 *   count (`count.ts`, at most 100,000) fits.
 */

import { divideRounded, minorDigits, type Money } from './money';

/** The display names the two custom entities must carry on the site. */
export const ENTITY_NAMES = { bid: 'Bid', line: 'Bid Line' } as const;

export type EntityKey = keyof typeof ENTITY_NAMES;

/** The data types the field set uses. */
export type FptDataType = 'text' | 'number' | 'float' | 'currency' | 'date' | 'url' | 'checkbox' | 'entity' | 'status_list';

/** A link target: a stock type, or `bid` for the site's Bid slot. */
export type LinkTarget = 'Group' | 'Shot' | 'Asset' | 'bid';

export interface FieldSpec {
	/** The app's own name for the field. */
	readonly key: string;
	/** The programmatic name on the site. */
	readonly name: string;
	/** The display name it is created with. ASCII only. */
	readonly display: string;
	readonly dataType: FptDataType;
	/** For an entity field: the types it links to. */
	readonly validTypes?: readonly LinkTarget[];
	/** Every custom entity has it already; never created. */
	readonly stock?: boolean;
	/**
	 * The app works without it: a site that lacks it is ready, and the award leaves it unwritten.
	 * Created with the others when asked.
	 */
	readonly optional?: boolean;
	readonly description: string;
}

/** The programmatic name the site derives from an ASCII display name (117). Null for any other. */
export function fieldName(display: string): string | null {
	if (!/^[\x20-\x7e]*$/.test(display)) return null;
	return 'sg_' + display.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function custom(key: string, display: string, dataType: FptDataType, description: string, validTypes?: LinkTarget[]): FieldSpec {
	const name = fieldName(display);
	if (!name) throw new Error(`'${display}' is not ASCII.`);
	return validTypes ? { key, name, display, dataType, validTypes, description } : { key, name, display, dataType, description };
}

const NOTE = 'Written by sg-bids.';

/** One Bid per vendor bid published: a vendor's answer to one round of one request. */
export const BID_FIELDS: readonly FieldSpec[] = [
	{ key: 'name', name: 'code', display: 'Bid Name', dataType: 'text', stock: true, description: '' },
	{ key: 'status', name: 'sg_status_list', display: 'Status', dataType: 'status_list', stock: true, description: '' },
	custom('key', 'sgbids key', 'text', `${NOTE} The stable key that finds this row again. Do not edit.`),
	custom('vendor', 'Vendor', 'entity', `${NOTE} The vendor's Group.`, ['Group']),
	custom('round', 'Round', 'number', `${NOTE} The request round the bid answers.`),
	custom('total', 'Total', 'currency', `${NOTE} The grand total in the bid currency.`),
	custom('currency', 'Currency', 'text', `${NOTE} ISO 4217 code of the bid currency.`),
	custom('totalBase', 'Total Base', 'currency', `${NOTE} The grand total in the base currency.`),
	custom('baseCurrency', 'Base Currency', 'text', `${NOTE} ISO 4217 code of the base currency.`),
	custom('rebate', 'Rebate Estimate', 'currency', `${NOTE} Estimated rebate, in the base currency.`),
	custom('afterRebate', 'Total After Rebate', 'currency', `${NOTE} Grand total less the rebate estimate, in the base currency.`),
	custom('rate', 'Exchange Rate', 'text', `${NOTE} One unit of the bid currency in the base currency, as locked.`),
	custom('rateDate', 'Rate Date', 'date', `${NOTE} The day the exchange rate was locked.`),
	custom('requestCode', 'Request Code', 'text', `${NOTE} The bid request.`),
	custom('version', 'Bid Version', 'number', `${NOTE} The vendor's bid number.`),
	custom('appLink', 'App Link', 'url', `${NOTE} The bid in sg-bids.`),
	custom('submitted', 'Submitted Date', 'date', `${NOTE} The day the vendor submitted.`),
	custom('awarded', 'Awarded Date', 'date', `${NOTE} The day the bid was awarded.`)
];

/** One Bid Line per Bid and Shot or Asset. */
export const LINE_FIELDS: readonly FieldSpec[] = [
	{ key: 'name', name: 'code', display: 'Bid Line Name', dataType: 'text', stock: true, description: '' },
	custom('key', 'sgbids key', 'text', `${NOTE} The stable key that finds this row again. Do not edit.`),
	custom('bid', 'Bid', 'entity', `${NOTE} The Bid this line belongs to.`, ['bid']),
	custom('item', 'Item', 'entity', `${NOTE} The Shot or Asset.`, ['Shot', 'Asset']),
	custom('amount', 'Amount', 'currency', `${NOTE} The vendor's price for the item, in the bid currency.`),
	custom('currency', 'Currency', 'text', `${NOTE} ISO 4217 code of the bid currency.`),
	custom('amountBase', 'Amount Base', 'currency', `${NOTE} The price in the base currency.`),
	custom('share', 'Share Percent', 'float', `${NOTE} The vendor's share of a split item, 0 to 100.`),
	custom('awardedBase', 'Awarded Base', 'currency', `${NOTE} The awarded part in the base currency: the price times the share.`),
	custom('awarded', 'Awarded', 'checkbox', `${NOTE} The item is awarded to this vendor.`),
	custom('excluded', 'Excluded', 'checkbox', `${NOTE} The vendor will not do this item.`),
	// Optional: a site set up before counted rows has no such field and stays ready (`count.ts`).
	{ ...custom('count', 'Count', 'number', `${NOTE} How many shots or assets the line stands for. 1 for a Shot or Asset of Flow PT.`), optional: true }
];

export const FIELDS: Readonly<Record<EntityKey, readonly FieldSpec[]>> = { bid: BID_FIELDS, line: LINE_FIELDS };

function byKey(fields: readonly FieldSpec[]): Readonly<Record<string, string>> {
	return Object.fromEntries(fields.map((f) => [f.key, f.name]));
}

/** Programmatic names by app key: `BID.total` is `sg_total`. */
export const BID: Readonly<Record<string, string>> = byKey(BID_FIELDS);
export const LINE: Readonly<Record<string, string>> = byKey(LINE_FIELDS);

/** The site type for each link target, given the Bid slot. Order kept: the site keeps it (121). */
export function linkTypes(targets: readonly LinkTarget[], bidType: string): string[] {
	return targets.map((t) => (t === 'bid' ? bidType : t));
}

/** What a `currency` field is sent, and what the two decimals lost. */
export interface FptAmount {
	/** A decimal string with a point: a JSON integer is refused. */
	readonly value: string;
	/** Exact amount less the stored one, in the amount's minor units. Null when nothing is lost. */
	readonly lost: Money | null;
}

/**
 * The amount as a `currency` field holds it. Two decimals at most: a three-digit currency is rounded
 * half away from zero here, so the site's own rounding never decides, and the difference is returned.
 * A zero-digit currency is whole units, written `1500.0`.
 */
export function toFptCurrency(amount: Money): FptAmount {
	const digits = minorDigits(amount.currency);
	const kept = Math.min(digits, 2);
	const drop = 10n ** BigInt(digits - kept);
	const stored = divideRounded(BigInt(amount.minor), drop);
	const sign = stored < 0n ? '-' : '';
	const abs = (stored < 0n ? -stored : stored).toString().padStart(kept + 1, '0');
	const value = kept === 0 ? `${sign}${abs}.0` : `${sign}${abs.slice(0, -kept)}.${abs.slice(-kept)}`;
	const diff = BigInt(amount.minor) - stored * drop;
	return { value, lost: diff === 0n ? null : { minor: Number(diff), currency: amount.currency } };
}

/** Whether a `currency` value read back (a string, a number in `_summarize`) equals what was sent. */
export function sameCurrency(read: unknown, sent: string | null): boolean {
	if (sent === null) return read === null || read === undefined;
	if (typeof read !== 'string' && typeof read !== 'number') return false;
	const cents = (v: string | number) => Math.round(Number(v) * 100);
	return Number.isFinite(Number(read)) && cents(read) === cents(sent);
}
