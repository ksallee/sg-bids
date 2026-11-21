/**
 * Rows of the database (`supabase/migrations/`) to the model (`model.ts`) and back.
 *
 * What is queried is a column: tenant, status, currency, the rate, a line's total in minor units.
 * The rest of a header, a shot's fields and a line's detail is jsonb, in the model's own shape.
 *
 * - A request's `projectRef` is never stored: the tenant's project is the project.
 * - A request's vendors are its invitations. The request row holds none, so a vendor reading the
 *   request learns nothing of the others.
 * - A shot or asset is a request item: kind, key (the model's id), code (shot code or asset name),
 *   and where it came from (`source`): Flow PT, or a breakdown with no Flow PT row until matched.
 *   Its count is a column, `unit_count`, 1 unless the row stands for several (`count.ts`). A line's
 *   unit price, on such a row, is in its detail.
 * - A bid's vendor is its invitation. A line points at its item by kind and key.
 * - A rate is kept as the exact string typed, never a float.
 * - A request's packages are rows of their own (`request_packages`), keyed by the model's package
 *   id; an item names its package in `package_key`, and a package names the production bid it comes
 *   from in `bid_id`. An invitation's packages are `package_keys`, null for every package. A bid's
 *   package figures are `packages`, in the model's shape, and a line covered by one has `in_package`.
 * - A production bid is a row (`production_bids`) and its rows (`production_bid_items`), the
 *   columns of a request item without the package.
 */

import type {
	AwardScenario,
	ProductionBid,
	BidLine,
	BidRequest,
	EntityRef,
	Id,
	InvitedVendor,
	ItemSource,
	RequestAsset,
	RequestHeader,
	RequestPackage,
	RequestShot,
	ScenarioPick,
	Target,
	VendorBid
} from './model';
import { targetKey } from './model';
import { countOf, isCount } from './count';
import { minorDigits, money } from './money';
import { isPercent } from './percent';
import { checkBid } from './totals';

type Json = Record<string, unknown>;

interface Tenant {
	site_host: string;
	project_id: number;
}

export type RequestStatus = 'draft' | 'issued' | 'awarded' | 'closed';
export type BidRowStatus = 'draft' | 'submitted' | 'withdrawn';

export interface RequestRow extends Tenant {
	id: string;
	code: string;
	round: number;
	status: RequestStatus;
	base_currency: string;
	header: Json;
	due_on: string | null;
	issued_at: string | null;
	closed_at: string | null;
	created_at: string;
	updated_at: string;
}

/** A shot or asset as written: everything but its row id and parents. */
export interface ItemColumns {
	kind: 'shot' | 'asset';
	key: string;
	code: string;
	position: number;
	fpt_type: string | null;
	fpt_id: number | null;
	fields: Json;
	omitted: boolean;
	/** `fpt` for a row picked from Flow PT, `breakdown` for one pasted, imported or typed. */
	source: 'fpt' | 'breakdown';
	/** The package the row sits in. Null in a request from before packages. */
	package_key?: string | null;
	/** How many the row stands for (`count.ts`). 1 for a row linked to Flow PT; absent reads as 1. */
	unit_count?: number;
}

/** A package as written: its key, name and place. */
export interface PackageColumns {
	key: string;
	name: string;
}

export interface RequestPackageRow extends Tenant, PackageColumns {
	id: string;
	request_id: string;
	position: number;
	/** The production bid the package comes from. Null for a package made before bids, or once its bid is deleted. */
	bid_id?: string | null;
}

/** A production bid as stored, with the counts its functions keep. */
export interface ProductionBidRow extends Tenant {
	id: string;
	name: string;
	shot_count: number;
	asset_count: number;
	omitted_count: number;
	frame_count: number;
	created_at: string;
	updated_at: string;
}

/** A production bid's row as written: a request item's columns without the package. */
export type BidItemColumns = Omit<ItemColumns, 'package_key'>;

