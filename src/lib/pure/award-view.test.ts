import { describe, expect, it } from 'vitest';
import { linesByItem, list, planCounts, publishLabel, stepViews, undoLine } from './award-view';
import { NOTHING_WRITTEN, type AwardPlan, type LinePreview } from './fpt-award';
import { money } from './money';

const NONE = { bids: [], lines: [], groups: [], removed: { bids: [], lines: [], groups: [] } };
const PLAN: AwardPlan = {
	steps: [
		{ label: 'Take back what the scenario dropped', mode: 'batch', writes: [{ kind: 'removeGroups', itemType: 'Shot', id: 1, field: 'f', groups: [38] }, { kind: 'delete', entity: 'line', key: 'k', id: 9 }] },
		{ label: 'Bids', mode: 'batch', writes: [{ kind: 'create', entity: 'bid', key: 'a', data: {} }, { kind: 'update', entity: 'bid', key: 'b', id: 2, data: {} }] },
		{
			label: 'Bid Lines and vendor Groups',
			mode: 'batch',
			writes: [{ kind: 'create', entity: 'line', key: 'l', data: {} }, { kind: 'addGroups', itemType: 'Shot', id: 1, field: 'f', groups: [38, 39] }]
		},
		{ label: 'App links', mode: 'single', writes: [{ kind: 'link', key: 'a', url: 'u' }] }
	],
	preview: NONE,
	warnings: []
};

describe('planCounts and publishLabel', () => {
	it('counts each kind of write', () => {
		expect(planCounts(PLAN)).toEqual({ bids: { create: 1, update: 1 }, lines: { create: 1, update: 0 }, groups: 2, removed: { bids: 0, lines: 1, groups: 1 }, links: 1 });
		expect(publishLabel(PLAN)).toBe('Publish 2 Bids, 1 Bid Line and 2 Groups');
		expect(publishLabel({ ...PLAN, steps: [] })).toBe('Publish');
	});
});

describe('stepViews', () => {
	it('says what each step does, in order', () => {
		expect(stepViews(PLAN).map((s) => [s.label, s.writes])).toEqual([
			['Take back what the scenario dropped', 2],
			['Bids', 2],
			['Bid Lines and vendor Groups', 2],
			['App links', 1]
		]);
	});
});

describe('linesByItem', () => {
	const l = (item: string, id: number, vendor: string, share: string | null): LinePreview => ({
		key: `${item}${vendor}`,
		item,
		ref: { type: 'Shot', id },
		vendor,
		action: 'create',
		amount: money(100, 'USD'),
		amountBase: money(100, 'USD'),
		share,
		awardedBase: null,
		excluded: false
	});
	it('groups a split item, its vendors together', () => {
		const out = linesByItem([l('SH010', 1, 'A', '100'), l('SH020', 2, 'A', '60'), l('SH020', 2, 'B', '40'), l('SH030', 3, 'B', null)]);
		expect(out.map((i) => [i.item, i.lines.length, i.split])).toEqual([
			['SH010', 1, false],
			['SH020', 2, true],
			['SH030', 1, false]
		]);
	});
});

describe('undoLine and list', () => {
	it('says what the undo takes back', () => {
		const written = {
			bids: [
				{ key: 'a', id: 1, created: true },
				{ key: 'b', id: 2, created: false }
			],
			lines: [{ key: 'l', id: 3, created: true }],
			groups: [{ itemType: 'Shot' as const, id: 1, field: 'f', groups: [38, 39] }],
			attachments: []
		};
		expect(undoLine(written)).toBe('Undo removes 2 Groups from the Shots and Assets and deletes 1 Bid and 1 Bid Line. Then the request is issued again and the rates unlock.');
		expect(undoLine(NOTHING_WRITTEN)).toBe('Undo finds nothing the app wrote. It clears the award in the app.');
		expect(list(['a'])).toBe('a');
		expect(list([])).toBe('');
	});
});
