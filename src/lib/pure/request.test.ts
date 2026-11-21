import { describe, expect, it } from 'vitest';
import { normalizeFields } from 'sg-widgets-core';
import { asset, shot } from './fixtures';
import { SHOT_FIELDS_A, SHOT_FIELDS_B } from './fixtures/schema';
import { request as requestOf } from './fixtures';
import { DEFAULT_TIERS, handAsset, handShot, removeItems, summarize, tiersFor, vendorView } from './request';

describe('removeItems', () => {
	it('takes the items named out of the request', () => {
		expect(removeItems([shot('a'), shot('b')], ['a']).map((s) => s.id)).toEqual(['b']);
	});
});

describe('a row typed by hand', () => {
	it('is in this request only, with no code yet, in the bid named', () => {
		expect(handShot('shot-bd-1', 'bid:a')).toEqual({ id: 'shot-bd-1', code: '', source: 'breakdown', omitted: false, assetIds: [], package: 'bid:a' });
		expect(handAsset('asset-bd-1', 'bid:a')).toEqual({ id: 'asset-bd-1', name: '', source: 'breakdown', package: 'bid:a' });
	});
});

describe('tiersFor', () => {
	it("takes a list field's values as the tiers", () => {
		expect(tiersFor(normalizeFields(SHOT_FIELDS_B).sg_complexity)).toEqual(['A', 'B', 'C', 'D']);
	});
	it('falls back to the default tiers', () => {
		expect(tiersFor(undefined)).toEqual(DEFAULT_TIERS);
		expect(tiersFor(normalizeFields(SHOT_FIELDS_A).description)).toEqual(DEFAULT_TIERS);
	});
});

describe('vendorView and summarize', () => {
	const request = requestOf({
		shots: [
			shot('shot-1', { frames: 96, sequence: 'sh010' }),
			shot('shot-2', { frames: 40, sequence: 'sh010' }),
			shot('shot-3', { sequence: 'sh020' }),
			shot('shot-4', { frames: 500, omitted: true, sequence: 'sh030' })
		],
		assets: [asset('asset-9'), asset('asset-10', { omitted: true })]
	});

	it('shows the vendor only what is in', () => {
		const view = vendorView(request);
		expect(view.shots.map((s) => s.id)).toEqual(['shot-1', 'shot-2', 'shot-3']);
		expect(view.assets.map((a) => a.id)).toEqual(['asset-9']);
	});

	it('counts what goes out and what is held back', () => {
		expect(summarize(request)).toEqual({ shots: 3, shotRows: 3, shotsOmitted: 1, assets: 1, assetRows: 1, assetsOmitted: 1, frames: 136, shotsWithoutFrames: 1, sequences: 2 });
	});

	it('counts a counted row as many as it stands for, its frames per unit times its count', () => {
		const counted = requestOf({ shots: [shot('simple', { source: 'breakdown', frames: 80, count: 120 }), shot('shot-1', { frames: 96 })], assets: [asset('props', { source: 'breakdown', count: 12 })] });
		expect(summarize(counted)).toMatchObject({ shots: 121, shotRows: 2, assets: 12, assetRows: 1, frames: 9696 });
	});
});
