/**
 * The award as Flow PT writes: from a request, the vendor bids published and an award scenario, the
 * exact ordered writes, a preview of them, the read-back check, and the undo built from what was
 * written. Nothing here calls the site; `src/lib/io/fpt-award.ts` does. Facts from
 * `../sg-groundtruth/corpus`:
 *
 * - A batch cannot point at a row it creates (recipe 002). So the Bids go in one step and the Bid
 *   Lines that link them in the next, with each new Bid's id put in after the first step answers.
 * - A batch is all or nothing, answers one row per request in request order, and should stay near
 *   200 requests (recipe 002). A step longer than that is several batches, each atomic alone.
 * - Add a Group to a multi_entity field with `{multi_entity_update_mode: 'add'}` in the body, take it
 *   away with `remove`. A bare list replaces every other vendor's award (recipe 009, 166). The mode
 *   works in a batch update too (154).
 * - Before taking a Group off an item, ask whether something else still needs it there (recipe 009).
 *   Here: another awarded Bid Line on the item for the same vendor.
 * - The API has no idempotency key. A row is found again by a key in a text field, looked up before
 *   writing (127, recipe 025). The key field is not `unique`: whether a deleted row frees a unique
 *   value is not measured, and the undo deletes rows.
 * - A `currency` field keeps two decimals and refuses a JSON integer; a `float` takes a numeric
 *   string (field_types/currency, field_types/float). Amounts go through `toFptCurrency`.
 * - A `url` write mints an Attachment row each time (field_types/url). The link is written on create
 *   only, and the undo deletes the Attachment of a row it deletes (recipe 006).
 * - Measured here, not in the corpus yet: `_batch` refuses a `url` value in a create and in an update,
 *   400 `Value is not legal.`, where a single POST or PUT takes it. So the link is its own last step,
 *   one PUT per new Bid, outside any batch.
 * - A write is confirmed by reading the row back, never by its status (recipe 009).
 * - Published again after the scenario changed, the plan first takes back what the new scenario
 *   drops: the Groups an earlier run added that no pick needs now, unless another award outside the
 *   app's rows still needs them (recipe 009), and the rows an earlier run created that the new plan
 *   does not write. Then it updates the rest by key. Nothing is written twice.
 *
 * Packages (`packages.ts`). Each package of a vendor's bid is a Bid of its own, keyed
 * `sgbids/<request>/<vendor>/r<round>/p:<package>` and named with the package's name. A package
 * priced as one figure carries the figure on its Bid; its Bid Lines link the rows with no amount.
 * A package priced row by row carries the amounts on its Bid Lines, as before, and their sum on its
 * Bid. A package the vendor declined, or left unpriced, has no Bid. The whole-bid figures (non-shot
 * costs, discount, tax, the rebate estimate) go on one more Bid with no line, `.../general`, named
 * General costs, so a vendor's Bids sum to its grand total exactly, in minor units; in the base
 * currency too, the last Bid taking the rounding. Award status is per Bid: a package priced as one
 * figure is awarded whole; a split inside a package priced row by row stays per Bid Line. A request
 * from before packages keeps its one Bid per vendor, keyed as it always was, and gains the general
 * Bid only when the vendor gave whole-bid figures.
 *
 * Rows from a breakdown have no Flow PT row. For each kind production chooses:
 *
 * - `create`: the Shot or Asset is created first, from the row (code, description, and the mapped
 *   fields that hold a value the field takes), its own step, since a batch cannot point at a row it
 *   creates (recipe 002). `project` is the one field a create needs; `code` is sent always, or the
 *   site names the row `New Shot <id>` (entity_types/Shot, Asset). A Shot goes under the Sequence it
 *   names when the project has one with that code; a missing Sequence is created only when asked,
 *   in a step before (entity_types/Sequence). A list value outside the field's values is refused by
 *   the site and fails the batch (field_types/list), so it is left empty and said.
 * - `without`: its Bid Lines are written with no item, and no Group is added for it.
 *
 * A code is not unique in Flow PT and a second create with it is a 201 (entity_types/Shot), so the
 * plan reads the project's rows with each code first; text filters ignore case (field_types/text).
 * A row whose code is already there, or two rows with one code, is a collision: named, never
 * created. An earlier run's created row is used again by key. The undo deletes (retires, 103) what a
 * publish created, Shots and Assets after the Bids and Sequences last, and leaves a row that has
 * since gained links: deleting it would hide them (161).
 */

import { BID, BID_FIELDS, LINE, LINE_FIELDS, sameCurrency, toFptCurrency, type FptAmount } from './fpt-fields';
import type { AppStatus, ItemType } from './fpt-setup';
import { applyScenario } from './compare';
import { targetKey, type AwardScenario, type BidLine, type BidRequest, type Day, type EntityRef, type Id, type InvitedVendor, type Target, type VendorBid } from './model';
import { fromDecimal, minorDigits, money, sum, toDecimal, type Money, type Rate } from './money';
import { percentOf } from './percent';
import { estimateRebate } from './rebate';
import { ALL_PACKAGE, packagePrices, resolvePackages, type Resolved } from './packages';
import { bidTotals, toBase, type BidTotals } from './totals';

/** The site's names, from the setup check. */
export interface FptSite {
	readonly projectId: number;
	readonly bidType: string;
	readonly lineType: string;
	/** The multi_entity field to Group an award adds to, per item type. */
	readonly vendorField: Readonly<Partial<Record<ItemType, string>>>;
	/** The site status for each app status. An unmapped one leaves the status unwritten. */
	readonly statuses: Readonly<Partial<Record<AppStatus, string>>>;
}

/** What the site already holds, read before planning. */
export interface Existing {
	/** Bid rows found by key. */
	readonly bids: readonly { readonly id: number; readonly key: string }[];
	/** Bid Line rows found by key. */
	readonly lines: readonly { readonly id: number; readonly key: string }[];
	/** Group ids on each item's vendor field, keyed `Shot:123`. */
	readonly groups: Readonly<Record<string, readonly number[]>>;
	/** `Shot:123:38` for each Group an awarded line outside the app's rows still needs on its item. */
	readonly needed?: ReadonlySet<string>;
	/** The project's Sequences with a code a row to create names. */
	readonly sequences?: readonly { readonly id: number; readonly code: string }[];
	/** The project's rows with a code a row to create holds, in any case. */
	readonly codes?: Readonly<Record<'Shot' | 'Asset', readonly { readonly id: number; readonly code: string }[]>>;
	/** Rows an earlier run created that have since gained links, keyed `Shot:123`, with why. */
	readonly itemLinks?: ReadonlyMap<string, string>;
}

/** For rows with no Flow PT row: create them, or publish their Bid Lines without an item. */
export type MissingChoice = 'create' | 'without';

export interface MissingOptions {
	readonly shot?: MissingChoice;
	readonly asset?: MissingChoice;
	/** Create the Sequences the rows name that the project lacks. Off unless asked. */
	readonly sequences?: boolean;
}

/** A field a created row's value is written to: the mapped field and its schema. */
export interface CreateField {
	readonly name: string;
	readonly dataType: string;
	readonly validValues?: readonly string[];
}

/** Where a created row's values go, from the mapping. A slot left out is not written. */
export interface CreateFields {
	readonly shot: Partial<Record<'description' | 'frames' | 'type' | 'difficulty', CreateField>> & { readonly sequence?: string };
	readonly asset: Partial<Record<'description' | 'type' | 'difficulty', CreateField>>;
}

export type CreatedType = 'Shot' | 'Asset' | 'Sequence';

export interface AwardOptions {
	/** The award day. */
	readonly date: Day;
	/** The request's code, written on each Bid. The request id when absent. */
	readonly requestCode?: string;
	/** Write a line for every line of every bid, not only the awarded ones. */
	readonly allLines?: boolean;
	/** The app's address for each bid, by bid id, written to the Bid's link on create. */
	readonly appLinks?: Readonly<Record<Id, string>>;
	/**
	 * The Group per vendor id, over the invitation's: a Group id picked at publish, or null to write
	 * the vendor's Bid with no Group and share no Shot or Asset with it.
	 */
	readonly groups?: Readonly<Record<Id, number | null>>;
	/** What to do with awarded rows that have no Flow PT row. */
	readonly missing?: MissingOptions;
}

