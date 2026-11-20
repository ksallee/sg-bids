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
 */

import { BID, BID_FIELDS, LINE, LINE_FIELDS, sameCurrency, toFptCurrency, type FptAmount } from './fpt-fields';
import type { AppStatus, ItemType } from './fpt-setup';
import { applyScenario } from './compare';
import { targetKey, type AwardScenario, type BidRequest, type Day, type EntityRef, type Id, type InvitedVendor, type Target, type VendorBid } from './model';
import { fromDecimal, minorDigits, toDecimal, type Money, type Rate } from './money';
import { percentOf } from './percent';
import { estimateRebate } from './rebate';
import { bidTotals, toBase } from './totals';

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
}

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
}

/** A new Bid's id, put in once the Bid step answers. */
export interface PendingBid {
	readonly pendingBid: string;
}

export type FieldValue = string | number | boolean | null | EntityRef | PendingBid;

export type Write =
	| { readonly kind: 'create'; readonly entity: 'bid' | 'line'; readonly key: string; readonly data: Readonly<Record<string, FieldValue>> }
	| { readonly kind: 'update'; readonly entity: 'bid' | 'line'; readonly key: string; readonly id: number; readonly data: Readonly<Record<string, FieldValue>> }
	| {
			readonly kind: 'addGroups';
			readonly itemType: ItemType;
			readonly id: number;
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
	| { readonly kind: 'delete'; readonly entity: 'bid' | 'line' | 'attachment'; readonly key: string; readonly id: number };

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
	readonly ref: EntityRef;
	readonly vendor: string;
	readonly action: 'create' | 'update';
	/** Null when excluded. */
	readonly amount: Money | null;
	readonly amountBase: Money | null;
	/** The vendor's share of the item, null when not awarded. */
	readonly share: string | null;
	readonly awardedBase: Money | null;
	readonly excluded: boolean;
}

export interface GroupPreview {
	readonly item: string;
	readonly ref: EntityRef;
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
}

export interface AwardPlan {
	readonly steps: readonly Step[];
	readonly preview: {
		readonly bids: readonly BidPreview[];
		readonly lines: readonly LinePreview[];
		readonly groups: readonly GroupPreview[];
		/** What an earlier run wrote that this plan takes back. */
		readonly removed: RemovedPreview;
	};
	/** What the site cannot hold exactly, or what is left unwritten, in plain words. */
	readonly warnings: readonly string[];
}

/** One Bid per vendor per round of a request. */
export function bidKey(requestId: Id, vendorId: Id, round: number): string {
	return `sgbids/${requestId}/${vendorId}/r${round}`;
}

export function lineKey(bid: string, target: Target): string {
	return `${bid}/${targetKey(target)}`;
}

/** `Shot:123`, the key of an item in `Existing.groups`. */
export function itemKey(ref: EntityRef): string {
	return `${ref.type}:${ref.id}`;
}

const ITEM_OF: Readonly<Record<Target['kind'], ItemType>> = { shot: 'Shot', asset: 'Asset' };

interface Item {
	readonly label: string;
	readonly ref: EntityRef;
}

function items(request: BidRequest): Map<string, Item | null> {
	const out = new Map<string, Item | null>();
	for (const s of request.shots) out.set(targetKey({ kind: 'shot', id: s.id }), s.fpt ? { label: s.code, ref: s.fpt } : null);
	for (const a of request.assets) out.set(targetKey({ kind: 'asset', id: a.id }), a.fpt ? { label: a.name, ref: a.fpt } : null);
	return out;
}

