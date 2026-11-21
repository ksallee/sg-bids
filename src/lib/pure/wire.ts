/**
 * What production's endpoints accept from the browser, checked before the data layer sees it.
 * Pure, no I/O.
 *
 * Only the fields the model has pass, by name: a header or an item cannot carry anything else to a
 * vendor (no vendor name, no Group id, no thumbnail). The project is never taken from the body: the
 * tenant comes from the verified session (`src/lib/server/production.ts`).
 */

import { isCurrency } from './currencies';
import { isDay } from './header';
import type { EntityRef, Id, InvitedVendor, RequestAsset, RequestHeader, RequestShot } from './model';
import { MAX_PACKAGE_NAME } from './packages';
import { validateVendor } from './invitations';
import { isWebLink } from './safe-href';

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseId(value: unknown): string | null {
	return typeof value === 'string' && UUID.test(value) ? value : null;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function ref(value: unknown, type: string): EntityRef | undefined | null {
	if (value === undefined) return undefined;
	if (isObject(value) && value.type === type && typeof value.id === 'number' && Number.isSafeInteger(value.id) && value.id > 0) return { type, id: value.id };
	return null;
}

/** Copies the named text fields that are strings; null when one is set and is not. */
function texts(source: Json, names: readonly string[]): Json | null {
	const out: Json = {};
	for (const name of names) {
		const value = source[name];
		if (value === undefined) continue;
		if (!isText(value)) return null;
		out[name] = value;
	}
	return out;
}

const HEADER_TEXT = ['code', 'title', 'project', 'studio', 'director', 'clientSupervisor', 'clientProducer', 'cutVersion', 'turnoverWeek', 'deliveryFormat', 'materialLink'] as const;
const HEADER_DAYS = ['dueDate', 'turnoverDate', 'deliveryDate'] as const;

function parseHeader(value: unknown): RequestHeader | null {
	if (!isObject(value)) return null;
	const text = texts(value, HEADER_TEXT);
	if (!text || !isText(value.project)) return null;
	// The link reaches a vendor as an href: http or https only (`safe-href.ts`). Blank is no link.
	if (text.materialLink === '') delete text.materialLink;
	else if (text.materialLink !== undefined && !isWebLink(text.materialLink as string)) return null;
	if (!Number.isSafeInteger(value.round) || (value.round as number) < 1) return null;
	if (!isText(value.baseCurrency) || !isCurrency(value.baseCurrency)) return null;
	if (!Array.isArray(value.assumptions) || !value.assumptions.every(isText)) return null;
	const days: Json = {};
	for (const name of HEADER_DAYS) {
		const day = value[name];
		if (day === undefined) continue;
		if (!isText(day) || !isDay(day)) return null;
		days[name] = day;
	}
	return { ...text, ...days, round: value.round, baseCurrency: value.baseCurrency, assumptions: [...value.assumptions] } as unknown as RequestHeader;
}

const SHOT_TEXT = ['description', 'episode', 'sequence', 'scene', 'page', 'type', 'difficulty', 'directorNotes', 'notes'] as const;
const ASSET_TEXT = ['description', 'type', 'difficulty', 'notes'] as const;

/** Absent, or `breakdown`: a row with no Flow PT row until it is matched. Null for anything else. */
function source(value: unknown): { source?: 'breakdown' } | null {
	if (value === undefined) return {};
	return value === 'breakdown' ? { source: 'breakdown' } : null;
}

const isKey = (value: unknown): value is string => isText(value) && value.length > 0 && value.length <= 200;

/** Absent, or the id of the row's package. Null for anything else. */
function inPackage(value: unknown): { package?: Id } | null {
	if (value === undefined) return {};
	return isKey(value) ? { package: value } : null;
}

function parseShot(value: unknown): RequestShot | null {
	if (!isObject(value) || !isText(value.id) || value.id === '' || !isText(value.code)) return null;
	const text = texts(value, SHOT_TEXT);
	const fpt = ref(value.fpt, 'Shot');
	const from = source(value.source);
	const pkg = inPackage(value.package);
	if (!text || fpt === null || from === null || pkg === null || typeof value.omitted !== 'boolean') return null;
	if (!Array.isArray(value.assetIds) || !value.assetIds.every(isText)) return null;
	const out: Json = { id: value.id, code: value.code, ...from, ...text, omitted: value.omitted, assetIds: [...value.assetIds], ...pkg };
	if (fpt) out.fpt = fpt;
	for (const name of ['frames', 'cutCount'] as const) {
		if (value[name] === undefined) continue;
		if (!isCount(value[name])) return null;
		out[name] = value[name];
	}
	return out as unknown as RequestShot;
}

function parseAsset(value: unknown): RequestAsset | null {
	if (!isObject(value) || !isText(value.id) || value.id === '' || !isText(value.name)) return null;
	const text = texts(value, ASSET_TEXT);
	const fpt = ref(value.fpt, 'Asset');
	const from = source(value.source);
	const pkg = inPackage(value.package);
	if (!text || fpt === null || from === null || pkg === null) return null;
	if (value.omitted !== undefined && typeof value.omitted !== 'boolean') return null;
	const out: Json = { id: value.id, name: value.name, ...from, ...text, ...pkg };
	if (fpt) out.fpt = fpt;
	if (value.omitted !== undefined) out.omitted = value.omitted;
	return out as unknown as RequestAsset;
}

/** Most bids one request holds. Far above a real one. */
export const MAX_PACKAGES = 500;

/** Most rows one request holds. Far above a real one. */
export const MAX_REQUEST_ROWS = 20_000;

/** Most vendors one request goes to. Far above a real one. */
export const MAX_VENDORS = 200;

/** The longest request name. */
export const MAX_REQUEST_NAME = 200;

/** A bid of the request as its page saves it: its key, its name, its rows. */
export interface SavedBidInput {
	readonly key: Id;
	readonly name: string;
	readonly shots: RequestShot[];
	readonly assets: RequestAsset[];
}

/** A vendor of the draft as its page saves it: kept as typed, its link made at the issue. */
export interface DraftVendorInput {
	readonly id: Id;
	readonly name: string;
	readonly email: string;
	readonly group: { readonly id: number; readonly name: string } | null;
	/** The bids it answers, by key. Null: every bid. */
	readonly bids: Id[] | null;
}

export interface DraftSaveInput {
	readonly id: Id;
	/** Absent: as it is. */
	readonly header?: RequestHeader;
	/** Absent: as they are. */
	readonly bids?: SavedBidInput[];
	/** Absent: as they are. */
	readonly vendors?: DraftVendorInput[];
}

const strip = <T extends { package?: Id }>({ package: _, ...rest }: T) => rest;

/** A request's bids: one at least, a key and a name each, one of each, every row in one bid. */
function parseBids(value: unknown): Parsed<SavedBidInput[]> {
	if (!Array.isArray(value) || value.length === 0) return { ok: false, message: 'A request holds one bid at least.' };
	if (value.length > MAX_PACKAGES) return { ok: false, message: `A request holds ${MAX_PACKAGES} bids at most.` };
	const keys = new Set<string>();
	const names = new Map<string, string>();
	const rows = new Map<string, string>();
	const out: SavedBidInput[] = [];
	let count = 0;
	for (const b of value) {
		if (!isObject(b) || !isKey(b.key) || !isText(b.name)) return { ok: false, message: 'A bid needs a key and a name.' };
		const name = b.name.trim();
		if (name === '') return { ok: false, message: 'A bid has no name. Give it one.' };
		if (name.length > MAX_PACKAGE_NAME) return { ok: false, message: `A bid name is ${MAX_PACKAGE_NAME} characters at most.` };
		if (keys.has(b.key)) return { ok: false, message: 'Two bids have one key.' };
		const first = names.get(name.toLowerCase());
		if (first !== undefined) return { ok: false, message: `Two bids are named ${name}. Give each its own name.` };
		keys.add(b.key);
		names.set(name.toLowerCase(), name);
		const items = parseRows(b.items);
		if (!items.ok) return { ok: false, message: 'A row does not fit a request.' };
		count += items.value.shots.length + items.value.assets.length;
		if (count > MAX_REQUEST_ROWS) return { ok: false, message: `A request holds ${MAX_REQUEST_ROWS} rows at most.` };
		for (const [kind, id, code] of [...items.value.shots.map((s) => ['shot', s.id, s.code]), ...items.value.assets.map((a) => ['asset', a.id, a.name])]) {
			const before = rows.get(`${kind}:${id}`);
			if (before !== undefined) return { ok: false, message: `A row sits in one bid. ${code} is in ${before} and in ${name}.` };
			rows.set(`${kind}:${id}`, name);
		}
		out.push({ key: b.key, name, shots: items.value.shots.map(strip) as RequestShot[], assets: items.value.assets.map(strip) as RequestAsset[] });
	}
	return { ok: true, value: out };
}

/** The draft's vendors as typed. `keys`: the bids of the request, when the save carries them. */
function parseDraftVendors(value: unknown, keys: ReadonlySet<string> | null): Parsed<DraftVendorInput[]> {
	if (!Array.isArray(value) || value.length > MAX_VENDORS) return { ok: false, message: `A request goes to ${MAX_VENDORS} vendors at most.` };
	const ids = new Set<string>();
	const out: DraftVendorInput[] = [];
	const bad = { ok: false, message: 'A vendor does not fit the request.' } as const;
	for (const v of value) {
		if (!isObject(v) || !parseId(v.id) || !isText(v.name) || !isText(v.email)) return bad;
		if (v.name.length > 200 || v.email.length > 320) return bad;
		let group: DraftVendorInput['group'] = null;
		if (v.group !== null && v.group !== undefined) {
			const g = v.group;
			if (!isObject(g) || typeof g.id !== 'number' || !Number.isSafeInteger(g.id) || g.id <= 0 || !isText(g.name) || g.name.length > 200) return bad;
			group = { id: g.id, name: g.name.trim() };
		}
		let bids: Id[] | null = null;
		if (v.bids !== null && v.bids !== undefined) {
			if (!Array.isArray(v.bids) || v.bids.length === 0 || v.bids.length > MAX_PACKAGES || !v.bids.every(isKey) || new Set(v.bids).size !== v.bids.length) return bad;
			if (keys && v.bids.some((k) => !keys.has(k as string))) return { ok: false, message: 'A vendor is invited to a bid the request does not have.' };
			bids = [...(v.bids as string[])];
		}
		if (ids.has(v.id as string)) return { ok: false, message: 'A vendor is named twice.' };
		ids.add(v.id as string);
		out.push({ id: v.id as string, name: v.name.trim(), email: v.email.trim(), group, bids });
	}
	return { ok: true, value: out };
}

/** A draft page's save: `{id, header?, bids?, vendors?}`. What is absent stays as it is. */
export function parseDraftSave(body: unknown): Parsed<DraftSaveInput> {
	if (!isObject(body)) return { ok: false, message: 'Send a draft.' };
	const id = parseId(body.id);
	if (!id) return { ok: false, message: 'That is not a request id.' };
	const out: { id: Id; header?: RequestHeader; bids?: SavedBidInput[]; vendors?: DraftVendorInput[] } = { id };
	if (body.header !== undefined) {
		const header = parseHeader(body.header);
		if (!header) return { ok: false, message: 'The details do not fit a request.' };
		out.header = header;
	}
	if (body.bids !== undefined) {
		const bids = parseBids(body.bids);
		if (!bids.ok) return bids;
		out.bids = bids.value;
	}
	if (body.vendors !== undefined) {
		const vendors = parseDraftVendors(body.vendors, out.bids ? new Set(out.bids.map((b) => b.key)) : null);
		if (!vendors.ok) return vendors;
		out.vendors = vendors.value;
	}
	return { ok: true, value: out };
}

function requestName(value: unknown): Parsed<string> {
	if (!isText(value) || value.trim() === '') return { ok: false, message: 'Name the request.' };
	if (value.trim().length > MAX_REQUEST_NAME) return { ok: false, message: `A request name is ${MAX_REQUEST_NAME} characters at most.` };
	return { ok: true, value: value.trim() };
}

/** A new request: its name, and the details it starts with. The name is its title. */
export function parseCreate(body: unknown): Parsed<{ name: string; header: RequestHeader }> {
	if (!isObject(body)) return { ok: false, message: 'Name the request.' };
	const name = requestName(body.name);
	if (!name.ok) return name;
	const header = parseHeader(body.header);
	if (!header) return { ok: false, message: 'The details do not fit a request.' };
	return { ok: true, value: { name: name.value, header: { ...header, title: name.value } } };
}

/** A request to copy: `{id, name, rows}`, `rows` whether the rows of its bids go too. */
export function parseDuplicate(body: unknown): Parsed<{ id: Id; name: string; rows: boolean }> {
	if (!isObject(body)) return { ok: false, message: 'Name the request to copy.' };
	const id = parseId(body.id);
	if (!id) return { ok: false, message: 'That is not a request id.' };
	const name = requestName(body.name);
	if (!name.ok) return name;
	if (typeof body.rows !== 'boolean') return { ok: false, message: 'Say whether the rows go too.' };
	return { ok: true, value: { id, name: name.value, rows: body.rows } };
}

function parseRows(value: unknown): Parsed<{ shots: RequestShot[]; assets: RequestAsset[] }> {
	const items = isObject(value) ? value : null;
	if (!items || !Array.isArray(items.shots) || !Array.isArray(items.assets)) return { ok: false, message: 'An item does not fit a request.' };
	const shots = items.shots.map(parseShot);
	const assets = items.assets.map(parseAsset);
	if (shots.includes(null) || assets.includes(null)) return { ok: false, message: 'An item does not fit a request.' };
	return { ok: true, value: { shots: shots as RequestShot[], assets: assets as RequestAsset[] } };
}

/** A breakdown row and the Flow PT row it gets. */
export interface ItemLink {
	readonly kind: 'shot' | 'asset';
	readonly key: string;
	readonly fpt: EntityRef;
}

/** Most rows one link call may carry. Far above a real request. */
export const MAX_LINKS = 5000;

export function parseLinks(body: unknown): Parsed<{ requestId: string; links: ItemLink[] }> {
	if (!isObject(body)) return { ok: false, message: 'Name the request and the rows.' };
	const requestId = parseId(body.requestId);
	if (!requestId) return { ok: false, message: 'That is not a request id.' };
	if (!Array.isArray(body.links) || body.links.length === 0 || body.links.length > MAX_LINKS) return { ok: false, message: 'Name the rows to link.' };
	const seen = new Set<string>();
	const links: ItemLink[] = [];
	for (const value of body.links) {
		if (!isObject(value) || (value.kind !== 'shot' && value.kind !== 'asset') || !isText(value.key) || value.key === '' || value.key.length > 200) {
			return { ok: false, message: 'A row to link is not a shot or an asset of the request.' };
		}
		const fpt = ref(value.fpt, value.kind === 'shot' ? 'Shot' : 'Asset');
		if (!fpt) return { ok: false, message: `${value.key} links only to a Flow PT ${value.kind === 'shot' ? 'Shot' : 'Asset'}.` };
		const name = `${value.kind}:${value.key}`;
		if (seen.has(name)) return { ok: false, message: `${value.key} is named twice.` };
		seen.add(name);
		links.push({ kind: value.kind, key: value.key, fpt });
	}
	return { ok: true, value: { requestId, links } };
}

/** Absent or null: every package. Else one package id each, at least one. */
function packageList(value: unknown): Parsed<Id[] | null> {
	if (value === undefined || value === null) return { ok: true, value: null };
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PACKAGES || !value.every(isKey)) return { ok: false, message: 'Pick at least one bid, or every bid.' };
	if (new Set(value).size !== value.length) return { ok: false, message: 'A bid is named twice.' };
	return { ok: true, value: [...value] };
}