export interface AwardInput {
	readonly request: BidRequest;
	/** The vendor bids to publish. Every bid the scenario picks must be here. */
	readonly bids: readonly VendorBid[];
	readonly scenario: AwardScenario;
	readonly options: AwardOptions;
	readonly site: FptSite;
	readonly existing: Existing;
	/** What earlier runs of this award wrote, merged. Rows they created that this plan drops are deleted. */
	readonly previous?: Written | null;
	/** Where a created Shot's or Asset's values go. Without it, only the code is written. */
	readonly createFields?: CreateFields;
}

/** A new Bid's id, put in once the Bid step answers. */
export interface PendingBid {
	readonly pendingBid: string;
}

/** A Shot, Asset or Sequence this run creates, put in once its step answers. Keyed `shot:<item>`, `sequence:<code>`. */
export interface PendingRow {
	readonly pendingRow: string;
}

export type FieldValue = string | number | boolean | null | EntityRef | PendingBid | PendingRow;

export type Write =
	| { readonly kind: 'create'; readonly entity: 'bid' | 'line'; readonly key: string; readonly data: Readonly<Record<string, FieldValue>> }
	| { readonly kind: 'update'; readonly entity: 'bid' | 'line'; readonly key: string; readonly id: number; readonly data: Readonly<Record<string, FieldValue>> }
	| { readonly kind: 'createItem'; readonly itemType: CreatedType; readonly key: string; readonly data: Readonly<Record<string, FieldValue>> }
	| {
			readonly kind: 'addGroups';
			readonly itemType: ItemType;
			readonly id: number | PendingRow;
			readonly field: string;
			readonly groups: readonly number[];
	  }
	| { readonly kind: 'link'; readonly key: string; readonly url: string }
	| {
			readonly kind: 'removeGroups';
			readonly itemType: ItemType;
			readonly id: number;
			readonly field: string;
			readonly groups: readonly number[];
	  }
	| { readonly kind: 'delete'; readonly entity: 'bid' | 'line' | 'attachment'; readonly key: string; readonly id: number }
	| { readonly kind: 'delete'; readonly entity: 'item'; readonly itemType: CreatedType; readonly key: string; readonly id: number };

export interface Step {
	readonly label: string;
	/** `batch`: one `_batch` per 200 writes. `single`: one request per write; a url cannot go in a batch. */
	readonly mode: 'batch' | 'single';
	readonly writes: readonly Write[];
}

export interface BidPreview {
	readonly key: string;
	readonly bidId: Id;
	readonly vendor: string;
	/** The package this Bid is for; null for the one Bid of a request from before packages, and the general Bid. */
	readonly package: string | null;
	/** The Bid of whole-bid figures: non-shot costs, discount, tax, rebate. */
	readonly general: boolean;
	readonly action: 'create' | 'update';
	readonly status: AppStatus;
	readonly currency: string;
	readonly total: Money;
	readonly totalBase: Money;
	/** The locked rate, null in the base currency. */
	readonly rate: Rate | null;
	/** The vendor's Group, null when published without one. */
	readonly group: number | null;
	readonly lines: number;
}

export interface LinePreview {
	readonly key: string;
	readonly item: string;
	/** The item's key in the request, `shot:sh010`. */
	readonly target: string;
	/** The Flow PT row; null for a row created in this run or published without one. */
	readonly ref: EntityRef | null;
	readonly vendor: string;
	readonly action: 'create' | 'update';
	/** Null when excluded. */
	readonly amount: Money | null;
	readonly amountBase: Money | null;
	/** The vendor's share of the item, null when not awarded. */
	readonly share: string | null;
	readonly awardedBase: Money | null;
	readonly excluded: boolean;
	/** The package the item sits in; null in a request from before packages. */
	readonly package: string | null;
	/** In a package priced as one figure: the line carries no amount, the package's Bid does. */
	readonly inPackage: boolean;
}

export interface GroupPreview {
	readonly item: string;
	readonly target: string;
	/** Null for a row created in this run. */
	readonly ref: EntityRef | null;
	readonly added: readonly number[];
	/** The vendor of each Group in `added`, in order. */
	readonly addedVendors: readonly string[];
	readonly already: readonly number[];
	/** Vendors that win the item and have no Group: nothing is shared with them. */
	readonly withoutGroup: readonly string[];
}

export interface RemovedPreview {
	readonly bids: readonly { readonly key: string; readonly vendor: string }[];
	readonly lines: readonly { readonly key: string; readonly item: string; readonly vendor: string }[];
	readonly groups: readonly { readonly item: string; readonly ref: EntityRef; readonly groups: readonly number[] }[];
	/** Rows an earlier run created that no pick needs now. */
	readonly items: readonly { readonly key: string; readonly type: CreatedType; readonly id: number }[];
}

/** A Shot or Asset the run creates, as the preview shows it. */
export interface CreatedPreview {
	readonly key: string;
	readonly item: string;
	readonly type: 'Shot' | 'Asset';
	readonly kind: Target['kind'];
	/** The Sequence's code it goes under, or null. */
	readonly sequence: string | null;
	/** The Sequence is created in this run. */
	readonly sequenceNew: boolean;
	/** The values written beside the code, by field. */
	readonly fields: readonly { readonly field: string; readonly value: string }[];
}

/** A row that cannot be created: its code is in Flow PT already, or on another row to create. */
export interface Collision {
	readonly item: string;
	readonly kind: Target['kind'];
	readonly code: string;
	readonly found: readonly { readonly type: string; readonly id: number; readonly code: string }[];
	/** Another row to create holds the same code. */
	readonly twice: boolean;
}

export interface AwardPlan {
	readonly steps: readonly Step[];
	readonly preview: {
		readonly bids: readonly BidPreview[];
		readonly lines: readonly LinePreview[];
		readonly groups: readonly GroupPreview[];
		/** What an earlier run wrote that this plan takes back. */
		readonly removed: RemovedPreview;
		/** Shots and Assets the run creates. */
		readonly created: readonly CreatedPreview[];
		/** Sequences the run creates. */
		readonly sequences: readonly { readonly key: string; readonly code: string }[];
		/** Awarded rows published with no Flow PT row: their Bid Lines carry no item. */
		readonly unlinked: readonly { readonly item: string; readonly kind: Target['kind'] }[];
	};
	/** Rows that cannot be created as they are. Nothing is published while one is named. */
	readonly collisions: readonly Collision[];
	/** Ids of rows an earlier run created that stay in Flow PT and leave the record: they gained links. */
	readonly released: readonly number[];
	/** What the site cannot hold exactly, or what is left unwritten, in plain words. */
	readonly warnings: readonly string[];
}

/**
 * A vendor's bid on one round of a request: the key its Bids start from. In a request from before
 * packages, the key of its one package's Bid, as it always was.
 */
export function bidKey(requestId: Id, vendorId: Id, round: number): string {
	return `sgbids/${requestId}/${vendorId}/r${round}`;
}

/** The key of the Bid of one package of a vendor's bid. A package id may hold any character, so it is encoded. */
export function packageBidKey(base: string, packageId: Id): string {
	return `${base}/p:${encodeURIComponent(packageId)}`;
}

/** The key of the Bid that carries a vendor's whole-bid figures: non-shot costs, discount, tax, rebate. */
export function generalBidKey(base: string): string {
	return `${base}/general`;
}

/** The name of the Bid of whole-bid figures. */
export const GENERAL_COSTS = 'General costs';

export function lineKey(bid: string, target: Target): string {
	return `${bid}/${targetKey(target)}`;
}

/** The target key a line key ends with, `shot:sh010`. Item ids hold no slash. */
function targetOfLine(key: string): string {
	return key.slice(key.lastIndexOf('/') + 1);
}

