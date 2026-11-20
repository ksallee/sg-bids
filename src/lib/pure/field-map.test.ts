import { describe, expect, it } from 'vitest';
import { normalizeFields } from 'sg-widgets-core';
import { ASSET_FIELDS_A, ASSET_FIELDS_B, SEQUENCE_FIELDS_A, SEQUENCE_FIELDS_CUSTOM, SEQUENCE_FIELDS_TWO, SHOT_FIELDS_A, SHOT_FIELDS_B } from './fixtures/schema';
import {
	DIFFICULTY_TIERS,
	EPISODE_FROM_SEQUENCE,
	cleanMapping,
	sequenceEpisodeField,
	detectMapping,
	mappingStatus,
	mappingWords,
	readFields,
	slotOptions,
	slotsFor,
	type SiteShape
} from './field-map';

const shotA = normalizeFields(SHOT_FIELDS_A);
const assetA = normalizeFields(ASSET_FIELDS_A);
const shotB = normalizeFields(SHOT_FIELDS_B);
const assetB = normalizeFields(ASSET_FIELDS_B);

const NO_EPISODE: SiteShape = { episodes: false, sequenceEpisodeField: null };
const EPISODES_ON_SEQUENCE: SiteShape = { episodes: true, sequenceEpisodeField: 'episode' };

describe('slotsFor', () => {
	it('names what a shot and an asset carry, in order', () => {
		expect(slotsFor('shot').map((s) => s.slot)).toEqual(['description', 'frames', 'sequence', 'episode', 'type', 'difficulty', 'assets']);
		expect(slotsFor('asset').map((s) => s.slot)).toEqual(['description', 'type', 'difficulty']);
	});
});

describe('slotOptions', () => {
	it('offers the fields of the right data type, by label', () => {
		expect(slotOptions('shot', 'frames', shotA, NO_EPISODE).map((o) => o.code)).toEqual(['sg_cut_duration', 'sg_cut_in', 'sg_cut_out']);
		expect(slotOptions('shot', 'description', shotA, NO_EPISODE).map((o) => o.code)).toEqual(['description', 'code']);
	});

	it('offers a link field only when it links the right type', () => {
		expect(slotOptions('shot', 'sequence', shotA, NO_EPISODE).map((o) => o.code)).toEqual(['sg_sequence']);
		expect(slotOptions('shot', 'assets', shotA, NO_EPISODE).map((o) => o.code)).toEqual(['assets']);
	});

	it('never offers a read only link, such as image_source_entity, which links every type', () => {
		expect(slotOptions('shot', 'episode', shotA, EPISODES_ON_SEQUENCE).map((o) => o.code)).toEqual([EPISODE_FROM_SEQUENCE]);
		expect(slotOptions('shot', 'sequence', shotA, NO_EPISODE).map((o) => o.code)).toEqual(['sg_sequence']);
	});

	it('never offers a status, a pivot column or a read only date', () => {
		const all = slotsFor('shot').flatMap((s) => slotOptions('shot', s.slot, shotA, EPISODES_ON_SEQUENCE).map((o) => o.code));
		expect(all).not.toContain('sg_status_list');
		expect(all).not.toContain('step_0');
		expect(all).not.toContain('created_at');
	});

	it('offers the episode through the sequence when the site has one there', () => {
		expect(slotOptions('shot', 'episode', shotA, NO_EPISODE)).toEqual([]);
		expect(slotOptions('shot', 'episode', shotA, EPISODES_ON_SEQUENCE)).toEqual([{ code: EPISODE_FROM_SEQUENCE, label: "The Sequence's Episode" }]);
		expect(slotOptions('shot', 'episode', shotB, EPISODES_ON_SEQUENCE).map((o) => o.code)).toEqual(['sg_episode', EPISODE_FROM_SEQUENCE]);
	});

	it('has no episode through the sequence when the shot has no sequence field', () => {
		const noSequence = Object.fromEntries(Object.entries(shotA).filter(([name]) => name !== 'sg_sequence'));
		expect(slotOptions('shot', 'episode', noSequence, EPISODES_ON_SEQUENCE)).toEqual([]);
	});
});

describe('detectMapping', () => {
	it('maps the stock site', () => {
		expect(detectMapping('shot', shotA, NO_EPISODE)).toEqual({
			description: 'description',
			frames: 'sg_cut_duration',
			sequence: 'sg_sequence',
			episode: null,
			type: null,
			difficulty: null,
			assets: 'assets'
		});
		expect(detectMapping('asset', assetA, NO_EPISODE)).toEqual({ description: 'description', type: 'sg_asset_type', difficulty: null });
	});

	it('takes the episode through the sequence when the shot has none of its own', () => {
		expect(detectMapping('shot', shotA, EPISODES_ON_SEQUENCE).episode).toBe(EPISODE_FROM_SEQUENCE);
	});

	it('maps a configured site by name', () => {
		expect(detectMapping('shot', shotB, EPISODES_ON_SEQUENCE)).toEqual({
			description: 'sg_brief',
			frames: 'sg_frame_count',
			sequence: 'sg_sequence',
			episode: 'sg_episode',
			type: 'sg_shot_type',
			difficulty: 'sg_complexity',
			assets: 'assets'
		});
		expect(detectMapping('asset', assetB, NO_EPISODE)).toEqual({ description: 'sg_brief', type: 'sg_asset_type', difficulty: 'sg_difficulty' });
	});

	it('takes a lone link to the type whatever its name, but not one that links several types', () => {
		const withLink = (validTypes: string[]) => ({
			...shotA,
			sg_show_part: { ...shotA.sg_sequence, name: 'sg_show_part', displayName: 'Part', validTypes }
		});
		expect(detectMapping('shot', withLink(['Episode']), NO_EPISODE).episode).toBe('sg_show_part');
		expect(detectMapping('shot', withLink(['Episode', 'Scene']), NO_EPISODE).episode).toBeNull();
		expect(slotOptions('shot', 'episode', withLink(['Episode', 'Scene']), NO_EPISODE).map((o) => o.code)).toEqual(['sg_show_part']);
	});

	it('never maps the code as the description', () => {
		const onlyCode = { code: shotA.code };
		expect(detectMapping('shot', onlyCode, NO_EPISODE).description).toBeNull();
	});
});

