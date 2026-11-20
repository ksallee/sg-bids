import { describe, expect, it } from 'vitest';
import { normalizeFields } from 'sg-widgets-core';
import { asset, shot } from './fixtures';
import { SHOT_FIELDS_A, SHOT_FIELDS_B } from './fixtures/schema';
import { emptyHeaderForm, type HeaderForm } from './header';
import { DEFAULT_TIERS, buildRequest, editItem, editItems, removeItems, restoreState, summarize, tiersFor, vendorView, type BuilderState } from './request';

const form: HeaderForm = { ...emptyHeaderForm('GBP'), code: 'DS_R1', title: 'Main bid' };

function state(extra: Partial<BuilderState> = {}): BuilderState {
	return { id: 'draft-1', project: { id: 85, name: 'Demo Show' }, form, shots: [], assets: [], ...extra };
}

describe('buildRequest', () => {
	it('puts the header and the items in a request with no vendor yet', () => {
		const request = buildRequest(state({ shots: [shot('shot-1')], assets: [asset('asset-9')] }));
		expect(request.id).toBe('draft-1');
		expect(request.header.code).toBe('DS_R1');
		expect(request.header.baseCurrency).toBe('GBP');
		expect(request.header.projectRef).toEqual({ type: 'Project', id: 85 });
		expect(request.shots.map((s) => s.id)).toEqual(['shot-1']);
		expect(request.assets.map((a) => a.id)).toEqual(['asset-9']);
		expect(request.vendors).toEqual([]);
	});

	it('links a shot only to the assets in the request', () => {
		const request = buildRequest(state({ shots: [shot('shot-1', { assetIds: ['asset-9', 'asset-10'] })], assets: [asset('asset-9')] }));
		expect(request.shots[0].assetIds).toEqual(['asset-9']);
	});

	it('counts how many shots in the request use each asset', () => {
		const request = buildRequest(
			state({
				shots: [shot('shot-1', { assetIds: ['asset-9'] }), shot('shot-2', { assetIds: ['asset-9'] }), shot('shot-3', { assetIds: ['asset-9'], omitted: true })],
				assets: [asset('asset-9'), asset('asset-10')]
			})
		);
		expect(request.assets.map((a) => a.timesUsed)).toEqual([2, 0]);
	});
});

describe('restoreState', () => {
	it('reads a stored request back into the builder', () => {
		const start = state({ shots: [shot('shot-1')], assets: [asset('asset-9')] });
		const back = restoreState(buildRequest(start));
		expect(back.project).toEqual(start.project);
		expect(back.form).toEqual(start.form);
		expect(back.shots.map((s) => s.id)).toEqual(['shot-1']);
		expect(back.assets[0].timesUsed).toBe(0);
	});

	it('has no project when the request names none', () => {
		const request = buildRequest(state({ project: null }));
		expect(restoreState(request).project).toBeNull();
	});
});

describe('editItem', () => {
	it('changes one item and leaves the rest', () => {
		const items = [shot('a'), shot('b')];
		const next = editItem(items, 'b', { description: 'New', omitted: true });
		expect(next[1]).toEqual({ ...items[1], description: 'New', omitted: true });
		expect(next[0]).toBe(items[0]);
	});

	it('clears a field set to blank', () => {
		const next = editItem([shot('a', { notes: 'x' })], 'a', { notes: '  ' });
		expect('notes' in next[0]).toBe(false);
	});
});

describe('editItems', () => {
	it('changes every item named, the same way, and leaves the rest', () => {
		const items = [shot('a'), shot('b'), shot('c')];
		const next = editItems(items, ['a', 'c'], { difficulty: 'Hero' });
		expect(next.map((s) => s.difficulty)).toEqual(['Hero', undefined, 'Hero']);
		expect(next[1]).toBe(items[1]);
	});
});

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
	const request = buildRequest(
		state({
			shots: [
				shot('shot-1', { frames: 96, sequence: 'sh010' }),
				shot('shot-2', { frames: 40, sequence: 'sh010' }),
				shot('shot-3', { sequence: 'sh020' }),
				shot('shot-4', { frames: 500, omitted: true, sequence: 'sh030' })
			],
			assets: [asset('asset-9'), asset('asset-10', { omitted: true })]
		})
	);

	it('shows the vendor only what is in', () => {
		const view = vendorView(request);
		expect(view.shots.map((s) => s.id)).toEqual(['shot-1', 'shot-2', 'shot-3']);
		expect(view.assets.map((a) => a.id)).toEqual(['asset-9']);
	});

	it('counts what goes out and what is held back', () => {
		expect(summarize(request)).toEqual({ shots: 3, shotsOmitted: 1, assets: 1, assetsOmitted: 1, frames: 136, shotsWithoutFrames: 1, sequences: 2 });
	});
});
