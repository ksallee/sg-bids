/**
 * A request's rows: the difficulty tiers, taking rows out, and what the vendor will see. Pure, no
 * I/O.
 */

import type { FieldSchema } from 'sg-widgets-core';
import { countOf, framesOf } from './count';
import { DIFFICULTY_TIERS } from './field-map';
import type { BidRequest, Id, RequestAsset, RequestHeader, RequestShot } from './model';

/** The tiers offered when the mapped difficulty field brings no list of its own. */
export const DEFAULT_TIERS: readonly string[] = DIFFICULTY_TIERS;

/** The difficulty tiers: the mapped list field's values, else the defaults. */
export function tiersFor(field: FieldSchema | undefined): readonly string[] {
	return field?.dataType === 'list' && field.validValues && field.validValues.length > 0 ? field.validValues : DEFAULT_TIERS;
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

/** A shot row typed by hand: in this request only, no code yet, in the bid named. */
export function handShot(id: Id, bid: Id): RequestShot {
	return { id, code: '', source: 'breakdown', omitted: false, assetIds: [], package: bid };
}

/** An asset row typed by hand: in this request only, no name yet, in the bid named. */
export function handAsset(id: Id, bid: Id): RequestAsset {
	return { id, name: '', source: 'breakdown', package: bid };
}

/** The request as a vendor gets it: omitted items left out. */
export function vendorView(request: BidRequest): VendorView {
	return { header: request.header, shots: request.shots.filter((s) => !s.omitted), assets: request.assets.filter((a) => !a.omitted) };
}

export interface Summary {
	/** Shots in: a counted row counts as many as it stands for (`count.ts`). */
	readonly shots: number;
	/** Rows of shots in. */
	readonly shotRows: number;
	readonly shotsOmitted: number;
	/** Assets in, counted rows as many as they stand for. */
	readonly assets: number;
	/** Rows of assets in. */
	readonly assetRows: number;
	readonly assetsOmitted: number;
	/** Frames of the shots in, those with frames: per unit, times the count. */
	readonly frames: number;
	readonly shotsWithoutFrames: number;
	readonly sequences: number;
}

export function summarize(request: BidRequest): Summary {
	const shots = request.shots.filter((s) => !s.omitted);
	const assets = request.assets.filter((a) => !a.omitted);
	return {
		shots: shots.reduce((total, s) => total + countOf(s), 0),
		shotRows: shots.length,
		shotsOmitted: request.shots.length - shots.length,
		assets: assets.reduce((total, a) => total + countOf(a), 0),
		assetRows: assets.length,
		assetsOmitted: request.assets.filter((a) => a.omitted).length,
		frames: shots.reduce((total, s) => total + (framesOf(s) ?? 0), 0),
		shotsWithoutFrames: shots.filter((s) => s.frames === undefined).length,
		sequences: new Set(shots.map((s) => s.sequence).filter(Boolean)).size
	};
}