describe('cleanMapping', () => {
	it('keeps a saved pick that is still on offer', () => {
		const saved = { ...detectMapping('shot', shotA, NO_EPISODE), frames: 'sg_cut_out' };
		expect(cleanMapping('shot', saved, shotA, NO_EPISODE).frames).toBe('sg_cut_out');
	});

	it('keeps a slot the user left empty on purpose', () => {
		const saved = { ...detectMapping('shot', shotA, NO_EPISODE), description: null };
		expect(cleanMapping('shot', saved, shotA, NO_EPISODE).description).toBeNull();
	});

	it('detects again a pick the schema no longer offers, and a slot never saved', () => {
		const cleaned = cleanMapping('shot', { frames: 'sg_gone', description: 'description' }, shotA, NO_EPISODE);
		expect(cleaned.frames).toBe('sg_cut_duration');
		expect(cleaned.sequence).toBe('sg_sequence');
	});
});

describe('readFields', () => {
	it('reads the code, the thumbnail, the status and every mapped field once', () => {
		const mapping = detectMapping('shot', shotA, EPISODES_ON_SEQUENCE);
		expect(readFields('shot', mapping, shotA)).toEqual(['code', 'image', 'sg_status_list', 'description', 'sg_cut_duration', 'sg_sequence', 'assets']);
	});

	it('leaves out what the schema lacks', () => {
		expect(readFields('asset', { description: 'sg_brief', type: 'sg_asset_type', difficulty: null }, assetB)).toEqual(['code', 'sg_brief', 'sg_asset_type']);
	});
});

describe('sequenceEpisodeField', () => {
	it('finds the stock episode link (entity_types/Sequence)', () => {
		expect(sequenceEpisodeField(normalizeFields(SEQUENCE_FIELDS_A))).toBe('episode');
	});
	it('takes a lone custom link to Episode', () => {
		expect(sequenceEpisodeField(normalizeFields(SEQUENCE_FIELDS_CUSTOM))).toBe('sg_ep');
	});
	it('has none when nothing links an Episode, or two do and neither is the stock one', () => {
		expect(sequenceEpisodeField(normalizeFields(SHOT_FIELDS_A))).toBeNull();
		expect(sequenceEpisodeField(normalizeFields(SEQUENCE_FIELDS_TWO))).toBeNull();
	});
});

describe('mappingStatus', () => {
	const schemas = { shot: shotA, asset: assetA };
	const detected = () => ({ shot: detectMapping('shot', shotA, NO_EPISODE), asset: detectMapping('asset', assetA, NO_EPISODE) });

	it('counts the fields read and names what is left unmapped', () => {
		const status = mappingStatus(detected(), schemas, NO_EPISODE);
		expect(status.used).toBe(6);
		expect(status.unmapped.map((u) => [u.kind, u.slot, u.options, u.creatable])).toEqual([
			['shot', 'type', 2, true],
			['shot', 'difficulty', 5, true],
			['asset', 'difficulty', 3, true]
		]);
	});

	it('leaves out a slot the site cannot fill and the app cannot create, such as an Episode on a film site', () => {
		expect(mappingStatus(detected(), schemas, NO_EPISODE).unmapped.some((u) => u.slot === 'episode')).toBe(false);
	});

	it('says it in words, one line per concept', () => {
		expect(mappingWords(mappingStatus(detected(), schemas, NO_EPISODE))).toEqual({
			headline: 'Using 6 fields from this site.',
			unmapped: ['Type is not mapped for Shots.', 'Difficulty is not mapped for Shots and Assets.']
		});
		const mapping = detected();
		const full = { shot: { ...mapping.shot, type: 'description', difficulty: 'description' }, asset: { ...mapping.asset, difficulty: 'description' } };
		expect(mappingWords(mappingStatus(full, schemas, NO_EPISODE))).toEqual({ headline: 'Using 6 fields from this site.', unmapped: [] });
	});

	it('says one field in the singular', () => {
		const one = { shot: { description: 'description' }, asset: {} };
		expect(mappingWords(mappingStatus(one, schemas, NO_EPISODE)).headline).toBe('Using 1 field from this site.');
	});
});

describe('create specs', () => {
	it('creates a text, a number or a list for a slot, never a link', () => {
		const created = (kind: 'shot' | 'asset') => slotsFor(kind).map((s) => [s.slot, s.create?.dataType ?? null]);
		expect(created('shot')).toEqual([
			['description', 'text'],
			['frames', 'number'],
			['sequence', null],
			['episode', null],
			['type', 'list'],
			['difficulty', 'list'],
			['assets', null]
		]);
		expect(created('asset')).toEqual([
			['description', 'text'],
			['type', 'list'],
			['difficulty', 'list']
		]);
	});

	it('offers the four tiers for a new difficulty list', () => {
		expect(slotsFor('shot').find((s) => s.slot === 'difficulty')?.create).toEqual({ dataType: 'list', display: 'Difficulty', values: ['Simple', 'Moderate', 'Complex', 'Hero'] });
		expect(DIFFICULTY_TIERS).toEqual(['Simple', 'Moderate', 'Complex', 'Hero']);
	});
});
