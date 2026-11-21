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
import type { EntityRef, Id, InvitedVendor, RequestAsset, RequestHeader, RequestPackage, RequestShot } from './model';
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

export interface SaveInput {
	/** The stored draft to update, or null to create one. */
	readonly id: string | null;
	readonly code: string;
	readonly header: RequestHeader;
	readonly items: { readonly shots: RequestShot[]; readonly assets: RequestAsset[] };
	/** The request's packages. Empty: none, every row without one. */
	readonly packages: RequestPackage[];
}

/** Most packages a request holds. Far above a real one. */
export const MAX_PACKAGES = 500;

/** A request's packages: an id and a name each, one of each, every row in one of them. */
function parsePackages(value: unknown, rows: readonly { package?: Id }[]): Parsed<RequestPackage[]> {
	if (value === undefined) {
		return rows.some((r) => r.package !== undefined) ? { ok: false, message: 'A row names a package the request does not have.' } : { ok: true, value: [] };
	}
	if (!Array.isArray(value) || value.length > MAX_PACKAGES) return { ok: false, message: 'The packages do not fit a request.' };
	const ids = new Set<string>();
	const names = new Set<string>();
	const out: RequestPackage[] = [];
	for (const p of value) {
		if (!isObject(p) || !isKey(p.id) || !isText(p.name)) return { ok: false, message: 'A package needs an id and a name.' };
		const name = p.name.trim();
		if (name === '' || name.length > MAX_PACKAGE_NAME) return { ok: false, message: `A package name is 1 to ${MAX_PACKAGE_NAME} characters.` };
		if (ids.has(p.id)) return { ok: false, message: 'Two packages have one id.' };
		if (names.has(name.toLowerCase())) return { ok: false, message: `Two packages are named ${name}.` };
		ids.add(p.id);
		names.add(name.toLowerCase());
		out.push({ id: p.id, name });
	}
	if (out.length > 0 && rows.some((r) => r.package === undefined || !ids.has(r.package))) return { ok: false, message: 'Every row sits in one of the request’s packages.' };
	if (out.length === 0 && rows.some((r) => r.package !== undefined)) return { ok: false, message: 'A row names a package the request does not have.' };
	return { ok: true, value: out };
}

export function parseSave(body: unknown): Parsed<SaveInput> {
	if (!isObject(body)) return { ok: false, message: 'Send a draft.' };
	const id = body.id === undefined || body.id === null ? null : parseId(body.id);
	if (id === null && body.id !== undefined && body.id !== null) return { ok: false, message: 'That is not a request id.' };
	if (!isText(body.code) || body.code.trim() === '' || body.code.length > 200) return { ok: false, message: 'Give the request a code.' };
	const header = parseHeader(body.header);
	if (!header) return { ok: false, message: 'The header does not fit a request.' };
	const items = isObject(body.items) ? body.items : null;
	if (!items || !Array.isArray(items.shots) || !Array.isArray(items.assets)) return { ok: false, message: 'An item does not fit a request.' };
	const shots = items.shots.map(parseShot);
	const assets = items.assets.map(parseAsset);
	if (shots.includes(null) || assets.includes(null)) return { ok: false, message: 'An item does not fit a request.' };
	const packages = parsePackages(body.packages, [...(shots as RequestShot[]), ...(assets as RequestAsset[])]);
	if (!packages.ok) return packages;
	return { ok: true, value: { id, code: body.code.trim(), header, items: { shots: shots as RequestShot[], assets: assets as RequestAsset[] }, packages: packages.value } };
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
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PACKAGES || !value.every(isKey)) return { ok: false, message: 'Pick at least one package, or every package.' };
	if (new Set(value).size !== value.length) return { ok: false, message: 'A package is named twice.' };
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
	if (!isObject(body)) return { ok: false, message: 'Name the invitation and its packages.' };
	const invitationId = parseId(body.invitationId);
	if (!invitationId) return { ok: false, message: 'That is not an invitation id.' };
	const packages = packageList(body.packages);
	if (!packages.ok) return packages;
	return { ok: true, value: { invitationId, packages: packages.value } };
}