function itemOf(all: Map<string, Item | null>, target: Target): Item {
	const item = all.get(targetKey(target));
	if (!item) throw new Error(`The ${target.kind} ${target.id} has no Flow PT ${ITEM_OF[target.kind]}.`);
	if (item.ref.type !== ITEM_OF[target.kind]) throw new Error(`The ${target.kind} ${target.id} points at a ${item.ref.type}.`);
	return item;
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

export function planAward(input: AwardInput): AwardPlan {
	const { request, bids, scenario, options, site, existing } = input;
	applyScenario(request, bids, scenario); // throws on a scenario that does not hold together
	const base = request.header.baseCurrency;
	const all = items(request);
	const vendors = new Map(request.vendors.map((v) => [v.id, v]));
	const bidRows = new Map(existing.bids.map((b) => [b.key, b.id]));
	const lineRows = new Map(existing.lines.map((l) => [l.key, l.id]));
	const warnings: string[] = [];
	const project: EntityRef = { type: 'Project', id: site.projectId };
	const requestCode = options.requestCode ?? request.id;

	// Shares per bid and target, from the scenario.
	const shares = new Map<string, string>();
	for (const pick of scenario.picks) {
		for (const s of pick.shares) shares.set(`${s.bidId}|${targetKey(pick.target)}`, s.percent);
	}

	const bidWrites: Write[] = [];
	const lineWrites: Write[] = [];
	const linkWrites: Write[] = [];
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
		const key = bidKey(request.id, bid.vendorId, bid.round);
		if (seenKeys.has(key)) throw new Error(`Two bids from ${vendor.name} for round ${bid.round}. Publish one.`);
		seenKeys.add(key);

		const totals = bidTotals(bid, base);
		const rebate = estimateRebate(bid, base);
		const awardedLines = bid.lines.filter((l) => shares.has(`${bid.id}|${targetKey(l.target)}`));
		const status: AppStatus = awardedLines.length > 0 ? 'awarded' : 'not_awarded';
		const where = `${vendor.name}'s bid`;
		const id = bidRows.get(key);
		const data: Record<string, FieldValue> = {
			[BID.name]: `${requestCode} ${vendor.name} R${bid.round}`,
			[BID.key]: key,
			[BID.vendor]: group === null ? null : { type: 'Group', id: group },
			[BID.round]: bid.round,
			[BID.total]: amount(totals.grand.bid, `${where} total`, warnings),
			[BID.currency]: bid.currency,
			[BID.totalBase]: amount(totals.grand.base, `${where} total in ${base}`, warnings),
			[BID.baseCurrency]: base,
			[BID.rebate]: rebate.rebate ? amount(rebate.rebate.base, `${where} rebate`, warnings) : null,
			[BID.afterRebate]: rebate.afterRebate ? amount(rebate.afterRebate.base, `${where} total after rebate`, warnings) : null,
			[BID.rate]: bid.rate?.rate ?? null,
			[BID.rateDate]: bid.rate?.date ?? null,
			[BID.requestCode]: requestCode,
			[BID.submitted]: bid.date,
			[BID.awarded]: status === 'awarded' ? options.date : null
		};
		if (rebate.rebate === null) warnings.push(`${where}: the rebate is unknown. Its estimate is left empty.`);
		if (/^\d+$/.test(bid.number) && Number(bid.number) <= 2147483647) data[BID.version] = Number(bid.number);
		else warnings.push(`${where}: bid number '${bid.number}' is not a whole number. Bid Version is left empty.`);
		const code = site.statuses[status];
		if (code) data[BID.status] = code;
		else warnings.push(`${where}: the project has no status for ${status.replace('_', ' ')}. The status is left as it is.`);
		if (id === undefined) {
			data.project = project;
			const link = options.appLinks?.[bid.id];
			if (link) linkWrites.push({ kind: 'link', key, url: link });
			bidWrites.push({ kind: 'create', entity: 'bid', key, data });
		} else bidWrites.push({ kind: 'update', entity: 'bid', key, id, data });

		const bidRef: EntityRef | PendingBid = id === undefined ? { pendingBid: key } : { type: site.bidType, id };
		const lines = options.allLines ? bid.lines : awardedLines;
		for (const line of lines) {
			const item = itemOf(all, line.target);
			const lkey = lineKey(key, line.target);
			const percent = shares.get(`${bid.id}|${targetKey(line.target)}`) ?? null;
			const lineWhere = `${where}, ${item.label}`;
			const lineBase = line.excluded ? null : toBase(line.total, bid, base);
			const ldata: Record<string, FieldValue> = {
				[LINE.name]: `${item.label} ${vendor.name}`,
				[LINE.key]: lkey,
				[LINE.bid]: bidRef,
				[LINE.item]: { type: item.ref.type, id: item.ref.id },
				[LINE.amount]: line.excluded ? null : amount(line.total, lineWhere, warnings),
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
			linePreviews.push({
				key: lkey,
				item: item.label,
				ref: item.ref,
				vendor: vendor.name,
				action: lid === undefined ? 'create' : 'update',
				amount: line.excluded ? null : line.total,
				amountBase: lineBase,
				share: percent,
				awardedBase: percent !== null && lineBase ? percentOf(lineBase, percent) : null,
				excluded: line.excluded
			});
		}
		previews.push({
			key,
			bidId: bid.id,
			vendor: vendor.name,
			action: id === undefined ? 'create' : 'update',
			status,
			currency: bid.currency,
			total: totals.grand.bid,
			totalBase: totals.grand.base,
			rate: bid.rate,
			group,
			lines: lines.length
		});
	}

	// The vendor's Group on each awarded item, only where it is not there yet.
	const groupWrites: Write[] = [];
	const groupPreviews: GroupPreview[] = [];
	const wantedGroups = new Set<string>();
	const bidsById = new Map(bids.map((b) => [b.id, b]));
	for (const pick of scenario.picks) {
		const item = itemOf(all, pick.target);
		const type = ITEM_OF[pick.target.kind];
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
		for (const g of wanted) wantedGroups.add(`${type}:${item.ref.id}:${g}`);
		const present = new Set(existing.groups[itemKey(item.ref)] ?? []);
		const added = wanted.filter((g) => !present.has(g));
		groupPreviews.push({
			item: item.label,
			ref: item.ref,
			added,
			addedVendors: added.map((g) => byGroup.get(g)!),
			already: wanted.filter((g) => present.has(g)),
			withoutGroup
		});
		if (added.length > 0) groupWrites.push({ kind: 'addGroups', itemType: type, id: item.ref.id, field, groups: added });
	}

	const cleanup = takeBack(input, all, bidWrites, lineWrites, wantedGroups);
	const steps: Step[] = (
		[
			{ label: 'Take back what the scenario dropped', mode: 'batch', writes: cleanup.writes },
			{ label: 'Bids', mode: 'batch', writes: bidWrites },
			{ label: 'Bid Lines and vendor Groups', mode: 'batch', writes: [...lineWrites, ...groupWrites] },
			{ label: 'App links', mode: 'single', writes: linkWrites }
		] as Step[]
	).filter((s) => s.writes.length > 0);
	return { steps, preview: { bids: previews, lines: linePreviews, groups: groupPreviews, removed: cleanup.preview }, warnings };
}

/**
 * What earlier runs wrote that this plan no longer wants: their Groups no pick needs, unless an award
 * outside the app's rows still needs them, then the rows they created that this plan does not write.
 * Keys are `sgbids/<request>/<vendor>/r<round>[/<kind>:<id>]`.
 */
function takeBack(input: AwardInput, all: Map<string, Item | null>, bidWrites: readonly Write[], lineWrites: readonly Write[], wanted: ReadonlySet<string>) {
	const writes: Write[] = [];
	const preview = {
		bids: [] as { key: string; vendor: string }[],
		lines: [] as { key: string; item: string; vendor: string }[],
		groups: [] as { item: string; ref: EntityRef; groups: number[] }[]
	};
	const previous = input.previous;
	if (!previous) return { writes, preview };
	const byRef = new Map<string, string>();
	for (const item of all.values()) if (item) byRef.set(itemKey(item.ref), item.label);
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
		const target = l.key.split('/').slice(4).join('/');
		preview.lines.push({ key: l.key, item: all.get(target)?.label ?? target, vendor: vendorOf(l.key) });
	}
	for (const b of previous.bids) {
		if (!b.created || plannedBids.has(b.key)) continue;
		for (const a of previous.attachments) if (a.key === b.key) writes.push({ kind: 'delete', entity: 'attachment', key: a.key, id: a.id });
		writes.push({ kind: 'delete', entity: 'bid', key: b.key, id: b.id });
		preview.bids.push({ key: b.key, vendor: vendorOf(b.key) });
	}
	return { writes, preview };
}

