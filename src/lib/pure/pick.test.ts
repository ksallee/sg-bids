import { describe, expect, it } from 'vitest';
import { SHOT_1001, SHOT_1002, sequenceRow } from './fixtures/rows';
import { shot } from './fixtures';
import { EPISODE_FROM_SEQUENCE } from './field-map';
import { sequenceIndex } from './freeze';
import { EMPTY_FILTER, addPicked, isFiltered, mergePicked, pickFilters, selectionRefs, type FilterContext } from './pick';

const project = { type: 'Project', id: 85 };
const sequences = sequenceIndex(
	[
		sequenceRow(31, 'sh010', { type: 'Episode', id: 4, name: 'ep104' }),
		sequenceRow(32, 'sh020', { type: 'Episode', id: 4, name: 'ep104' }),
		sequenceRow(33, 'sh030', { type: 'Episode', id: 5, name: 'ep105' }),
		sequenceRow(34, 'sh040', null)
	],
	'episode'
);

const shotContext: FilterContext = {
	projectId: 85,
	statusField: 'sg_status_list',
	typeField: null,
	sequenceField: 'sg_sequence',
	episodeField: EPISODE_FROM_SEQUENCE,
	sequences
};

describe('pickFilters', () => {
	it('scopes every read to the project (entity_types/Shot)', () => {
		expect(pickFilters(EMPTY_FILTER, shotContext)).toEqual({ kind: 'filters', filters: { logical_operator: 'and', conditions: [['project', 'is', project]] } });
	});

	it('wants every word of the search in the code', () => {
		const result = pickFilters({ ...EMPTY_FILTER, search: '  sh010  0020 ' }, shotContext);
		expect(result.kind === 'filters' && result.filters.conditions).toEqual([
			['project', 'is', project],
			['code', 'contains', 'sh010'],
			['code', 'contains', '0020']
		]);
	});

	it('filters status and type with in', () => {
		const result = pickFilters({ ...EMPTY_FILTER, statuses: ['ip', 'rdy'], types: ['3D'] }, { ...shotContext, typeField: 'sg_shot_type' });
		expect(result.kind === 'filters' && result.filters.conditions.slice(1)).toEqual([
			['sg_status_list', 'in', ['ip', 'rdy']],
			['sg_shot_type', 'in', ['3D']]
		]);
	});

	it('filters the sequences picked', () => {
		const result = pickFilters({ ...EMPTY_FILTER, sequences: [31, 33] }, shotContext);
		expect(result.kind === 'filters' && result.filters.conditions.slice(1)).toEqual([
			[
				'sg_sequence',
				'in',
				[
					{ type: 'Sequence', id: 31 },
					{ type: 'Sequence', id: 33 }
				]
			]
		]);
	});

	it("turns an episode into its Sequences when the episode comes from the Sequence", () => {
		const result = pickFilters({ ...EMPTY_FILTER, episodes: [4] }, shotContext);
		expect(result.kind === 'filters' && result.filters.conditions.slice(1)).toEqual([
			[
				'sg_sequence',
				'in',
				[
					{ type: 'Sequence', id: 31 },
					{ type: 'Sequence', id: 32 }
				]
			]
		]);
	});

	it('keeps the Sequences both filters allow', () => {
		const result = pickFilters({ ...EMPTY_FILTER, episodes: [4], sequences: [32, 33] }, shotContext);
		expect(result.kind === 'filters' && result.filters.conditions.slice(1)).toEqual([['sg_sequence', 'in', [{ type: 'Sequence', id: 32 }]]]);
	});

	it('reads nothing when no Sequence is left', () => {
		expect(pickFilters({ ...EMPTY_FILTER, episodes: [5], sequences: [31] }, shotContext)).toEqual({ kind: 'none' });
		expect(pickFilters({ ...EMPTY_FILTER, episodes: [99] }, shotContext)).toEqual({ kind: 'none' });
	});

	it("filters the shot's own episode field", () => {
		const result = pickFilters({ ...EMPTY_FILTER, episodes: [4] }, { ...shotContext, episodeField: 'sg_episode' });
		expect(result.kind === 'filters' && result.filters.conditions.slice(1)).toEqual([['sg_episode', 'in', [{ type: 'Episode', id: 4 }]]]);
	});

	it('ignores a filter whose field the type lacks', () => {
		const assetContext: FilterContext = { ...shotContext, statusField: null, sequenceField: null, episodeField: null };
		expect(pickFilters({ ...EMPTY_FILTER, statuses: ['ip'], sequences: [31], episodes: [4] }, assetContext)).toEqual(pickFilters(EMPTY_FILTER, assetContext));
	});
});

describe('isFiltered', () => {
	it('says when anything narrows the list', () => {
		expect(isFiltered(EMPTY_FILTER)).toBe(false);
		expect(isFiltered({ ...EMPTY_FILTER, search: ' ' })).toBe(false);
		expect(isFiltered({ ...EMPTY_FILTER, statuses: ['ip'] })).toBe(true);
	});
});

describe('mergePicked', () => {
	const freeze = (row: { id: number; attributes: Record<string, unknown> }) => shot(`shot-${row.id}`, { fpt: { type: 'Shot', id: row.id }, code: String(row.attributes.code) });

	it('keeps the edited copy of an item still picked, adds the new, drops the unpicked', () => {
		const kept = shot('shot-1001', { fpt: { type: 'Shot', id: 1001 }, description: 'edited' });
		const gone = shot('shot-7', { fpt: { type: 'Shot', id: 7 } });
		const result = mergePicked([kept, gone], [1001, 1002], [SHOT_1001, SHOT_1002], freeze);
		expect(result.items.map((i) => i.id)).toEqual(['shot-1001', 'shot-1002']);
		expect(result.items[0].description).toBe('edited');
		expect(result.missing).toEqual([]);
	});

	it('names the picks it has no row for', () => {
		expect(mergePicked([], [1001, 42], [SHOT_1001], freeze).missing).toEqual([42]);
	});
});

describe('addPicked', () => {
	it('adds the rows not already picked, keeping the rest', () => {
		const kept = shot('shot-1001', { fpt: { type: 'Shot', id: 1001 }, notes: 'mine' });
		const freeze = (row: { id: number }) => shot(`shot-${row.id}`, { fpt: { type: 'Shot', id: row.id } });
		const items = addPicked([kept], [SHOT_1001, SHOT_1002], freeze);
		expect(items.map((i) => i.id)).toEqual(['shot-1001', 'shot-1002']);
		expect(items[0].notes).toBe('mine');
	});
});

describe('selectionRefs', () => {
	it('gives the table the picked rows as refs', () => {
		expect(selectionRefs([shot('shot-1001', { fpt: { type: 'Shot', id: 1001 }, code: 'sh010' }), shot('x')])).toEqual([{ type: 'Shot', id: 1001, name: 'sh010' }]);
	});
});
