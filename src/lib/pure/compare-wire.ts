/**
 * What the comparison endpoints accept from the browser, checked before the data layer sees it.
 * Pure, no I/O. Like `wire.ts`, only named fields pass, and the tenant never comes from the body.
 */

import { isDay } from './header';
import type { ScenarioPick } from './model';
import { isPercent } from './percent';
import { parseId, type Parsed } from './wire';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const RATE = /^\d+(\.\d+)?$/;

/** Most rows one scenario may pick. Far above a real request. */
export const MAX_PICKS = 20_000;

function ids(value: unknown): string[] | null {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > 1000) return null;
	const out = value.map(parseId);
	return out.includes(null) ? null : (out as string[]);
}

export function parseCompareRead(body: Json): Parsed<{ requestId: string; bids: string[] }> {
	const requestId = parseId(body.id);
	if (!requestId) return { ok: false, message: 'That is not a request id.' };
	const bids = ids(body.bids);
	if (!bids) return { ok: false, message: 'That is not a list of bids.' };
	return { ok: true, value: { requestId, bids } };
}

export function parseRate(body: Json): Parsed<{ requestId: string; bidId: string; rate: { rate: string; date: string } | null }> {
	const requestId = parseId(body.requestId);
	const bidId = parseId(body.bidId);
	if (!requestId || !bidId) return { ok: false, message: 'Name the request and the bid.' };
	if (body.rate === null) return { ok: true, value: { requestId, bidId, rate: null } };
	const value = isObject(body.rate) ? body.rate : null;
	const rate = typeof value?.rate === 'string' ? value.rate.trim() : '';
	const date = typeof value?.date === 'string' ? value.date : '';
	if (!RATE.test(rate) || /^0+(\.0+)?$/.test(rate) || rate.length > 30) return { ok: false, message: 'The rate is a positive number, like 1.2712.' };
	if (!isDay(date)) return { ok: false, message: 'Give the day of the rate.' };
	return { ok: true, value: { requestId, bidId, rate: { rate, date } } };
}

function parseName(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const name = value.trim();
	return name.length >= 1 && name.length <= 200 ? name : null;
}

function parsePick(value: unknown): ScenarioPick | null {
	if (!isObject(value) || !isObject(value.target) || !Array.isArray(value.shares)) return null;
	const { kind, id } = value.target;
	if ((kind !== 'shot' && kind !== 'asset') || typeof id !== 'string' || id === '' || id.length > 200) return null;
	if (value.shares.length === 0 || value.shares.length > 50) return null;
	const shares = value.shares.map((share) => {
		if (!isObject(share)) return null;
		const bidId = parseId(share.bidId);
		const percent = typeof share.percent === 'string' && share.percent.length <= 20 && isPercent(share.percent) ? share.percent : null;
		return bidId && percent ? { bidId, percent } : null;
	});
	if (shares.includes(null)) return null;
	return { target: { kind, id }, shares: shares as { bidId: string; percent: string }[] };
}

export interface ScenarioBody {
	readonly requestId: string;
	readonly id?: string;
	readonly name: string;
	readonly picks: ScenarioPick[];
	readonly costsLeftOut: string[];
}

export function parseScenario(body: Json): Parsed<ScenarioBody> {
	const requestId = parseId(body.requestId);
	if (!requestId) return { ok: false, message: 'That is not a request id.' };
	const id = body.id === undefined || body.id === null ? undefined : parseId(body.id);
	if (id === null) return { ok: false, message: 'That is not a scenario id.' };
	const name = parseName(body.name);
	if (!name) return { ok: false, message: 'Name the scenario, up to 200 characters.' };
	if (!Array.isArray(body.picks) || body.picks.length > MAX_PICKS) return { ok: false, message: 'The picks do not fit a scenario.' };
	const picks = body.picks.map(parsePick);
	if (picks.includes(null)) return { ok: false, message: 'A pick does not fit a scenario.' };
	const costsLeftOut = ids(body.costsLeftOut);
	if (!costsLeftOut) return { ok: false, message: 'That is not a list of bids.' };
	return { ok: true, value: { requestId, ...(id ? { id } : {}), name, picks: picks as ScenarioPick[], costsLeftOut } };
}

export function parseScenarioRef(body: Json, options: { name?: boolean; nullable?: boolean } = {}): Parsed<{ requestId: string; scenarioId: string | null; name: string }> {
	const requestId = parseId(body.requestId);
	if (!requestId) return { ok: false, message: 'That is not a request id.' };
	const scenarioId = options.nullable && body.scenarioId === null ? null : parseId(body.scenarioId);
	if (scenarioId === null && !(options.nullable && body.scenarioId === null)) return { ok: false, message: 'That is not a scenario id.' };
	let name = '';
	if (options.name) {
		const parsed = parseName(body.name);
		if (!parsed) return { ok: false, message: 'Name the scenario, up to 200 characters.' };
		name = parsed;
	}
	return { ok: true, value: { requestId, scenarioId, name } };
}
