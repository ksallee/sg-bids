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
import type { EntityRef, InvitedVendor, RequestAsset, RequestHeader, RequestShot } from './model';
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

function parseShot(value: unknown): RequestShot | null {
	if (!isObject(value) || !isText(value.id) || value.id === '' || !isText(value.code)) return null;
	const text = texts(value, SHOT_TEXT);
	const fpt = ref(value.fpt, 'Shot');
	if (!text || fpt === null || typeof value.omitted !== 'boolean') return null;
	if (!Array.isArray(value.assetIds) || !value.assetIds.every(isText)) return null;
	const out: Json = { id: value.id, code: value.code, ...text, omitted: value.omitted, assetIds: [...value.assetIds] };
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
	if (!text || fpt === null) return null;
	if (value.omitted !== undefined && typeof value.omitted !== 'boolean') return null;
	const out: Json = { id: value.id, name: value.name, ...text };
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
	return { ok: true, value: { id, code: body.code.trim(), header, items: { shots: shots as RequestShot[], assets: assets as RequestAsset[] } } };
}

export function parseVendor(body: unknown): Parsed<Omit<InvitedVendor, 'id'>> {
	if (!isObject(body) || !isText(body.name) || !isText(body.email)) return { ok: false, message: 'Name the vendor and its email.' };
	const errors = validateVendor({ name: body.name, email: body.email });
	if (errors.name || errors.email) return { ok: false, message: errors.name ?? errors.email ?? '' };
	const group = body.groupId === undefined || body.groupId === null ? undefined : body.groupId;
	if (group !== undefined && !(typeof group === 'number' && Number.isSafeInteger(group) && group > 0)) return { ok: false, message: 'That is not a Group id.' };
	return {
		ok: true,
		value: { name: body.name.trim(), email: body.email.trim(), ...(group !== undefined ? { fpt: { type: 'Group', id: group } } : {}), ndaExecuted: false }
	};
}
