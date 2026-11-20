/**
 * What the award endpoints accept from the browser, checked before the data layer sees it. Pure, no
 * I/O. Like `wire.ts`, only named fields pass. The award rows and the summary are never taken from
 * the body: the server builds them from the chosen scenario as stored. The body brings only what
 * Flow PT answered (`written`), the site's names, the options, and the choices made on the page.
 */

import type { FptSite, Written } from './fpt-award';
import type { AppStatus, ItemType } from './fpt-setup';
import { parseId, type Parsed } from './wire';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const FIELD = /^[a-z][a-z0-9_]{0,99}$/;
const SLOT = /^CustomEntity\d{2}$/;
const KEY = /^sgbids\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/r\d{1,4}(\/(shot|asset):[^\s]{1,200})?$/;
const STATUS: readonly AppStatus[] = ['draft', 'submitted', 'awarded', 'not_awarded'];

/** Most rows one record may hold. Far above a real request. */
export const MAX_WRITTEN = 50_000;

function text(value: unknown, max: number): string | null {
	return typeof value === 'string' && value.length <= max ? value : null;
}

function rows(value: unknown): { key: string; id: number; created: boolean }[] | null {
	if (!Array.isArray(value) || value.length > MAX_WRITTEN) return null;
	const out = value.map((r) => (isObject(r) && typeof r.key === 'string' && KEY.test(r.key) && isId(r.id) && typeof r.created === 'boolean' ? { key: r.key, id: r.id, created: r.created } : null));
	return out.includes(null) ? null : (out as { key: string; id: number; created: boolean }[]);
}

export function parseWritten(value: unknown): Written | null {
	if (!isObject(value)) return null;
	const bids = rows(value.bids);
	const lines = rows(value.lines);
	if (!bids || !lines || !Array.isArray(value.groups) || !Array.isArray(value.attachments)) return null;
	if (value.groups.length > MAX_WRITTEN || value.attachments.length > MAX_WRITTEN) return null;
	const groups = value.groups.map((g) => {
		if (!isObject(g) || (g.itemType !== 'Shot' && g.itemType !== 'Asset') || !isId(g.id) || typeof g.field !== 'string' || !FIELD.test(g.field)) return null;
		if (!Array.isArray(g.groups) || g.groups.length === 0 || g.groups.length > 100 || !g.groups.every(isId)) return null;
		return { itemType: g.itemType as ItemType, id: g.id, field: g.field, groups: [...(g.groups as number[])] };
	});
	const attachments = value.attachments.map((a) => (isObject(a) && typeof a.key === 'string' && KEY.test(a.key) && isId(a.id) ? { key: a.key, id: a.id } : null));
	if (groups.includes(null) || attachments.includes(null)) return null;
	return { bids, lines, groups: groups as Written['groups'], attachments: attachments as Written['attachments'] };
}

export function parseSite(value: unknown, projectId: number): FptSite | null {
	if (!isObject(value) || value.projectId !== projectId) return null;
	if (typeof value.bidType !== 'string' || !SLOT.test(value.bidType) || typeof value.lineType !== 'string' || !SLOT.test(value.lineType)) return null;
	const vendorField: Partial<Record<ItemType, string>> = {};
	if (!isObject(value.vendorField)) return null;
	for (const [type, field] of Object.entries(value.vendorField)) {
		if ((type !== 'Shot' && type !== 'Asset') || typeof field !== 'string' || !FIELD.test(field)) return null;
		vendorField[type] = field;
	}
	const statuses: Partial<Record<AppStatus, string>> = {};
	if (!isObject(value.statuses)) return null;
	for (const [status, code] of Object.entries(value.statuses)) {
		if (!STATUS.includes(status as AppStatus) || typeof code !== 'string' || code.length === 0 || code.length > 50) return null;
		statuses[status as AppStatus] = code;
	}
	return { projectId, bidType: value.bidType, lineType: value.lineType, vendorField, statuses };
}

export interface AwardOptionsWire {
	readonly allLines: boolean;
	readonly groups: Readonly<Record<string, number | null>>;
}

