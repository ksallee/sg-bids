import { describe, expect, it } from 'vitest';
import { leftLine, linesByItem, list, planCounts, publishLabel, stepViews, undoLine } from './award-view';
import { NOTHING_WRITTEN, type AwardPlan, type LinePreview } from './fpt-award';
import { money } from './money';

const NONE = { bids: [], lines: [], groups: [], removed: { bids: [], lines: [], groups: [], items: [] }, created: [], sequences: [], unlinked: [] };
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
	collisions: [],
	released: [],
	warnings: []
};

describe('planCounts and publishLabel', () => {
	it('counts each kind of write', () => {
		expect(planCounts(PLAN)).toEqual({
			bids: { create: 1, update: 1 },
			lines: { create: 1, update: 0 },
			groups: 2,
			removed: { bids: 0, lines: 1, groups: 1, items: 0 },
			links: 1,
			created: { Shot: 0, Asset: 0, Sequence: 0 }
		});
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
		target: `shot:${id}`,
		ref: { type: 'Shot', id },
		vendor,
		action: 'create',
		amount: money(100, 'USD'),
		amountBase: money(100, 'USD'),
		share,
		awardedBase: null,
		excluded: false,
		package: null,
		inPackage: false
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

describe('the words for created rows', () => {
	const created: AwardPlan = {
		...PLAN,
		steps: [
			{ label: 'Sequences', mode: 'batch', writes: [{ kind: 'createItem', itemType: 'Sequence', key: 'sequence:sq9', data: {} }] },
			{
				label: 'Shots and Assets',
				mode: 'batch',
				writes: [
					{ kind: 'createItem', itemType: 'Shot', key: 'shot:a', data: {} },
					{ kind: 'createItem', itemType: 'Shot', key: 'shot:b', data: {} },
					{ kind: 'createItem', itemType: 'Asset', key: 'asset:c', data: {} }
				]
			},
			...PLAN.steps.slice(1)
		]
	};

	it('counts and names what a publish creates', () => {
		expect(planCounts(created).created).toEqual({ Shot: 2, Asset: 1, Sequence: 1 });
		expect(publishLabel(created)).toBe('Publish 2 Shots, 1 Asset, 1 Sequence, 2 Bids, 1 Bid Line and 2 Groups');
		expect(stepViews(created).map((s) => s.label).slice(0, 2)).toEqual(['Sequences', 'Shots and Assets']);
		expect(stepViews(created)[1].line).toMatch(/^One batch, all or nothing/);
	});

	it('names a created row the undo left, and why', () => {
		expect(leftLine([])).toBeNull();
		expect(leftLine([{ key: 'shot:a', type: 'Shot', id: 9, why: 'it has 2 Tasks' }])).toBe(
			'Undo left a row the publish created: Shot 9 (it has 2 Tasks). It has links the app did not make, so it stays in Flow PT. The app no longer tracks it.'
		);
	});

	it('says the undo deletes the rows it created', () => {
		const written = {
			...NOTHING_WRITTEN,
			items: [
				{ key: 'shot:a', type: 'Shot' as const, id: 1 },
				{ key: 'sequence:s', type: 'Sequence' as const, id: 2 }
			]
		};
		expect(undoLine(written)).toBe(
			'Undo deletes the 1 Shot and 1 Sequence the publish created, unless one has gained Tasks, Versions or other links since. Then the request is issued again and the rates unlock.'
		);
	});
});
