import { describe, expect, it } from 'vitest';
import { SHOT_1001, SHOT_1002, sequenceRow } from './fixtures/rows';
import { shot } from './fixtures';
import { normalizeFields } from 'sg-widgets-core';
import { SHOT_FIELDS_A, SHOT_FIELDS_B } from './fixtures/schema';
import { EPISODE_FROM_SEQUENCE, detectMapping } from './field-map';
import { sequenceIndex } from './freeze';
import { EMPTY_FILTER, addPicked, filterContext, isFiltered, mergePicked, pickColumns, pickFilters, selectionRefs, sequenceOptions, typeOptions, type FilterContext } from './pick';

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

describe('filterContext', () => {
	const shotA = normalizeFields(SHOT_FIELDS_A);
	const shotB = normalizeFields(SHOT_FIELDS_B);

	it('reads the stock site: status, Sequence, the Episode through the Sequence, no type', () => {
		const mapping = detectMapping('shot', shotA, { episodes: true, sequenceEpisodeField: 'episode' });
		expect(filterContext('shot', 85, mapping, shotA, sequences)).toEqual(shotContext);
	});

	it('filters type only on a list field, and the Episode on the shot when it has one', () => {
		const mapping = detectMapping('shot', shotB, { episodes: true, sequenceEpisodeField: 'episode' });
		const context = filterContext('shot', 85, mapping, shotB, sequences);
		expect(context.typeField).toBe('sg_shot_type');
		expect(context.episodeField).toBe('sg_episode');
		expect(filterContext('shot', 85, { ...mapping, type: 'sg_brief' }, shotB, sequences).typeField).toBeNull();
	});

	it('has no Sequence or Episode filter on assets', () => {
		const context = filterContext('asset', 85, { sequence: 'sg_sequence', episode: EPISODE_FROM_SEQUENCE }, shotA, sequences);
		expect(context.sequenceField).toBeNull();
		expect(context.episodeField).toBeNull();
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

describe('pickColumns', () => {
	const shotA = normalizeFields(SHOT_FIELDS_A);
	const shotB = normalizeFields(SHOT_FIELDS_B);

	it('shows the thumbnail, code, sequence, status and the mapped fields the stock site has', () => {
		const mapping = detectMapping('shot', shotA, { episodes: true, sequenceEpisodeField: 'episode' });
		expect(pickColumns('shot', mapping, shotA).map((c) => c.path)).toEqual(['image', 'code', 'sg_sequence', 'sg_status_list', 'sg_cut_duration', 'description']);
	});

	it("adds the shot's own episode, type and difficulty when mapped", () => {
		const mapping = detectMapping('shot', shotB, { episodes: true, sequenceEpisodeField: 'episode' });
		expect(pickColumns('shot', mapping, shotB).map((c) => c.path)).toEqual([
			'code',
			'sg_sequence',
			'sg_episode',
			'sg_status_list',
			'sg_shot_type',
			'sg_complexity',
			'sg_frame_count',
			'sg_brief'
		]);
	});

	it('never lets a cell be edited', () => {
		expect(pickColumns('asset', { description: 'description' }, shotA).every((c) => c.editable === false)).toBe(true);
	});

	it('shows each field once when two slots name it', () => {
		expect(pickColumns('asset', { description: 'code', type: 'code' }, shotA).map((c) => c.path)).toEqual(['image', 'code', 'sg_status_list']);
	});
});

describe('sequenceOptions', () => {
	it('lists the Sequences and the Episodes they link, by name', () => {
		expect(sequenceOptions(sequences)).toEqual({
			sequences: [
				{ code: '31', label: 'sh010' },
				{ code: '32', label: 'sh020' },
				{ code: '33', label: 'sh030' },
				{ code: '34', label: 'sh040' }
			],
			episodes: [
				{ code: '4', label: 'ep104' },
				{ code: '5', label: 'ep105' }
			]
		});
	});
});

describe('typeOptions', () => {
	it("offers a list field's values, nothing for a text field", () => {
		expect(typeOptions(normalizeFields(SHOT_FIELDS_B).sg_shot_type).map((o) => o.code)).toEqual(['2D', '3D', 'FX']);
		expect(typeOptions(normalizeFields(SHOT_FIELDS_A).description)).toEqual([]);
		expect(typeOptions(undefined)).toEqual([]);
	});
});

describe('selectionRefs', () => {
	it('gives the table the picked rows as refs', () => {
		expect(selectionRefs([shot('shot-1001', { fpt: { type: 'Shot', id: 1001 }, code: 'sh010' }), shot('x')])).toEqual([{ type: 'Shot', id: 1001, name: 'sh010' }]);
	});
});