function parseOptions(value: unknown): AwardOptionsWire | null {
	if (!isObject(value) || typeof value.allLines !== 'boolean' || !isObject(value.groups)) return null;
	const groups: Record<string, number | null> = {};
	const entries = Object.entries(value.groups);
	if (entries.length > 1000) return null;
	for (const [vendorId, group] of entries) {
		if (!parseId(vendorId) || (group !== null && !isId(group))) return null;
		groups[vendorId] = group as number | null;
	}
	return { allLines: value.allLines, groups };
}

export interface ExposureWire {
	readonly state: 'exposed' | 'unknown';
	readonly lines: readonly string[];
}

function parseExposure(value: unknown): ExposureWire | null | undefined {
	if (value === null || value === undefined) return null;
	if (!isObject(value) || (value.state !== 'exposed' && value.state !== 'unknown') || !Array.isArray(value.lines) || value.lines.length > 20) return undefined;
	const lines = value.lines.map((l) => text(l, 2000));
	return lines.includes(null) ? undefined : { state: value.state, lines: lines as string[] };
}

function parseStrings(value: unknown, most: number, max: number): string[] | null {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > most) return null;
	const out = value.map((v) => text(v, max));
	return out.includes(null) ? null : (out as string[]);
}

export interface AwardRecordWire {
	readonly requestId: string;
	readonly scenarioId: string;
	readonly state: 'published' | 'partial';
	readonly site: FptSite;
	readonly written: Written;
	readonly options: AwardOptionsWire;
	readonly problems: readonly string[];
	readonly error: string | null;
	/** The page's "publish anyway", with the words it showed. Null when the site was safe. */
	readonly exposure: ExposureWire | null;
	/** The signed-in person's name, for the page. Who published is the verified session's person. */
	readonly byName: string | null;
}

export function parseAwardRecord(body: Json, projectId: number): Parsed<AwardRecordWire> {
	const requestId = parseId(body.requestId);
	const scenarioId = parseId(body.scenarioId);
	if (!requestId || !scenarioId) return { ok: false, message: 'Name the request and the scenario.' };
	if (body.state !== 'published' && body.state !== 'partial') return { ok: false, message: 'A run is published or partial.' };
	const site = parseSite(body.site, projectId);
	if (!site) return { ok: false, message: "That is not the site's Bid and Bid Line." };
	const written = parseWritten(body.written);
	if (!written) return { ok: false, message: 'That is not what was written to Flow PT.' };
	const options = parseOptions(body.options);
	if (!options) return { ok: false, message: 'Those are not the award options.' };
	const problems = parseStrings(body.problems, 1000, 2000);
	if (!problems) return { ok: false, message: 'Those are not the read-back problems.' };
	const error = body.error === null || body.error === undefined ? null : text(body.error, 2000);
	if (error === null && body.error !== null && body.error !== undefined) return { ok: false, message: 'That is not an error line.' };
	const exposure = parseExposure(body.exposure);
	if (exposure === undefined) return { ok: false, message: 'That is not the choice to publish anyway.' };
	const byName = body.byName === null || body.byName === undefined ? null : text(body.byName, 200);
	if (body.state === 'published' && (error !== null || problems.length > 0)) return { ok: false, message: 'A run with an error or a difference is partial.' };
	return { ok: true, value: { requestId, scenarioId, state: body.state, site, written, options, problems, error, exposure, byName } };
}

export interface AwardUndoWire {
	readonly requestId: string;
	/** What is still on the site after the undo. Null when nothing is. */
	readonly remaining: Written | null;
	readonly error: string | null;
}

export function parseAwardUndo(body: Json): Parsed<AwardUndoWire> {
	const requestId = parseId(body.requestId);
	if (!requestId) return { ok: false, message: 'That is not a request id.' };
	const remaining = body.remaining === null ? null : parseWritten(body.remaining);
	if (remaining === null && body.remaining !== null) return { ok: false, message: 'That is not what is left in Flow PT.' };
	const error = body.error === null || body.error === undefined ? null : text(body.error, 2000);
	if (remaining !== null && error === null && body.error !== null && body.error !== undefined) return { ok: false, message: 'That is not an error line.' };
	return { ok: true, value: { requestId, remaining, error } };
}