export function parseVendor(body: unknown): Parsed<Omit<InvitedVendor, 'id'>> {
	if (!isObject(body) || !isText(body.name) || !isText(body.email)) return { ok: false, message: 'Name the vendor and its email.' };
	const errors = validateVendor({ name: body.name, email: body.email });
	if (errors.name || errors.email) return { ok: false, message: errors.name ?? errors.email ?? '' };
	const group = body.groupId === undefined || body.groupId === null ? undefined : body.groupId;
	if (group !== undefined && !(typeof group === 'number' && Number.isSafeInteger(group) && group > 0)) return { ok: false, message: 'That is not a Group id.' };
	const packages = packageList(body.packages);
	if (!packages.ok) return packages;
	return {
		ok: true,
		value: {
			name: body.name.trim(),
			email: body.email.trim(),
			...(group !== undefined ? { fpt: { type: 'Group', id: group } } : {}),
			ndaExecuted: false,
			...(packages.value ? { packages: packages.value } : {})
		}
	};
}

/** A vendor's packages changed: the invitation, and the packages, or null for every package. */
export function parseInvitationPackages(body: unknown): Parsed<{ invitationId: string; packages: Id[] | null }> {
	if (!isObject(body)) return { ok: false, message: 'Name the invitation and its bids.' };
	const invitationId = parseId(body.invitationId);
	if (!invitationId) return { ok: false, message: 'That is not an invitation id.' };
	const packages = packageList(body.packages);
	if (!packages.ok) return packages;
	return { ok: true, value: { invitationId, packages: packages.value } };
}