/** One `_batch` request, as the site takes it (recipe 002). */
export type BatchRequest =
	| { readonly request_type: 'create'; readonly entity: string; readonly data: Record<string, unknown> }
	| { readonly request_type: 'update'; readonly entity: string; readonly record_id: number; readonly data: Record<string, unknown> }
	| { readonly request_type: 'delete'; readonly entity: string; readonly record_id: number };

function isPending(value: unknown): value is PendingBid {
	return typeof value === 'object' && value !== null && 'pendingBid' in value;
}

function resolveData(data: Readonly<Record<string, FieldValue>>, site: FptSite, bidIds: ReadonlyMap<string, number>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [field, value] of Object.entries(data)) {
		if (isPending(value)) {
			const id = bidIds.get(value.pendingBid);
			if (id === undefined) throw new Error(`The Bid ${value.pendingBid} has no id yet.`);
			out[field] = { type: site.bidType, id };
		} else out[field] = value;
	}
	return out;
}

/** A write as a batch request, with every new Bid's id put in. */
export function toBatchRequest(write: Write, site: FptSite, bidIds: ReadonlyMap<string, number>): BatchRequest {
	const entity = (e: 'bid' | 'line') => (e === 'bid' ? site.bidType : site.lineType);
	switch (write.kind) {
		case 'removeGroups':
			return undoRequest(write);
		case 'delete':
			return { request_type: 'delete', entity: write.entity === 'attachment' ? 'Attachment' : entity(write.entity), record_id: write.id };
		case 'create':
			return { request_type: 'create', entity: entity(write.entity), data: resolveData(write.data, site, bidIds) };
		case 'update':
			return { request_type: 'update', entity: entity(write.entity), record_id: write.id, data: resolveData(write.data, site, bidIds) };
		case 'addGroups':
			return {
				request_type: 'update',
				entity: write.itemType,
				record_id: write.id,
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
}

/** What a run took back of an earlier run's writes, by id. */
export interface Removed {
	readonly bids: readonly number[];
	readonly lines: readonly number[];
	readonly attachments: readonly number[];
	readonly groups: readonly { readonly itemType: ItemType; readonly id: number; readonly field: string; readonly groups: readonly number[] }[];
}

export const NOTHING_REMOVED: Removed = { bids: [], lines: [], attachments: [], groups: [] };

export const NOTHING_WRITTEN: Written = { bids: [], lines: [], groups: [], attachments: [] };

/** Nothing the app wrote is left. */
export function isClean(written: Written): boolean {
	return written.bids.length + written.lines.length + written.groups.length + written.attachments.length === 0;
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
	return {
		bids: mergeRows(previous.bids, run.bids, removed.bids),
		lines: mergeRows(previous.lines, run.lines, removed.lines),
		groups: [...groups.values()].filter((g) => g.groups.length > 0),
		attachments: [...kept, ...run.attachments.filter((a) => !kept.some((p) => p.id === a.id))]
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
}

const TYPES: ReadonlyMap<string, string> = new Map([...BID_FIELDS, ...LINE_FIELDS].map((f) => [f.name, f.dataType]));

function refOf(value: unknown): { type: unknown; id: unknown } | null {
	return value && typeof value === 'object' ? (value as { type: unknown; id: unknown }) : null;
}

function same(field: string, sent: unknown, row: ReadRow, site: FptSite, bidIds: ReadonlyMap<string, number>): boolean {
	const type = field === 'project' ? 'entity' : TYPES.get(field);
	if (type === 'entity') {
		const want = isPending(sent) ? { type: site.bidType, id: bidIds.get(sent.pendingBid) } : refOf(sent);
		const got = refOf(row.relationships[field]?.data);
		return want === null ? got === null : got !== null && got.type === want.type && got.id === want.id;
	}
	const got = row.attributes[field];
	if (type === 'currency') return sameCurrency(got, sent as string | null);
	if (type === 'float') return sent === null ? got === null : got !== null && Number(got) === Number(sent);
	return (got ?? null) === sent;
}

/** Every difference between what the plan wrote and what the site reads back. */
export function verify(plan: AwardPlan, back: ReadBack, site: FptSite, bidIds: ReadonlyMap<string, number>): string[] {
	const problems: string[] = [];
	for (const step of plan.steps) {
		for (const write of step.writes) {
			if (write.kind === 'addGroups') {
				const have = new Set(back.groups[`${write.itemType}:${write.id}`] ?? []);
				for (const g of write.groups) if (!have.has(g)) problems.push(`${write.itemType} ${write.id}: Group ${g} is not in ${write.field}.`);
				continue;
			}
			if (write.kind === 'removeGroups') {
				const have = new Set(back.groups[`${write.itemType}:${write.id}`] ?? []);
				for (const g of write.groups) if (have.has(g)) problems.push(`${write.itemType} ${write.id}: Group ${g} is still in ${write.field}.`);
				continue;
			}
			if (write.kind === 'delete') {
				if (write.entity !== 'attachment' && (write.entity === 'bid' ? back.bids : back.lines).has(write.key)) problems.push(`${write.key}: the row is still there.`);
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
				if (!same(field, sent, row, site, bidIds)) problems.push(`${write.key}: ${field} reads back ${JSON.stringify(row.attributes[field] ?? row.relationships[field]?.data ?? null)}.`);
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
}

/**
 * Take the Groups away first, so access goes before the rows, then delete the lines, the Attachments
 * and the Bids this run created. `stillNeeded` holds `Shot:123:38` for each Group another awarded line
 * on the item still needs (recipe 009). Rows the run only updated stay.
 */
export function planUndo(written: Written, site: FptSite, stillNeeded: ReadonlySet<string> = new Set()): UndoPlan {
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
	const untouched = [...written.bids, ...written.lines].filter((r) => !r.created).map((r) => r.key);
	return { writes, kept, untouched };
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
