import { describe, expect, it } from 'vitest';
import { normalizeFields } from 'sg-widgets-core';
import { asset, shot } from './fixtures';
import { SHOT_FIELDS_A, SHOT_FIELDS_B } from './fixtures/schema';
import { request as requestOf } from './fixtures';
import { DEFAULT_TIERS, removeItems, summarize, tiersFor, vendorView } from './request';

describe('removeItems', () => {
	it('takes the items named out of the request', () => {
		expect(removeItems([shot('a'), shot('b')], ['a']).map((s) => s.id)).toEqual(['b']);
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
		expect(summarize(request)).toEqual({ shots: 3, shotsOmitted: 1, assets: 1, assetsOmitted: 1, frames: 136, shotsWithoutFrames: 1, sequences: 2 });
	});
});
