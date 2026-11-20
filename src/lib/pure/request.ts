/**
 * The draft request: the builder's state, the `BidRequest` it makes, the edits production makes to
 * the frozen items, and what the vendor will see. Pure, no I/O.
 */

import type { FieldSchema } from 'sg-widgets-core';
import { DIFFICULTY_TIERS } from './field-map';
import { headerForm, toHeader, type HeaderForm, type ProjectPick } from './header';
import type { BidRequest, Id, RequestAsset, RequestHeader, RequestShot } from './model';

export interface BuilderState {
	readonly id: Id;
	readonly project: ProjectPick | null;
	readonly form: HeaderForm;
	readonly shots: readonly RequestShot[];
	readonly assets: readonly RequestAsset[];
}

/** The tiers offered when the mapped difficulty field brings no list of its own. */
export const DEFAULT_TIERS: readonly string[] = DIFFICULTY_TIERS;

/** The difficulty tiers: the mapped list field's values, else the defaults. */
export function tiersFor(field: FieldSchema | undefined): readonly string[] {
	return field?.dataType === 'list' && field.validValues && field.validValues.length > 0 ? field.validValues : DEFAULT_TIERS;
}

/** The request the builder holds now. A shot links only assets in the request; an asset counts the shots in it that use it. */
export function buildRequest(state: BuilderState): BidRequest {
	const header: RequestHeader = state.project ? toHeader(state.form, state.project) : { ...toHeader(state.form, { id: 0, name: '' }), projectRef: undefined };
	const assetIds = new Set(state.assets.map((a) => a.id));
	const shots = state.shots.map((s) => ({ ...s, assetIds: s.assetIds.filter((id) => assetIds.has(id)) }));
	const uses = new Map<Id, number>();
	for (const s of shots) if (!s.omitted) for (const id of s.assetIds) uses.set(id, (uses.get(id) ?? 0) + 1);
	return {
		id: state.id,
		header: JSON.parse(JSON.stringify(header)) as RequestHeader,
		shots,
		assets: state.assets.map((a) => ({ ...a, timesUsed: uses.get(a.id) ?? 0 })),
		vendors: []
	};
}

/** The builder's state from a stored request. */
export function restoreState(request: BidRequest): BuilderState {
	const ref = request.header.projectRef;
	return {
		id: request.id,
		project: ref ? { id: ref.id, name: request.header.project } : null,
		form: headerForm(request.header),
		shots: request.shots,
		assets: request.assets
	};
}

type Editable = { description?: string; difficulty?: string; notes?: string; omitted?: boolean };

/** One item changed. A text set to blank is cleared. */
export function editItem<T extends { id: Id } & Editable>(items: readonly T[], id: Id, patch: Editable): T[] {
	return items.map((item) => {
		if (item.id !== id) return item;
		const next: Record<string, unknown> = { ...item };
		for (const [key, value] of Object.entries(patch)) {
			if (typeof value === 'string' && value.trim() === '') delete next[key];
			else next[key] = typeof value === 'string' ? value.trim() : value;
		}
		return next as T;
	});
}

/** Several items changed the same way: a difficulty set for every row shown. */
export function editItems<T extends { id: Id } & Editable>(items: readonly T[], ids: readonly Id[], patch: Editable): T[] {
	const wanted = new Set(ids);
	return items.map((item) => (wanted.has(item.id) ? editItem([item], item.id, patch)[0] : item));
}

/** The items named taken out of the request. */
export function removeItems<T extends { id: Id }>(items: readonly T[], ids: readonly Id[]): T[] {
	const gone = new Set(ids);
	return items.filter((item) => !gone.has(item.id));
}

export interface VendorView {
	readonly header: RequestHeader;
	readonly shots: readonly RequestShot[];
	readonly assets: readonly RequestAsset[];
}

/** The request as a vendor gets it: omitted items left out. */
export function vendorView(request: BidRequest): VendorView {
	return { header: request.header, shots: request.shots.filter((s) => !s.omitted), assets: request.assets.filter((a) => !a.omitted) };
}

export interface Summary {
	readonly shots: number;
	readonly shotsOmitted: number;
	readonly assets: number;
	readonly assetsOmitted: number;
	/** Frames of the shots in, those with a count. */
	readonly frames: number;
	readonly shotsWithoutFrames: number;
	readonly sequences: number;
}

export function summarize(request: BidRequest): Summary {
	const shots = request.shots.filter((s) => !s.omitted);
	return {
		shots: shots.length,
		shotsOmitted: request.shots.length - shots.length,
		assets: request.assets.filter((a) => !a.omitted).length,
		assetsOmitted: request.assets.filter((a) => a.omitted).length,
		frames: shots.reduce((total, s) => total + (s.frames ?? 0), 0),
		shotsWithoutFrames: shots.filter((s) => s.frames === undefined).length,
		sequences: new Set(shots.map((s) => s.sequence).filter(Boolean)).size
	};
}
