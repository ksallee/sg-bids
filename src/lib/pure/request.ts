/**
 * A request's rows: the difficulty tiers, taking rows out, and what the vendor will see. Pure, no
 * I/O.
 */

import type { FieldSchema } from 'sg-widgets-core';
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
