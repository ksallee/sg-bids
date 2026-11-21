import { describe, expect, it } from 'vitest';
import { ASSET_501, ASSET_502, SHOT_1001, SHOT_1002, sequenceRow } from './fixtures/rows';
import { asset, shot } from './fixtures';
import { sequenceIndex } from './freeze';
import { addLabel, inRequest, listRow, shownState, toggleShown, toggle } from './add-list';

const sequences = sequenceIndex([sequenceRow(31, 'sq010', null)], null);

describe('listRow', () => {
	it('reads a Shot as thumbnail, code, status and its Sequence by code', () => {
		expect(listRow(SHOT_1001, 'shot', { sequence: 'sg_sequence' }, sequences)).toEqual({
			id: 1001,
			code: 'sh010_0010',
			image: SHOT_1001.attributes.image,
			status: 'ip',
			aside: 'sq010'
		});
	});

	it('falls back on the link name when the Sequence is not in the index, and on nothing', () => {
		expect(listRow(SHOT_1001, 'shot', { sequence: 'sg_sequence' }, new Map()).aside).toBe('sh010');
		expect(listRow(SHOT_1002, 'shot', { sequence: 'sg_sequence' }, sequences)).toEqual({ id: 1002, code: 'sh010_0020', image: null, status: 'wtg', aside: null });
		expect(listRow(SHOT_1001, 'shot', {}, sequences).aside).toBeNull();
	});

	it('reads an Asset with its type as the quiet text', () => {
		expect(listRow(ASSET_501, 'asset', { type: 'sg_asset_type' }, sequences)).toMatchObject({ id: 501, code: 'heroA', status: 'ip', aside: 'Character' });
		expect(listRow(ASSET_502, 'asset', {}, sequences).aside).toBeNull();
	});

	it('labels a row with no code by its type and id, which stays in the dialog', () => {
		const row = { ...SHOT_1002, attributes: { ...SHOT_1002.attributes, code: '  ' } };
		expect(listRow(row, 'shot', {}, sequences).code).toBe('Shot 1002');
	});
});

describe('inRequest', () => {
	it('holds the Flow PT ids of the rows in the request, a linked breakdown row too', () => {
		const items = [shot('shot-1001', { fpt: { type: 'Shot', id: 1001 } }), shot('shot-bd-1', { source: 'breakdown' }), shot('shot-bd-2', { source: 'breakdown', fpt: { type: 'Shot', id: 1002 } })];
		expect([...inRequest(items)].sort()).toEqual([1001, 1002]);
	});

	it('is empty for an empty request', () => {
		expect(inRequest([asset('a')]).size).toBe(0);
	});
});

describe('toggle', () => {
	const order = [1, 2, 3, 4, 5];
	const none = new Set<number>();

	it('ticks and unticks one row, and moves the anchor to it', () => {
		const first = toggle({ selected: none, anchor: null }, 2, { order, blocked: none, shift: false });
		expect([...first.selected]).toEqual([2]);
		expect(first.anchor).toBe(2);
		const second = toggle(first, 2, { order, blocked: none, shift: false });
		expect(second.selected.size).toBe(0);
		expect(second.anchor).toBe(2);
	});

	it('ticks the range from the anchor with Shift, either way, skipping rows already in the request', () => {
		const start = { selected: new Set([2]), anchor: 2 };
		const down = toggle(start, 5, { order, blocked: new Set([4]), shift: true });
		expect([...down.selected].sort()).toEqual([2, 3, 5]);
		expect(down.anchor).toBe(5);
		const up = toggle({ selected: none, anchor: 4 }, 1, { order, blocked: none, shift: true });
		expect([...up.selected].sort()).toEqual([1, 2, 3, 4]);
	});

	it('unticks the range when the row pressed was ticked', () => {
		const out = toggle({ selected: new Set([1, 2, 3, 4]), anchor: 1 }, 3, { order, blocked: none, shift: true });
		expect([...out.selected]).toEqual([4]);
	});

	it('acts as a plain press when the anchor is not shown any more', () => {
		const out = toggle({ selected: new Set([9]), anchor: 9 }, 3, { order, blocked: none, shift: true });
		expect([...out.selected].sort()).toEqual([3, 9]);
	});

	it('leaves a row already in the request alone', () => {
		const start = { selected: none, anchor: null };
		expect(toggle(start, 2, { order, blocked: new Set([2]), shift: false })).toBe(start);
	});
});

describe('shownState and toggleShown', () => {
	const blocked = new Set([3]);

	it('says whether every row shown that can be added is ticked', () => {
		expect(shownState(new Set(), [1, 2, 3], blocked)).toBe('none');
		expect(shownState(new Set([1]), [1, 2, 3], blocked)).toBe('some');
		expect(shownState(new Set([1, 2]), [1, 2, 3], blocked)).toBe('all');
		expect(shownState(new Set([9]), [1, 2], blocked)).toBe('none');
		expect(shownState(new Set(), [3], blocked)).toBe('none');
	});

	it('ticks every row shown, and unticks them when all are ticked, keeping picks not shown', () => {
		expect([...toggleShown(new Set([9]), [1, 2, 3], blocked)].sort()).toEqual([1, 2, 9]);
		expect([...toggleShown(new Set([1, 2, 9]), [1, 2, 3], blocked)]).toEqual([9]);
		expect([...toggleShown(new Set([1]), [1, 2, 3], blocked)].sort()).toEqual([1, 2]);
	});
});

describe('addLabel', () => {
	it('counts what is ticked in the button', () => {
		expect(addLabel('shot', 0)).toBe('Add shots');
		expect(addLabel('shot', 1)).toBe('Add 1 shot');
		expect(addLabel('asset', 12)).toBe('Add 12 assets');
	});
});