/** The key of the Bid a row's line goes under: its package's Bid, or the one Bid of a request from before packages. */
export function rowBidKey(packages: Resolved, base: string, target: Target): string {
	if (packages.implicit) return base;
	const pkg = packages.of.get(targetKey(target));
	if (pkg === undefined) throw new Error(`The ${target.kind} ${target.id} is in no package.`);
	return packageBidKey(base, pkg);
}

/** Every Bid and Bid Line key a vendor's bid may write, to find the rows an earlier run made. */
export function bidRowKeys(request: BidRequest, bid: Pick<VendorBid, 'vendorId' | 'round' | 'lines'>): { bids: string[]; lines: string[] } {
	const packages = resolvePackages(request);
	const base = bidKey(request.id, bid.vendorId, bid.round);
	const bids = packages.implicit ? [base] : packages.packages.map((p) => packageBidKey(base, p.id));
	return { bids: [...bids, generalBidKey(base)], lines: bid.lines.map((l) => lineKey(rowBidKey(packages, base, l.target), l.target)) };
}

/** What one Bid of a vendor's bid holds: a package's figure or its lines' sum, or the whole-bid figures. */
interface BidUnit {
	readonly key: string;
	/** The package's name, null for the one package of a request from before packages and for the general Bid. */
	readonly packageName: string | null;
	readonly general: boolean;
	/** In the bid currency. */
	readonly total: Money;
	readonly lines: readonly BidLine[];
}

/**
 * A vendor's bid as Bids: one per package it bid on (a package it declined, or left unpriced, has
 * none), then one with the whole-bid figures when it has any: non-shot costs, a discount, a tax or
 * a rebate split. Their totals sum to the bid's grand total exactly. A request from before packages
 * with no whole-bid figure is one Bid, as it always was.
 */
function bidUnits(packages: Resolved, base: string, bid: VendorBid, totals: BidTotals): BidUnit[] {
	const figures = packagePrices(bid);
	const whole = totals.costs.bid.minor !== 0 || totals.discount.bid.minor !== 0 || totals.tax.bid.minor !== 0 || bid.rebate.length > 0;
	const lineSum = (lines: readonly BidLine[]) =>
		sum(
			lines.filter((l) => !l.excluded && !l.inPackage).map((l) => l.total),
			bid.currency
		);
	const units: BidUnit[] = [];
	if (packages.implicit) {
		const figure = figures.get(ALL_PACKAGE.id);
		const total = figure ? figure.total : lineSum(bid.lines);
		if (!whole) return [{ key: base, packageName: null, general: false, total: totals.grand.bid, lines: bid.lines }];
		units.push({ key: base, packageName: null, general: false, total, lines: bid.lines });
	} else {
		for (const pkg of packages.packages) {
			const lines = bid.lines.filter((l) => packages.of.get(targetKey(l.target)) === pkg.id);
			const figure = figures.get(pkg.id);
			if (lines.length === 0 && !figure) continue;
			units.push({ key: packageBidKey(base, pkg.id), packageName: pkg.name, general: false, total: figure ? figure.total : lineSum(lines), lines });
		}
	}
	if (whole) {
		const given = units.reduce((n, u) => n + BigInt(u.total.minor), 0n);
		units.push({ key: generalBidKey(base), packageName: null, general: true, total: money(Number(BigInt(totals.grand.bid.minor) - given), bid.currency), lines: [] });
	}
	return units;
}

/** `Shot:123`, the key of an item in `Existing.groups`. */
export function itemKey(ref: EntityRef): string {
	return `${ref.type}:${ref.id}`;
}

const ITEM_OF: Readonly<Record<Target['kind'], ItemType>> = { shot: 'Shot', asset: 'Asset' };

/**
 * A request row as the award reaches it. `ref` is its Flow PT row, a row this run creates, or null:
 * published without one.
 */
interface Item {
	readonly label: string;
	readonly target: string;
	readonly ref: EntityRef | PendingRow | null;
}

interface RequestRowInfo {
	readonly target: Target;
	readonly label: string;
	readonly fpt?: EntityRef;
	readonly row: BidRequest['shots'][number] | BidRequest['assets'][number];
}

function rowsOf(request: BidRequest): Map<string, RequestRowInfo> {
	const out = new Map<string, RequestRowInfo>();
	for (const s of request.shots) out.set(targetKey({ kind: 'shot', id: s.id }), { target: { kind: 'shot', id: s.id }, label: s.code, fpt: s.fpt, row: s });
	for (const a of request.assets) out.set(targetKey({ kind: 'asset', id: a.id }), { target: { kind: 'asset', id: a.id }, label: a.name, fpt: a.fpt, row: a });
	return out;
}

function isPendingRow(value: unknown): value is PendingRow {
	return typeof value === 'object' && value !== null && 'pendingRow' in value;
}

function itemOf(all: Map<string, Item>, target: Target): Item {
	const item = all.get(targetKey(target));
	if (!item) throw new Error(`The request has no ${target.kind} ${target.id}.`);
	if (item.ref && !isPendingRow(item.ref) && item.ref.type !== ITEM_OF[target.kind]) throw new Error(`The ${target.kind} ${target.id} points at a ${item.ref.type}.`);
	return item;
}

const lower = (code: string) => code.trim().toLowerCase();

/** One Sequence by code: the exact code, else the one code in another case. Several: none. */
function sequenceByCode(list: readonly { id: number; code: string }[], code: string): { id: number; code: string } | 'several' | null {
	const exact = list.filter((s) => s.code.trim() === code.trim());
	const loose = list.filter((s) => lower(s.code) === lower(code));
	const fit = exact.length > 0 ? exact : loose;
	return fit.length === 1 ? fit[0] : fit.length > 1 ? 'several' : null;
}

/** A created row's value for a field, as the field takes it, or a reason it is left empty. */
function fieldValue(field: CreateField, value: string | number, label: string, what: string, type: string): { value: string | number } | { skip: string } {
	const text = String(value).trim();
	const left = `It is left empty on the new ${type}.`;
	switch (field.dataType) {
		case 'text':
			return { value: text };
		case 'number':
			return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? { value: Number(text) } : { skip: `${label}: ${what} '${text}' is not a whole number, as ${field.name} needs. ${left}` };
		case 'float':
			return /^\d+(\.\d+)?$/.test(text) ? { value: text } : { skip: `${label}: ${what} '${text}' is not a number, as ${field.name} needs. ${left}` };
		case 'list':
			return field.validValues?.includes(text) ? { value: text } : { skip: `${label}: ${what} '${text}' is not a value of ${field.name}. ${left}` };
		default:
			return { skip: `${label}: ${what} goes to ${field.name}, a ${field.dataType} field the app does not write. ${left}` };
	}
}

interface Missing {
	readonly items: Map<string, Item>;
	readonly sequenceWrites: Write[];
	readonly itemWrites: Write[];
	readonly created: CreatedPreview[];
	readonly sequences: { key: string; code: string }[];
	readonly collisions: Collision[];
}

/**
 * Each awarded row's Flow PT row: its own, one an earlier run created, one this run creates, or
 * none. `awarded` are the rows a Bid Line or a Group is written for, in scenario order.
 */
