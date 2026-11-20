/**
 * What the builder hands to storage, and what a new round starts from. Pure, no I/O.
 *
 * A draft saves as soon as it has a project and a code (the database's key is code and round per
 * project). A field that does not pass its check yet is left out of the save rather than stopping
 * it, so a half typed date never loses the rest. No thumbnail is stored: Flow PT's image URLs are
 * presigned and expire (081).
 */

import { isCurrency } from './currencies';
import { isDay, toHeader } from './header';
import type { BidRequest, RequestAsset, RequestHeader, RequestShot } from './model';
import { buildRequest, type BuilderState } from './request';

const LOCAL = 'local-';

/** An id for a draft the server has not stored yet. */
export function localId(seed: string): string {
	return `${LOCAL}${seed}`;
}

export function isLocalId(id: string): boolean {
	return id.startsWith(LOCAL);
}

export interface Items {
	readonly shots: readonly RequestShot[];
	readonly assets: readonly RequestAsset[];
}

export type Savable = { readonly ok: true; readonly code: string; readonly header: RequestHeader; readonly items: Items } | { readonly ok: false; readonly reason: string };

function withoutThumbnail({ thumbnail, ...rest }: RequestShot): RequestShot {
	void thumbnail;
	return rest;
}

export function savable(state: BuilderState): Savable {
	if (!state.project) return { ok: false, reason: 'Pick a project to save the draft.' };
	const code = state.form.code.trim();
	if (code === '') return { ok: false, reason: 'Give the request a code to save it.' };
	const form = {
		...state.form,
		baseCurrency: isCurrency(state.form.baseCurrency.trim()) ? state.form.baseCurrency.trim() : 'USD',
		dueDate: isDay(state.form.dueDate.trim()) ? state.form.dueDate : '',
		turnoverDate: isDay(state.form.turnoverDate.trim()) ? state.form.turnoverDate : '',
		deliveryDate: isDay(state.form.deliveryDate.trim()) ? state.form.deliveryDate : ''
	};
	const request = buildRequest({ ...state, form });
	return {
		ok: true,
		code,
		header: toHeader(form, state.project),
		items: { shots: request.shots.map(withoutThumbnail), assets: request.assets.map(({ timesUsed, ...rest }) => (void timesUsed, rest)) }
	};
}

/** The next round of an issued request: same code, the round after, the items as they were. */
export function nextRound(request: BidRequest): { code: string; header: RequestHeader; items: Items } {
	return {
		code: request.header.code ?? '',
		header: { ...request.header, round: request.header.round + 1 },
		items: { shots: request.shots.map(withoutThumbnail), assets: request.assets.map(({ timesUsed, ...rest }) => (void timesUsed, rest)) }
	};
}