export interface ProductionBidItemRow extends Tenant, BidItemColumns {
	id: string;
	bid_id: string;
}

export interface RequestItemRow extends Tenant, ItemColumns {
	id: string;
	request_id: string;
	/** When a breakdown row got its Flow PT row after the issue. */
	fpt_linked_at?: string | null;
}

export interface VendorColumns {
	vendor_name: string;
	vendor_group_id: number | null;
	contact_email: string;
	details: Json;
	/** The packages the vendor is invited to. Null: every package. */
	package_keys: string[] | null;
}

export interface InvitationRow extends Tenant, VendorColumns {
	id: string;
	request_id: string;
	token_hash: string;
	expires_at: string;
	revoked_at: string | null;
	last_opened_at: string | null;
	created_at: string;
}

export interface BidColumns {
	currency: string;
	exchange_rate: string | null;
	exchange_rate_date: string | null;
	header: Json;
	non_shot_costs: unknown[];
	rebate_splits: unknown[];
	/** Packages priced as one figure, in the model's shape. */
	packages: unknown[];
}

export interface BidRow extends Tenant, BidColumns {
	id: string;
	invitation_id: string;
	request_id: string;
	version: number;
	status: BidRowStatus;
	submitted_at: string | null;
	withdrawn_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface LineColumns {
	item_kind: 'shot' | 'asset';
	item_key: string;
	total_minor: number;
	excluded: boolean;
	detail: Json;
	/** Covered by its package's figure. */
	in_package: boolean;
}

export interface BidLineRow extends Tenant, LineColumns {
	id: string;
	bid_id: string;
	invitation_id: string;
	request_id: string;
}

export interface ScenarioRow extends Tenant {
	id: string;
	request_id: string;
	name: string;
	created_at: string;
	updated_at: string;
}

export interface ScenarioItemColumns {
	item_kind: 'shot' | 'asset';
	item_key: string;
	bid_id: string;
	share_percent: string;
	position: number;
}

export interface ScenarioItemRow extends Tenant, ScenarioItemColumns {
	id: string;
	scenario_id: string;
	request_id: string;
}

/** Drops keys whose value is undefined, so jsonb and the model match key for key. */
function defined(record: Json): Json {
	return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The request.

export function headerToColumns(header: RequestHeader): Pick<RequestRow, 'round' | 'base_currency' | 'due_on' | 'header'> {
	minorDigits(header.baseCurrency);
	if (!Number.isSafeInteger(header.round) || header.round < 1) throw new Error(`Round ${header.round} is not a whole number from 1.`);
	if (header.dueDate !== undefined && !DAY.test(header.dueDate)) throw new Error(`'${header.dueDate}' is not a day written YYYY-MM-DD.`);
	const { round, baseCurrency, dueDate, projectRef, ...rest } = header;
	return { round, base_currency: baseCurrency, due_on: dueDate ?? null, header: defined(rest) };
}

function entity(type: string | null, id: number | null): { fpt?: EntityRef } {
	return type !== null && id !== null ? { fpt: { type, id } } : {};
}

function origin(source: ItemColumns['source'] | undefined): { source?: ItemSource } {
	return source === 'breakdown' ? { source: 'breakdown' } : {};
}

function inPackage(key: string | null | undefined): { package?: Id } {
	return key ? { package: key } : {};
}

/** A row's count as stored: on a row in this request only, above 1. A row from before counts reads as 1. */
function counted(row: Pick<ItemColumns, 'unit_count' | 'fpt_id'>): { count?: number } {
	return row.fpt_id === null && row.unit_count !== undefined && isCount(row.unit_count) && row.unit_count > 1 ? { count: row.unit_count } : {};
}

export function itemsToRows(shots: readonly RequestShot[], assets: readonly RequestAsset[]): ItemColumns[] {
	const rows: ItemColumns[] = [];
	const seen = new Set<string>();
	const push = (kind: 'shot' | 'asset', key: string, code: string, fpt: EntityRef | undefined, omitted: boolean, source: ItemSource | undefined, pkg: Id | undefined, count: number | undefined, fields: Json) => {
		const name = `${kind}:${key}`;
		if (!key) throw new Error(`A ${kind} needs an id.`);
		if (seen.has(name)) throw new Error(`Two ${kind}s have the id '${key}'.`);
		seen.add(name);
		rows.push({
			kind,
			key,
			code,
			position: rows.length,
			fpt_type: fpt?.type ?? null,
			fpt_id: fpt?.id ?? null,
			fields: defined(fields),
			omitted,
			source: source === 'breakdown' ? 'breakdown' : 'fpt',
			package_key: pkg ?? null,
			unit_count: countOf({ count, fpt })
		});
	};
	for (const { id, code, fpt, omitted, source, package: pkg, count, ...fields } of shots) push('shot', id, code, fpt, omitted, source, pkg, count, fields);
	for (const { id, name, fpt, source, package: pkg, count, ...fields } of assets) push('asset', id, name, fpt, false, source, pkg, count, fields);
	return rows;
}

/** A request's packages as written, in order. Ids and names are checked: one each. */
export function packagesToRows(packages: readonly RequestPackage[]): PackageColumns[] {
	const ids = new Set<string>();
	const names = new Set<string>();
	return packages.map((p) => {
		const name = p.name.trim();
		if (!p.id || p.id.length > 200) throw new Error('A package needs an id of 200 characters at most.');
		if (!name || name.length > 120) throw new Error('A package needs a name of 120 characters at most.');
		if (ids.has(p.id)) throw new Error(`Two packages have the id '${p.id}'.`);
		if (names.has(name.toLowerCase())) throw new Error(`Two packages are named ${name}.`);
		ids.add(p.id);
		names.add(name.toLowerCase());
		return { key: p.id, name };
	});
}

export function packagesFromRows(rows: readonly (PackageColumns & { position: number; bid_id?: string | null })[]): RequestPackage[] {
	return [...rows].sort((a, b) => a.position - b.position).map((row) => ({ id: row.key, name: row.name, ...(row.bid_id ? { bid: row.bid_id } : {}) }));
}

/** A production bid's rows as written, in order. Same checks as a request's: one id per kind. */
export function bidItemsToRows(shots: readonly RequestShot[], assets: readonly RequestAsset[]): BidItemColumns[] {
	const strip = <T extends { package?: Id }>({ package: _, ...rest }: T) => rest;
	return itemsToRows(shots.map(strip) as RequestShot[], assets.map(strip) as RequestAsset[]).map(({ package_key: _, ...row }) => row);
}

export function productionBidFromRows(row: Pick<ProductionBidRow, 'id' | 'name'>, items: readonly BidItemColumns[]): ProductionBid {
	return { id: row.id, name: row.name, ...itemsFromRows(items) };
}

export function itemsFromRows(rows: readonly ItemColumns[]): { shots: RequestShot[]; assets: RequestAsset[] } {
	const sorted = [...rows].sort((a, b) => a.position - b.position);
	const shots = sorted
		.filter((row) => row.kind === 'shot')
		.map((row): RequestShot => ({ id: row.key, code: row.code, omitted: row.omitted, assetIds: [], ...row.fields, ...entity(row.fpt_type, row.fpt_id), ...origin(row.source), ...inPackage(row.package_key), ...counted(row) }));
	const assets = sorted
		.filter((row) => row.kind === 'asset')
		.map((row): RequestAsset => ({ id: row.key, name: row.code, ...row.fields, ...entity(row.fpt_type, row.fpt_id), ...origin(row.source), ...inPackage(row.package_key), ...counted(row) }));
	return { shots, assets };
}

export function requestFromRows(
	row: RequestRow,
	items: readonly ItemColumns[],
	vendors: readonly InvitedVendor[],
	packages: readonly (PackageColumns & { position: number; bid_id?: string | null })[] = []
): BidRequest {
	const stored = row.header as Partial<RequestHeader>;
	const header: RequestHeader = {
		...stored,
		project: stored.project ?? '',
		assumptions: stored.assumptions ?? [],
		projectRef: { type: 'Project', id: row.project_id },
		round: row.round,
		baseCurrency: row.base_currency,
		...(row.due_on ? { dueDate: row.due_on } : {})
	};
	return { id: row.id, header, ...itemsFromRows(items), vendors: [...vendors], ...(packages.length > 0 ? { packages: packagesFromRows(packages) } : {}) };
}

// The vendor, through its invitation.

export function vendorToColumns(vendor: Omit<InvitedVendor, 'id'>): VendorColumns {
	if (vendor.fpt && vendor.fpt.type !== 'Group') throw new Error(`A vendor's Flow PT entity is a Group, not a ${vendor.fpt.type}.`);
	const { name, fpt, groupName, email, ndaExecuted, ndaFile, tpn, capacity, packages } = vendor;
	return {
		vendor_name: name,
		vendor_group_id: fpt?.id ?? null,
		contact_email: email,
		details: defined({ ndaExecuted, ndaFile, tpn, capacity, groupName: fpt ? groupName : undefined }),
		package_keys: packages ? [...packages] : null
	};
}

export function vendorFromRow(row: Pick<InvitationRow, 'id' | Exclude<keyof VendorColumns, 'package_keys'>> & { package_keys?: string[] | null }): InvitedVendor {
	const details = row.details as Partial<InvitedVendor>;
	return {
		id: row.id,
		name: row.vendor_name,
		email: row.contact_email,
		...(row.vendor_group_id !== null ? { fpt: { type: 'Group', id: row.vendor_group_id } } : {}),
		...defined({ groupName: row.vendor_group_id !== null ? details.groupName : undefined, ndaFile: details.ndaFile, tpn: details.tpn, capacity: details.capacity }),
		ndaExecuted: details.ndaExecuted === true,
		...(row.package_keys ? { packages: [...row.package_keys] } : {})
	};
}

// The bid.

/** What a vendor sends: a bid without the ids, round and status the server owns. */
export type BidDraft = Omit<VendorBid, 'id' | 'requestId' | 'vendorId' | 'round' | 'status' | 'lines'> & {
	readonly lines: readonly (Omit<BidLine, 'id'> & { readonly id?: string })[];
};

interface StoredBidHeader {
	number?: string;
	date?: string;
	validUntil?: string;
	assumptions?: string[];
	exclusions?: string[];
	milestones?: VendorBid['milestones'];
	discount?: VendorBid['discount'];
	tax?: VendorBid['tax'];
	/** Packages the vendor is not bidding on. */
	declined?: string[];
	/** The vendor's rates. */
	rateCard?: VendorBid['rateCard'];
}

export function bidToRows(bid: BidDraft, baseCurrency: string): { bid: BidColumns; lines: LineColumns[] } {
	const lines = bid.lines.map((line, index) => ({ ...line, id: line.id ?? `line ${index + 1}` }));
	checkBid({ ...bid, id: 'draft', requestId: '', vendorId: '', round: 1, status: 'draft', lines }, baseCurrency);
	const seen = new Set<string>();
	for (const line of lines) {
		const key = targetKey(line.target);
		if (seen.has(key)) throw new Error(`Two lines are for ${line.target.kind} ${line.target.id}.`);
		seen.add(key);
	}
	const header: StoredBidHeader = {
		number: bid.number,
		date: bid.date,
		validUntil: bid.validUntil,
		assumptions: [...bid.assumptions],
		exclusions: [...bid.exclusions],
		milestones: bid.milestones,
		discount: bid.discount,
		tax: bid.tax,
		...(bid.declined?.length ? { declined: [...bid.declined] } : {}),
		...(bid.rateCard ? { rateCard: bid.rateCard } : {})
	};
	return {
		bid: {
			currency: bid.currency,
			exchange_rate: bid.rate?.rate ?? null,
			exchange_rate_date: bid.rate?.date ?? null,
			header: defined({ ...header }),
			non_shot_costs: [...bid.costs],
			rebate_splits: [...bid.rebate],
			packages: (bid.packages ?? []).map((p) => defined({ package: p.package, total: p.total, notes: p.notes }))
		},
		lines: lines.map(({ target, total, excluded, departments, compute, markup, notes, methodology, assumptions, elementsNeeded, startWeek, inPackage, fromRate, unit }) => ({
			item_kind: target.kind,
			item_key: target.id,
			total_minor: total.minor,
			excluded,
			detail: defined({ departments, compute, markup, notes, methodology, assumptions, elementsNeeded, startWeek, fromRate: fromRate === true ? true : undefined, unit }),
			in_package: inPackage === true
		}))
	};
}

export function bidFromRows(row: BidRow, lines: readonly BidLineRow[], request: { round: number; baseCurrency: string }): VendorBid {
	const header = row.header as StoredBidHeader;
	return {
		id: row.id,
		requestId: row.request_id,
		vendorId: row.invitation_id,
		number: header.number ?? '',
		round: request.round,
		date: header.date ?? '',
		status: row.status,
		currency: row.currency,
		rate:
			row.exchange_rate !== null && row.exchange_rate_date !== null
				? { from: row.currency, to: request.baseCurrency, rate: row.exchange_rate, date: row.exchange_rate_date }
				: null,
		...(header.validUntil !== undefined ? { validUntil: header.validUntil } : {}),
		assumptions: header.assumptions ?? [],
		exclusions: header.exclusions ?? [],
		milestones: header.milestones ?? [],
		lines: lines.map(
			(line): BidLine => ({
				id: line.id,
				target: { kind: line.item_kind, id: line.item_key } as Target,
				total: money(line.total_minor, row.currency),
				excluded: line.excluded,
				...(line.detail as Partial<BidLine>),
				...(line.in_package ? { inPackage: true } : {})
			})
		),
		costs: row.non_shot_costs as VendorBid['costs'],
		discount: header.discount ?? null,
		tax: header.tax ?? null,
		rebate: row.rebate_splits as VendorBid['rebate'],
		...(Array.isArray(row.packages) && row.packages.length > 0 ? { packages: row.packages as VendorBid['packages'] } : {}),
		...(Array.isArray(header.declined) && header.declined.length > 0 ? { declined: [...header.declined] } : {}),
		...(header.rateCard ? { rateCard: header.rateCard } : {})
	};
}

// The award scenario.

export function scenarioToRows(picks: readonly ScenarioPick[]): ScenarioItemColumns[] {
	const rows: ScenarioItemColumns[] = [];
	for (const pick of picks) {
		for (const share of pick.shares) {
			if (!isPercent(share.percent)) throw new Error(`'${share.percent}' is not a percent.`);
			rows.push({ item_kind: pick.target.kind, item_key: pick.target.id, bid_id: share.bidId, share_percent: share.percent, position: rows.length });
		}
	}
	return rows;
}

export function scenarioFromRows(row: ScenarioRow, items: readonly ScenarioItemColumns[]): AwardScenario {
	const picks = new Map<string, { target: Target; shares: { bidId: string; percent: string }[] }>();
	for (const item of [...items].sort((a, b) => a.position - b.position)) {
		const target = { kind: item.item_kind, id: item.item_key } as Target;
		const key = targetKey(target);
		if (!picks.has(key)) picks.set(key, { target, shares: [] });
		picks.get(key)!.shares.push({ bidId: item.bid_id, percent: item.share_percent });
	}
	return { id: row.id, requestId: row.request_id, name: row.name, picks: [...picks.values()] };
}