function resolveRows(input: AwardInput, awarded: readonly string[], warnings: string[]): Missing {
	const { request, options, site, existing } = input;
	const all = rowsOf(request);
	const items = new Map<string, Item>();
	const project: EntityRef = { type: 'Project', id: site.projectId };
	const previous = new Map((input.previous?.items ?? []).map((i) => [i.key, i]));
	const choice = options.missing ?? {};
	const sequenceWrites: Write[] = [];
	const itemWrites: Write[] = [];
	const created: CreatedPreview[] = [];
	const sequences: { key: string; code: string }[] = [];
	const collisions: Collision[] = [];
	for (const [key, info] of all) items.set(key, { label: info.label, target: key, ref: info.fpt ?? null });

	// The rows to create, after the choice and what an earlier run made.
	const toCreate: RequestRowInfo[] = [];
	for (const key of awarded) {
		const info = all.get(key);
		if (!info || info.fpt) continue;
		const made = previous.get(key);
		if (made && (made.type === 'Shot' || made.type === 'Asset')) {
			items.set(key, { label: info.label, target: key, ref: { type: made.type, id: made.id } });
			continue;
		}
		const pick = choice[info.target.kind];
		if (!pick) {
			const type = ITEM_OF[info.target.kind];
			throw new Error(`The ${info.target.kind} ${info.label} has no Flow PT ${type}. Create it, publish without it, or match it first.`);
		}
		if (pick === 'create') toCreate.push(info);
	}

	// Collisions: the code in Flow PT already, in any case, or on two rows to create.
	const counts = new Map<string, number>();
	for (const info of toCreate) counts.set(`${info.target.kind}:${lower(info.label)}`, (counts.get(`${info.target.kind}:${lower(info.label)}`) ?? 0) + 1);
	const creatable: RequestRowInfo[] = [];
	for (const info of toCreate) {
		const type = ITEM_OF[info.target.kind];
		const found = (existing.codes?.[type] ?? []).filter((r) => lower(r.code) === lower(info.label)).map((r) => ({ type, id: r.id, code: r.code }));
		const twice = (counts.get(`${info.target.kind}:${lower(info.label)}`) ?? 0) > 1;
		if (found.length > 0 || twice) collisions.push({ item: info.label, kind: info.target.kind, code: info.label, found, twice });
		else creatable.push(info);
	}

	// Sequences the new Shots name.
	const seqField = input.createFields?.shot.sequence;
	const seqRefs = new Map<string, EntityRef | PendingRow | null>();
	let episodeSaid = false;
	for (const info of creatable) {
		const row = info.row as BidRequest['shots'][number];
		if (info.target.kind !== 'shot') continue;
		if (row.episode && !episodeSaid) {
			warnings.push('Episode is not written on a new Shot. Set it in Flow PT.');
			episodeSaid = true;
		}
		const name = row.sequence?.trim();
		if (!name || seqRefs.has(lower(name))) continue;
		if (!seqField) {
			seqRefs.set(lower(name), null);
			warnings.push(`No Sequence field is mapped on Shot. ${info.label} and the other new Shots have no Sequence.`);
			continue;
		}
		const found = sequenceByCode(existing.sequences ?? [], name);
		if (found === 'several') {
			seqRefs.set(lower(name), null);
			warnings.push(`${info.label}: several Sequences in the project carry the code ${name}. The new Shot has no Sequence.`);
		} else if (found) seqRefs.set(lower(name), { type: 'Sequence', id: found.id });
		else if (choice.sequences) {
			const key = `sequence:${lower(name)}`;
			seqRefs.set(lower(name), { pendingRow: key });
			sequenceWrites.push({ kind: 'createItem', itemType: 'Sequence', key, data: { project, code: name } });
			sequences.push({ key, code: name });
		} else {
			seqRefs.set(lower(name), null);
			warnings.push(`${info.label}: the Sequence ${name} is not in the project. The new Shot has no Sequence.`);
		}
	}

	// The Shots and Assets to create.
	const said = new Set<string>();
	for (const info of creatable) {
		const type = ITEM_OF[info.target.kind] as 'Shot' | 'Asset';
		const key = targetKey(info.target);
		const data: Record<string, FieldValue> = { project, code: info.label.trim() };
		const shown: { field: string; value: string }[] = [];
		const fields = (info.target.kind === 'shot' ? input.createFields?.shot : input.createFields?.asset) ?? {};
		const row = info.row as unknown as Record<string, unknown>;
		for (const [slot, what] of [
			['description', 'Description'],
			['frames', 'Frames'],
			['type', 'Type'],
			['difficulty', 'Difficulty']
		] as const) {
			const field = (fields as Partial<Record<string, CreateField>>)[slot];
			const value = row[slot];
			if (!field || (typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') continue;
			const out = fieldValue(field, value, info.label, what, type);
			if ('skip' in out) {
				if (!said.has(out.skip)) warnings.push(out.skip);
				said.add(out.skip);
				continue;
			}
			data[field.name] = out.value;
			shown.push({ field: field.name, value: String(out.value) });
		}
		let sequence: string | null = null;
		let sequenceNew = false;
		if (info.target.kind === 'shot' && seqField) {
			const name = (info.row as BidRequest['shots'][number]).sequence?.trim();
			const ref = name ? seqRefs.get(lower(name)) : null;
			if (ref && name) {
				data[seqField] = ref;
				sequence = isPendingRow(ref) ? name : ((existing.sequences ?? []).find((s) => s.id === ref.id)?.code ?? name);
				sequenceNew = isPendingRow(ref);
			}
		}
		itemWrites.push({ kind: 'createItem', itemType: type, key, data });
		created.push({ key, item: info.label, type, kind: info.target.kind, sequence, sequenceNew, fields: shown });
		items.set(key, { label: info.label, target: key, ref: { pendingRow: key } });
	}
	return { items, sequenceWrites, itemWrites, created, sequences, collisions };
}

function amount(value: Money, where: string, warnings: string[]): string {
	const out: FptAmount = toFptCurrency(value);
	if (out.lost) {
		warnings.push(`${where}: ${value.currency} has more decimals than Flow PT keeps. ${toDecimal(value)} is stored as ${out.value}.`);
	}
	return out.value;
}

/** The share as a float takes it: a plain decimal string. */
function share(percent: string): string {
	return percent.includes('.') ? percent : `${percent}.0`;
}

/** The vendor's Group: the one picked at publish, else the invitation's. Null: none, said so. */
function groupOf(vendor: InvitedVendor, options: AwardOptions): number | null {
	if (options.groups && vendor.id in options.groups) return options.groups[vendor.id];
	if (!vendor.fpt || vendor.fpt.type !== 'Group') throw new Error(`Vendor ${vendor.name} has no Flow PT Group.`);
	return vendor.fpt.id;
}

/**
 * What to read before planning the rows to create: their codes, to catch a collision, and the
 * Sequences the new Shots name. Rows an earlier run created are not asked again.
 */
export function toLookUp(input: Omit<AwardInput, 'existing'>): { Shot: string[]; Asset: string[]; sequences: string[] } {
	const out = { Shot: [] as string[], Asset: [] as string[], sequences: [] as string[] };
	const choice = input.options.missing ?? {};
	const made = new Set((input.previous?.items ?? []).map((i) => i.key));
	const rows = rowsOf(input.request);
	const keys = new Set([
		...input.scenario.picks.map((p) => targetKey(p.target)),
		...(input.options.allLines ? input.bids.flatMap((b) => b.lines.map((l) => targetKey(l.target))) : [])
	]);
	for (const key of keys) {
		const info = rows.get(key);
		if (!info || info.fpt || made.has(key) || choice[info.target.kind] !== 'create') continue;
		out[ITEM_OF[info.target.kind] as 'Shot' | 'Asset'].push(info.label.trim());
		const sequence = info.target.kind === 'shot' ? (info.row as BidRequest['shots'][number]).sequence?.trim() : undefined;
		if (sequence && !out.sequences.includes(sequence)) out.sequences.push(sequence);
	}
	return out;
}

export function planAward(input: AwardInput): AwardPlan {
	const { request, bids, scenario, options, site, existing } = input;
	applyScenario(request, bids, scenario); // throws on a scenario that does not hold together
	const base = request.header.baseCurrency;
	const vendors = new Map(request.vendors.map((v) => [v.id, v]));
	const bidRows = new Map(existing.bids.map((b) => [b.key, b.id]));
	const lineRows = new Map(existing.lines.map((l) => [l.key, l.id]));
	const warnings: string[] = [];
	const project: EntityRef = { type: 'Project', id: site.projectId };
	const requestCode = options.requestCode ?? request.id;
	const awarded = [
		...new Set([...scenario.picks.map((p) => targetKey(p.target)), ...(options.allLines ? bids.filter((b) => b.status === 'submitted').flatMap((b) => b.lines.map((l) => targetKey(l.target))) : [])])
	];
	const missing = resolveRows(input, awarded, warnings);
	const all = missing.items;
	const packages = resolvePackages(request);

	// Shares per bid and target, from the scenario.
	const shares = new Map<string, string>();
	for (const pick of scenario.picks) {
		for (const s of pick.shares) shares.set(`${s.bidId}|${targetKey(pick.target)}`, s.percent);
	}

	const bidWrites: Write[] = [];
	const lineWrites: Write[] = [];
	const linkWrites: Write[] = [];
	let unlinkedLines = 0;
	const previews: BidPreview[] = [];
	const linePreviews: LinePreview[] = [];
	const groupIds = new Map<Id, number | null>();
	const seenKeys = new Set<string>();
	for (const bid of bids) {
		if (bid.status === 'draft' || bid.status === 'withdrawn') {
			throw new Error(`Bid ${bid.id} is ${bid.status}. Only a submitted bid is published.`);
		}
		const vendor = vendors.get(bid.vendorId);
		if (!vendor) throw new Error(`Bid ${bid.id} is from vendor ${bid.vendorId}, not invited to the request.`);
		const group = groupOf(vendor, options);
		if (!groupIds.has(vendor.id)) {
			groupIds.set(vendor.id, group);
			if (group === null) warnings.push(`${vendor.name} has no Flow PT Group. Its Bid is written, and no Shot or Asset is shared with it.`);
		}
		const baseKey = bidKey(request.id, bid.vendorId, bid.round);
		if (seenKeys.has(baseKey)) throw new Error(`Two bids from ${vendor.name} for round ${bid.round}. Publish one.`);
		seenKeys.add(baseKey);

		const totals = bidTotals(bid, base);
		const rebate = estimateRebate(bid, base);
		const isAwarded = (l: BidLine) => shares.has(`${bid.id}|${targetKey(l.target)}`);
		const where = `${vendor.name}'s bid`;
		if (rebate.rebate === null) warnings.push(`${where}: the rebate is unknown. Its estimate is left empty.`);
		const version = /^\d+$/.test(bid.number) && Number(bid.number) <= 2147483647 ? Number(bid.number) : null;
		if (version === null) warnings.push(`${where}: bid number '${bid.number}' is not a whole number. Bid Version is left empty.`);

		const units = bidUnits(packages, baseKey, bid, totals);
		const single = units.length === 1 && units[0].key === baseKey && packages.implicit && !units[0].general;
		// Each Bid's base total converted alone; the last takes the rounding, so they sum to the bid's base total exactly.
		const baseTotals = units.map((u) => toBase(u.total, bid, base));
		if (baseTotals.length > 0) {
			const others = baseTotals.slice(0, -1).reduce((n, m) => n + BigInt(m.minor), 0n);
			baseTotals[baseTotals.length - 1] = money(Number(BigInt(totals.grand.base.minor) - others), base);
		}
		const vendorAwarded = bid.lines.some(isAwarded);
		const statusSaid = new Set<AppStatus>();
		units.forEach((unit, u) => {
			const awardedLines = unit.lines.filter(isAwarded);
			const status: AppStatus = (unit.general ? vendorAwarded : awardedLines.length > 0) ? 'awarded' : 'not_awarded';
			const label = unit.general ? GENERAL_COSTS : unit.packageName;
			const unitWhere = label ? `${where}, ${label}` : where;
			// The whole-bid figures sit on one Bid: on the general one, or on the one Bid of a bid with no package.
			const carriesRebate = unit.general || single;
			const id = bidRows.get(unit.key);
			const data: Record<string, FieldValue> = {
				[BID.name]: `${requestCode} ${vendor.name} R${bid.round}${label ? ` ${label}` : ''}`,
				[BID.key]: unit.key,
				[BID.vendor]: group === null ? null : { type: 'Group', id: group },
				[BID.round]: bid.round,
				[BID.total]: amount(unit.total, `${unitWhere} total`, warnings),
				[BID.currency]: bid.currency,
				[BID.totalBase]: amount(baseTotals[u], `${unitWhere} total in ${base}`, warnings),
				[BID.baseCurrency]: base,
				[BID.rebate]: carriesRebate && rebate.rebate ? amount(rebate.rebate.base, `${where} rebate`, warnings) : null,
				[BID.afterRebate]: carriesRebate && rebate.afterRebate ? amount(rebate.afterRebate.base, `${where} total after rebate`, warnings) : null,
				[BID.rate]: bid.rate?.rate ?? null,
				[BID.rateDate]: bid.rate?.date ?? null,
				[BID.requestCode]: requestCode,
				[BID.submitted]: bid.date,
				[BID.awarded]: status === 'awarded' ? options.date : null
			};
			if (version !== null) data[BID.version] = version;
			const code = site.statuses[status];
			if (code) data[BID.status] = code;
			else if (!statusSaid.has(status)) {
				statusSaid.add(status);
				warnings.push(`${where}: the project has no status for ${status.replace('_', ' ')}. The status is left as it is.`);
			}
			if (id === undefined) {
				data.project = project;
				const link = options.appLinks?.[bid.id];
				if (link) linkWrites.push({ kind: 'link', key: unit.key, url: link });
				bidWrites.push({ kind: 'create', entity: 'bid', key: unit.key, data });
			} else bidWrites.push({ kind: 'update', entity: 'bid', key: unit.key, id, data });

			const bidRef: EntityRef | PendingBid = id === undefined ? { pendingBid: unit.key } : { type: site.bidType, id };
			const lines = options.allLines ? unit.lines : awardedLines;
			for (const line of lines) {
				const item = itemOf(all, line.target);
				const lkey = lineKey(unit.key, line.target);
				const percent = shares.get(`${bid.id}|${targetKey(line.target)}`) ?? null;
				const lineWhere = `${where}, ${item.label}`;
				// A row in a package price links its Shot or Asset and carries no amount: the figure is on the package's Bid.
				const priced = !line.excluded && !line.inPackage;
				const lineBase = priced ? toBase(line.total, bid, base) : null;
				const ldata: Record<string, FieldValue> = {
					[LINE.name]: `${item.label} ${vendor.name}`,
					[LINE.key]: lkey,
					[LINE.bid]: bidRef,
					[LINE.item]: item.ref === null ? null : isPendingRow(item.ref) ? item.ref : { type: item.ref.type, id: item.ref.id },
					[LINE.amount]: priced ? amount(line.total, lineWhere, warnings) : null,
					[LINE.currency]: bid.currency,
					[LINE.amountBase]: lineBase ? amount(lineBase, `${lineWhere} in ${base}`, warnings) : null,
					[LINE.share]: percent === null ? null : share(percent),
					[LINE.awardedBase]: percent !== null && lineBase ? amount(percentOf(lineBase, percent), `${lineWhere} awarded`, warnings) : null,
					[LINE.awarded]: percent !== null,
					[LINE.excluded]: line.excluded
				};
				const lid = lineRows.get(lkey);
				if (lid === undefined) lineWrites.push({ kind: 'create', entity: 'line', key: lkey, data: { ...ldata, project } });
				else lineWrites.push({ kind: 'update', entity: 'line', key: lkey, id: lid, data: ldata });
				if (item.ref === null) unlinkedLines++;
				linePreviews.push({
					key: lkey,
					item: item.label,
					target: item.target,
					ref: item.ref && !isPendingRow(item.ref) ? item.ref : null,
					vendor: vendor.name,
					action: lid === undefined ? 'create' : 'update',
					amount: priced ? line.total : null,
					amountBase: lineBase,
					share: percent,
					awardedBase: percent !== null && lineBase ? percentOf(lineBase, percent) : null,
					excluded: line.excluded,
					package: unit.packageName,
					inPackage: line.inPackage === true
				});
			}
			previews.push({
				key: unit.key,
				bidId: bid.id,
				vendor: vendor.name,
				package: unit.packageName,
				general: unit.general,
				action: id === undefined ? 'create' : 'update',
				status,
				currency: bid.currency,
				total: unit.total,
				totalBase: baseTotals[u],
				rate: bid.rate,
				group,
				lines: lines.length
			});
		});
	}

	// The vendor's Group on each awarded item, only where it is not there yet.
	const groupWrites: Write[] = [];
	const groupPreviews: GroupPreview[] = [];
	const wantedGroups = new Set<string>();
	const bidsById = new Map(bids.map((b) => [b.id, b]));
	const unlinked: { item: string; kind: Target['kind'] }[] = [];
	for (const pick of scenario.picks) {
		const item = itemOf(all, pick.target);
		const type = ITEM_OF[pick.target.kind];
		const ref = item.ref;
		if (ref === null) {
			unlinked.push({ item: item.label, kind: pick.target.kind });
			continue;
		}
		const field = site.vendorField[type];
		if (!field) throw new Error(`No vendor groups field on ${type}. The award cannot reach ${item.label}.`);
		const winners = [...new Set(pick.shares.map((s) => bidsById.get(s.bidId)!.vendorId))];
		const byGroup = new Map<number, string>();
		const withoutGroup: string[] = [];
		for (const v of winners) {
			const g = groupIds.get(v);
			const name = vendors.get(v)!.name;
			if (g === null || g === undefined) withoutGroup.push(name);
			else if (!byGroup.has(g)) byGroup.set(g, name);
		}
		const wanted = [...byGroup.keys()];
		const pending = isPendingRow(ref);
		if (!pending) for (const g of wanted) wantedGroups.add(`${type}:${ref.id}:${g}`);
		const present = new Set(pending ? [] : (existing.groups[itemKey(ref)] ?? []));
		const added = wanted.filter((g) => !present.has(g));
		groupPreviews.push({
			item: item.label,
			target: item.target,
			ref: pending ? null : ref,
			added,
			addedVendors: added.map((g) => byGroup.get(g)!),
			already: wanted.filter((g) => present.has(g)),
			withoutGroup
		});
		if (added.length > 0) groupWrites.push({ kind: 'addGroups', itemType: type, id: pending ? ref : ref.id, field, groups: added });
	}
	if (unlinkedLines > 0) {
		const names = unlinked.map((u) => u.item);
		warnings.push(
			`${unlinkedLines === 1 ? '1 Bid Line is' : `${unlinkedLines} Bid Lines are`} written with no Shot or Asset: ${names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`}. No Group is added for them.`
		);
	}

	const cleanup = takeBack(input, all, bidWrites, lineWrites, wantedGroups, warnings);
	const steps: Step[] = (
		[
			{ label: 'Take back what the scenario dropped', mode: 'batch', writes: cleanup.writes },
			{ label: 'Sequences', mode: 'batch', writes: missing.sequenceWrites },
			{ label: 'Shots and Assets', mode: 'batch', writes: missing.itemWrites },
			{ label: 'Bids', mode: 'batch', writes: bidWrites },
			{ label: 'Bid Lines and vendor Groups', mode: 'batch', writes: [...lineWrites, ...groupWrites] },
			{ label: 'App links', mode: 'single', writes: linkWrites }
		] as Step[]
	).filter((s) => s.writes.length > 0);
	return {
		steps,
		preview: {
			bids: previews,
			lines: linePreviews,
			groups: groupPreviews,
			removed: cleanup.preview,
			created: missing.created,
			sequences: missing.sequences,
			unlinked
		},
		collisions: missing.collisions,
		released: cleanup.released,
		warnings
	};
}

/**
 * What earlier runs wrote that this plan no longer wants: their Groups no pick needs, unless an award
 * outside the app's rows still needs them, then the rows they created that this plan does not write.
 * Keys are `sgbids/<request>/<vendor>/r<round>[/<kind>:<id>]`.
 */
function takeBack(input: AwardInput, all: Map<string, Item>, bidWrites: readonly Write[], lineWrites: readonly Write[], wanted: ReadonlySet<string>, warnings: string[]) {
	const writes: Write[] = [];
	const preview = {
		bids: [] as { key: string; vendor: string }[],
		lines: [] as { key: string; item: string; vendor: string }[],
		groups: [] as { item: string; ref: EntityRef; groups: number[] }[],
		items: [] as { key: string; type: CreatedType; id: number }[]
	};
	const released: number[] = [];
	const previous = input.previous;
	if (!previous) return { writes, preview, released };
	const byRef = new Map<string, string>();
	for (const item of all.values()) if (item.ref && !isPendingRow(item.ref)) byRef.set(itemKey(item.ref), item.label);
	const keyed = (w: Write) => (w.kind === 'create' || w.kind === 'update' ? w.key : null);
	const plannedBids = new Set(bidWrites.map(keyed));
	const plannedLines = new Set(lineWrites.map(keyed));
	const vendorName = new Map(input.request.vendors.map((v) => [v.id, v.name]));
	const vendorOf = (key: string) => vendorName.get(key.split('/')[2] ?? '') ?? 'A vendor';
	for (const g of previous.groups) {
		const remove = g.groups.filter((group) => {
			const k = `${g.itemType}:${g.id}:${group}`;
			return !wanted.has(k) && !input.existing.needed?.has(k);
		});
		if (remove.length === 0) continue;
		writes.push({ kind: 'removeGroups', itemType: g.itemType, id: g.id, field: g.field, groups: remove });
		const ref = { type: g.itemType, id: g.id };
		preview.groups.push({ item: byRef.get(itemKey(ref)) ?? `${g.itemType} ${g.id}`, ref, groups: remove });
	}
	for (const l of previous.lines) {
		if (!l.created || plannedLines.has(l.key)) continue;
		writes.push({ kind: 'delete', entity: 'line', key: l.key, id: l.id });
		const target = targetOfLine(l.key);
		preview.lines.push({ key: l.key, item: all.get(target)?.label ?? target, vendor: vendorOf(l.key) });
	}
	for (const b of previous.bids) {
		if (!b.created || plannedBids.has(b.key)) continue;
		for (const a of previous.attachments) if (a.key === b.key) writes.push({ kind: 'delete', entity: 'attachment', key: a.key, id: a.id });
		writes.push({ kind: 'delete', entity: 'bid', key: b.key, id: b.id });
		preview.bids.push({ key: b.key, vendor: vendorOf(b.key) });
	}
	// Shots and Assets an earlier run created that no row uses now. Sequences stay until the undo.
	for (const made of previous.items ?? []) {
		if (made.type === 'Sequence' || byRef.has(itemKey(made))) continue;
		const why = input.existing.itemLinks?.get(itemKey(made));
		if (why) {
			warnings.push(`${made.type} ${made.id}, created by an earlier publish, is no longer awarded and stays in Flow PT: ${why}.`);
			released.push(made.id);
			continue;
		}
		writes.push({ kind: 'delete', entity: 'item', itemType: made.type, key: made.key, id: made.id });
		preview.items.push({ key: made.key, type: made.type, id: made.id });
	}
	return { writes, preview, released };
}

/** One `_batch` request, as the site takes it (recipe 002). */
export type BatchRequest =
	| { readonly request_type: 'create'; readonly entity: string; readonly data: Record<string, unknown> }
	| { readonly request_type: 'update'; readonly entity: string; readonly record_id: number; readonly data: Record<string, unknown> }
	| { readonly request_type: 'delete'; readonly entity: string; readonly record_id: number };

function isPending(value: unknown): value is PendingBid {
	return typeof value === 'object' && value !== null && 'pendingBid' in value;
}

/** A row this run created, by key. */
function rowRef(key: string, rows: ReadonlyMap<string, EntityRef>): EntityRef {
	const ref = rows.get(key);
	if (!ref) throw new Error(`The new row ${key} has no id yet.`);
	return ref;
}

function resolveData(data: Readonly<Record<string, FieldValue>>, site: FptSite, bidIds: ReadonlyMap<string, number>, rows: ReadonlyMap<string, EntityRef>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [field, value] of Object.entries(data)) {
		if (isPending(value)) {
			const id = bidIds.get(value.pendingBid);
			if (id === undefined) throw new Error(`The Bid ${value.pendingBid} has no id yet.`);
			out[field] = { type: site.bidType, id };
		} else if (isPendingRow(value)) {
			const ref = rowRef(value.pendingRow, rows);
			out[field] = { type: ref.type, id: ref.id };
		} else out[field] = value;
	}
	return out;
}

/** A write as a batch request, with every new Bid's id, and every new row's, put in. */
export function toBatchRequest(write: Write, site: FptSite, bidIds: ReadonlyMap<string, number>, rows: ReadonlyMap<string, EntityRef> = new Map()): BatchRequest {
	const entity = (e: 'bid' | 'line') => (e === 'bid' ? site.bidType : site.lineType);
	switch (write.kind) {
		case 'removeGroups':
			return undoRequest(write);
		case 'delete':
			return {
				request_type: 'delete',
				entity: write.entity === 'attachment' ? 'Attachment' : write.entity === 'item' ? write.itemType : entity(write.entity),
				record_id: write.id
			};
		case 'createItem':
			return { request_type: 'create', entity: write.itemType, data: resolveData(write.data, site, bidIds, rows) };
		case 'create':
			return { request_type: 'create', entity: entity(write.entity), data: resolveData(write.data, site, bidIds, rows) };
		case 'update':
			return { request_type: 'update', entity: entity(write.entity), record_id: write.id, data: resolveData(write.data, site, bidIds, rows) };
		case 'addGroups':
			return {
				request_type: 'update',
				entity: write.itemType,
				record_id: typeof write.id === 'number' ? write.id : rowRef(write.id.pendingRow, rows).id,
				data: { [write.field]: { multi_entity_update_mode: 'add', value: write.groups.map((id) => ({ type: 'Group', id })) } }
			};
		case 'link': {
			const id = bidIds.get(write.key);
			if (id === undefined) throw new Error(`The Bid ${write.key} has no id yet.`);
			return { request_type: 'update', entity: site.bidType, record_id: id, data: { [BID.appLink]: { url: write.url, name: 'sg-bids' } } };
		}
	}
}

/** Batches of `size` at most, in order. */
export function chunk<T>(list: readonly T[], size = 200): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

/** What a run actually wrote. The undo is built from this, never from the plan. */
export interface Written {
	readonly bids: readonly { readonly key: string; readonly id: number; readonly created: boolean }[];
	readonly lines: readonly { readonly key: string; readonly id: number; readonly created: boolean }[];
	readonly groups: readonly { readonly itemType: ItemType; readonly id: number; readonly field: string; readonly groups: readonly number[] }[];
	/** Attachments minted by a link written on a Bid this run created, by the Bid's key. */
	readonly attachments: readonly { readonly key: string; readonly id: number }[];
	/** Shots, Assets and Sequences a publish created, by key. Absent in a record from before breakdowns. */
	readonly items?: readonly CreatedRow[];
}

/** A row a publish created: `shot:<item>`, `asset:<item>`, `sequence:<code>`. */
export interface CreatedRow {
	readonly key: string;
	readonly type: CreatedType;
	readonly id: number;
}

/** What a run took back of an earlier run's writes, by id. */
export interface Removed {
	readonly bids: readonly number[];
	readonly lines: readonly number[];
	readonly attachments: readonly number[];
	readonly groups: readonly { readonly itemType: ItemType; readonly id: number; readonly field: string; readonly groups: readonly number[] }[];
	/** Created rows deleted, or left in Flow PT as no longer the app's. */
	readonly items?: readonly number[];
}

export const NOTHING_REMOVED: Removed = { bids: [], lines: [], attachments: [], groups: [], items: [] };

export const NOTHING_WRITTEN: Written = { bids: [], lines: [], groups: [], attachments: [], items: [] };

/** Nothing the app wrote is left. */
export function isClean(written: Written): boolean {
	return written.bids.length + written.lines.length + written.groups.length + written.attachments.length + (written.items?.length ?? 0) === 0;
}

type WrittenRow = { readonly key: string; readonly id: number; readonly created: boolean };

function mergeRows(previous: readonly WrittenRow[], run: readonly WrittenRow[], gone: readonly number[]): WrittenRow[] {
	const out = new Map<string, WrittenRow>();
	for (const r of previous) if (!gone.includes(r.id)) out.set(r.key, r);
	for (const r of run) {
		const was = out.get(r.key);
		out.set(r.key, { key: r.key, id: r.id, created: r.created || (was?.created ?? false) });
	}
	return [...out.values()];
}

/**
 * Every run of an award, as one: a row an earlier run created stays created when a later run only
 * updates it, so the undo still deletes it. Groups and Attachments taken back leave the record.
 */
export function mergeWritten(previous: Written | null, run: Written, removed: Removed = NOTHING_REMOVED): Written {
	if (!previous) return run;
	const off = new Set(removed.groups.flatMap((g) => g.groups.map((group) => `${g.itemType}:${g.id}:${group}`)));
	const groups = new Map<string, { itemType: ItemType; id: number; field: string; groups: number[] }>();
	for (const g of [...previous.groups, ...run.groups]) {
		const k = `${g.itemType}:${g.id}`;
		const entry = groups.get(k) ?? { itemType: g.itemType, id: g.id, field: g.field, groups: [] };
		for (const group of g.groups) if (!off.has(`${k}:${group}`) && !entry.groups.includes(group)) entry.groups.push(group);
		groups.set(k, entry);
	}
	const kept = previous.attachments.filter((a) => !removed.attachments.includes(a.id));
	const items = new Map<string, CreatedRow>();
	for (const i of [...(previous.items ?? []), ...(run.items ?? [])]) if (!(removed.items ?? []).includes(i.id)) items.set(i.key, i);
	return {
		bids: mergeRows(previous.bids, run.bids, removed.bids),
		lines: mergeRows(previous.lines, run.lines, removed.lines),
		groups: [...groups.values()].filter((g) => g.groups.length > 0),
		attachments: [...kept, ...run.attachments.filter((a) => !kept.some((p) => p.id === a.id))],
		items: [...items.values()]
	};
}

/** A row read back: the API's shape. */
export interface ReadRow {
	readonly id: number;
	readonly attributes: Readonly<Record<string, unknown>>;
	readonly relationships: Readonly<Record<string, { readonly data: unknown }>>;
}

export interface ReadBack {
	readonly bids: ReadonlyMap<string, ReadRow>;
	readonly lines: ReadonlyMap<string, ReadRow>;
	/** Group ids on each item's vendor field, keyed `Shot:123`. */
	readonly groups: Readonly<Record<string, readonly number[]>>;
	/** The rows this run created, by key. */
	readonly items?: ReadonlyMap<string, ReadRow>;
}

const TYPES: ReadonlyMap<string, string> = new Map([...BID_FIELDS, ...LINE_FIELDS].map((f) => [f.name, f.dataType]));

function refOf(value: unknown): { type: unknown; id: unknown } | null {
	return value && typeof value === 'object' ? (value as { type: unknown; id: unknown }) : null;
}

function same(field: string, sent: unknown, row: ReadRow, site: FptSite, bidIds: ReadonlyMap<string, number>, rows: ReadonlyMap<string, EntityRef>, created = false): boolean {
	// A created Shot's or Asset's link is any object sent; its scalars are compared as sent.
	const type = field === 'project' ? 'entity' : created ? (sent !== null && typeof sent === 'object' ? 'entity' : 'value') : TYPES.get(field);
	if (type === 'entity') {
		const want = isPending(sent) ? { type: site.bidType, id: bidIds.get(sent.pendingBid) } : isPendingRow(sent) ? (rows.get(sent.pendingRow) ?? { type: null, id: null }) : refOf(sent);
		const got = refOf(row.relationships[field]?.data);
		return want === null ? got === null : got !== null && got.type === want.type && got.id === want.id;
	}
	const got = row.attributes[field];
	if (type === 'currency') return sameCurrency(got, sent as string | null);
	if (type === 'float') return sent === null ? got === null : got !== null && Number(got) === Number(sent);
	return (got ?? null) === sent;
}

/** Every difference between what the plan wrote and what the site reads back. */
export function verify(plan: AwardPlan, back: ReadBack, site: FptSite, bidIds: ReadonlyMap<string, number>, rows: ReadonlyMap<string, EntityRef> = new Map()): string[] {
	const problems: string[] = [];
	for (const step of plan.steps) {
		for (const write of step.writes) {
			if (write.kind === 'createItem') {
				const row = back.items?.get(write.key);
				if (!row) {
					problems.push(`${write.key}: no row reads back.`);
					continue;
				}
				for (const [field, sent] of Object.entries(write.data)) {
					if (!same(field, sent, row, site, bidIds, rows, true)) problems.push(`${write.key}: ${field} reads back ${JSON.stringify(row.attributes[field] ?? row.relationships[field]?.data ?? null)}.`);
				}
				continue;
			}
			if (write.kind === 'addGroups') {
				const id = typeof write.id === 'number' ? write.id : rows.get(write.id.pendingRow)?.id;
				const have = new Set(back.groups[`${write.itemType}:${id}`] ?? []);
				for (const g of write.groups) if (!have.has(g)) problems.push(`${write.itemType} ${id ?? write.id}: Group ${g} is not in ${write.field}.`);
				continue;
			}
			if (write.kind === 'removeGroups') {
				const have = new Set(back.groups[`${write.itemType}:${write.id}`] ?? []);
				for (const g of write.groups) if (have.has(g)) problems.push(`${write.itemType} ${write.id}: Group ${g} is still in ${write.field}.`);
				continue;
			}
			if (write.kind === 'delete') {
				if (write.entity === 'bid' || write.entity === 'line') {
					if ((write.entity === 'bid' ? back.bids : back.lines).has(write.key)) problems.push(`${write.key}: the row is still there.`);
				} else if (write.entity === 'item' && back.items?.has(write.key)) problems.push(`${write.key}: the row is still there.`);
				continue;
			}
			if (write.kind === 'link') {
				const got = refOf(back.bids.get(write.key)?.attributes[BID.appLink]) as { url?: unknown } | null;
				if (got?.url !== write.url) problems.push(`${write.key}: ${BID.appLink} reads back ${JSON.stringify(got?.url ?? null)}.`);
				continue;
			}
			const row = (write.entity === 'bid' ? back.bids : back.lines).get(write.key);
			if (!row) {
				problems.push(`${write.key}: no row reads back.`);
				continue;
			}
			for (const [field, sent] of Object.entries(write.data)) {
				if (!same(field, sent, row, site, bidIds, rows)) problems.push(`${write.key}: ${field} reads back ${JSON.stringify(row.attributes[field] ?? row.relationships[field]?.data ?? null)}.`);
			}
		}
	}
	return problems;
}

/** The Attachment a Bid's link minted, from its read-back. */
export function attachmentOf(row: ReadRow | undefined): number | null {
	const link = refOf(row?.attributes[BID.appLink]);
	return link && link.type === 'Attachment' && typeof link.id === 'number' ? link.id : null;
}

export type UndoWrite =
	| { readonly kind: 'removeGroups'; readonly itemType: ItemType; readonly id: number; readonly field: string; readonly groups: readonly number[] }
	| { readonly kind: 'delete'; readonly entityType: string; readonly id: number };

export interface UndoPlan {
	readonly writes: readonly UndoWrite[];
	/** Groups left on an item because another award there still needs them. */
	readonly kept: readonly { readonly itemType: ItemType; readonly id: number; readonly group: number }[];
	/** Rows this run updated in place. The undo leaves them as they are. */
	readonly untouched: readonly string[];
	/** Rows a publish created that gained links since: left in Flow PT, with why. */
	readonly left: readonly (CreatedRow & { readonly why: string })[];
}

/**
 * Take the Groups away first, so access goes before the rows, then delete the lines, the Attachments
 * and the Bids this run created, then the Shots and Assets it created, the Sequences last.
 * `stillNeeded` holds `Shot:123:38` for each Group another awarded line on the item still needs
 * (recipe 009). `linked` holds `Shot:123` for each created row that gained links since, with why:
 * it stays. Rows the run only updated stay.
 */
export function planUndo(written: Written, site: FptSite, stillNeeded: ReadonlySet<string> = new Set(), linked: ReadonlyMap<string, string> = new Map()): UndoPlan {
	const writes: UndoWrite[] = [];
	const kept: { itemType: ItemType; id: number; group: number }[] = [];
	for (const g of written.groups) {
		const remove = g.groups.filter((group) => !stillNeeded.has(`${g.itemType}:${g.id}:${group}`));
		for (const group of g.groups) if (!remove.includes(group)) kept.push({ itemType: g.itemType, id: g.id, group });
		if (remove.length > 0) writes.push({ kind: 'removeGroups', itemType: g.itemType, id: g.id, field: g.field, groups: remove });
	}
	for (const l of written.lines) if (l.created) writes.push({ kind: 'delete', entityType: site.lineType, id: l.id });
	for (const a of written.attachments) writes.push({ kind: 'delete', entityType: 'Attachment', id: a.id });
	for (const b of written.bids) if (b.created) writes.push({ kind: 'delete', entityType: site.bidType, id: b.id });
	const left: (CreatedRow & { why: string })[] = [];
	const items = written.items ?? [];
	for (const i of [...items.filter((x) => x.type !== 'Sequence'), ...items.filter((x) => x.type === 'Sequence')]) {
		const why = linked.get(`${i.type}:${i.id}`);
		if (why) left.push({ ...i, why });
		else writes.push({ kind: 'delete', entityType: i.type, id: i.id });
	}
	const untouched = [...written.bids, ...written.lines].filter((r) => !r.created).map((r) => r.key);
	return { writes, kept, untouched, left };
}

export function undoRequest(write: UndoWrite): BatchRequest {
	if (write.kind === 'delete') return { request_type: 'delete', entity: write.entityType, record_id: write.id };
	return {
		request_type: 'update',
		entity: write.itemType,
		record_id: write.id,
		data: { [write.field]: { multi_entity_update_mode: 'remove', value: write.groups.map((id) => ({ type: 'Group', id })) } }
	};
}

/** The `_summarize` that totals each item's awarded lines in the base currency, one call (167). */
export function awardedTotalsQuery(site: FptSite, items: readonly EntityRef[], baseCurrency: string) {
	return {
		filters: {
			logical_operator: 'and' as const,
			conditions: [
				['project', 'is', { type: 'Project', id: site.projectId }],
				[LINE.item, 'in', items.map((i) => ({ type: i.type, id: i.id }))],
				[LINE.awarded, 'is', true],
				[`${LINE.bid}.${site.bidType}.${BID.baseCurrency}`, 'is', baseCurrency]
			] as [string, 'is' | 'in', unknown][]
		},
		summaryFields: [
			{ field: LINE.awardedBase, type: 'sum' as const },
			{ field: 'id', type: 'count' as const }
		],
		grouping: [{ field: LINE.item, type: 'exact', direction: 'asc' as const }]
	};
}

/**
 * Each item's awarded total from the `_summarize` answer, keyed `Shot:123`. A sum is a JSON number of
 * two-decimal values (field_types/currency), read at two decimals, or none for a zero-digit currency.
 */
export function awardedTotals(
	groups: readonly { readonly groupValue: unknown; readonly summaries: Readonly<Record<string, number>> }[],
	baseCurrency: string
): Record<string, { readonly total: Money; readonly lines: number }> {
	const places = Math.min(2, minorDigits(baseCurrency));
	const out: Record<string, { total: Money; lines: number }> = {};
	for (const g of groups) {
		const ref = refOf(g.groupValue);
		if (!ref || typeof ref.type !== 'string' || typeof ref.id !== 'number') continue;
		const sum = g.summaries[LINE.awardedBase] ?? 0;
		out[`${ref.type}:${ref.id}`] = { total: fromDecimal(sum.toFixed(places), baseCurrency), lines: g.summaries.id ?? 0 };
	}
	return out;
}
