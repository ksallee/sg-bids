import { describe, expect, it } from 'vitest';
import { ASSET_501, ASSET_502, SHOT_1001, SHOT_1002, sequenceRow, shotRow } from './fixtures/rows';
import { EPISODE_FROM_SEQUENCE } from './field-map';
import { assetItemId, freezeAsset, freezeShot, sequenceIndex, shotItemId } from './freeze';

const STOCK = { description: 'description', frames: 'sg_cut_duration', sequence: 'sg_sequence', episode: null, type: null, difficulty: null, assets: 'assets' };

describe('item ids', () => {
	it('key a request item on its Flow PT id', () => {
		expect(shotItemId(1001)).toBe('shot-1001');
		expect(assetItemId(7)).toBe('asset-7');
	});
});

describe('freezeShot', () => {
	it('copies what the mapping names off the row', () => {
		expect(freezeShot(SHOT_1001, STOCK)).toEqual({
			id: 'shot-1001',
			code: 'sh010_0010',
			fpt: { type: 'Shot', id: 1001 },
			description: 'Hero lands on the roof.',
			sequence: 'sh010',
			frames: 96,
			omitted: false,
			assetIds: ['asset-501', 'asset-502'],
			thumbnail: SHOT_1001.attributes.image
		});
	});

	it('leaves out what the row has empty', () => {
		expect(freezeShot(SHOT_1002, STOCK)).toEqual({ id: 'shot-1002', code: 'sh010_0020', fpt: { type: 'Shot', id: 1002 }, omitted: false, assetIds: [] });
	});

	it('reads nothing for a slot left empty', () => {
		const shot = freezeShot(SHOT_1001, { ...STOCK, description: null, frames: null, assets: null });
		expect(shot.description).toBeUndefined();
		expect(shot.frames).toBeUndefined();
		expect(shot.assetIds).toEqual([]);
	});

	it('rounds a float frame count and drops one that is not a count', () => {
		expect(freezeShot(shotRow(1, { code: 'a', f: 95.6 }), { frames: 'f' }).frames).toBe(96);
		expect(freezeShot(shotRow(1, { code: 'a', f: -3 }), { frames: 'f' }).frames).toBeUndefined();
		expect(freezeShot(shotRow(1, { code: 'a', f: '96' }), { frames: 'f' }).frames).toBeUndefined();
	});

	it('reads a list, a text or a number as the type and the difficulty', () => {
		const row = shotRow(1, { code: 'a', sg_shot_type: '3D', sg_complexity: 'C' });
		const shot = freezeShot(row, { type: 'sg_shot_type', difficulty: 'sg_complexity' });
		expect(shot.type).toBe('3D');
		expect(shot.difficulty).toBe('C');
		expect(freezeShot(shotRow(1, { code: 'a', d: 3 }), { difficulty: 'd' }).difficulty).toBe('3');
	});

	it("reads the shot's own episode link", () => {
		const row = shotRow(1, { code: 'a' }, { sg_episode: { type: 'Episode', id: 4, name: 'ep104' } });
		expect(freezeShot(row, { episode: 'sg_episode' }).episode).toBe('ep104');
	});

	it("reads the episode through the shot's Sequence", () => {
		const sequences = sequenceIndex([sequenceRow(31, 'sh010', { type: 'Episode', id: 4, name: 'ep104' })], 'episode');
		expect(freezeShot(SHOT_1001, { ...STOCK, episode: EPISODE_FROM_SEQUENCE }, sequences).episode).toBe('ep104');
		expect(freezeShot(SHOT_1002, { ...STOCK, episode: EPISODE_FROM_SEQUENCE }, sequences).episode).toBeUndefined();
	});

	it('falls back to the id when the row has no code', () => {
		expect(freezeShot(shotRow(9, {}), {}).code).toBe('Shot 9');
	});
});

describe('freezeAsset', () => {
	it('copies the asset', () => {
		expect(freezeAsset(ASSET_501, { description: 'description', type: 'sg_asset_type', difficulty: null })).toEqual({
			id: 'asset-501',
			name: 'heroA',
			fpt: { type: 'Asset', id: 501 },
			description: 'The hero, full CG double.',
			type: 'Character',
			omitted: false
		});
		expect(freezeAsset(ASSET_502, { description: 'description', type: 'sg_asset_type' }).description).toBeUndefined();
	});
});

describe('sequenceIndex', () => {
	it('keys each Sequence by id with its code and episode', () => {
		const index = sequenceIndex([sequenceRow(31, 'sh010', null), sequenceRow(32, 'sh020', { type: 'Episode', id: 4, name: 'ep104' })], 'episode');
		expect(index.get(31)).toEqual({ id: 31, code: 'sh010', episode: null });
		expect(index.get(32)).toEqual({ id: 32, code: 'sh020', episode: { id: 4, name: 'ep104' } });
	});

	it('has no episode when the site has none on Sequence', () => {
		expect(sequenceIndex([sequenceRow(32, 'sh020', { type: 'Episode', id: 4, name: 'ep104' })], null).get(32)?.episode).toBeNull();
	});
});
