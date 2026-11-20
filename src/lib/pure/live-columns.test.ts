import { describe, expect, it } from 'vitest';
import { normalizeFields } from 'sg-widgets-core';
import { ASSET_FIELDS_A, ASSET_FIELDS_B, SHOT_FIELDS_A, SHOT_FIELDS_B } from './fixtures/schema';
import { shot, asset } from './fixtures';
import { cellTarget, columnByKey, descriptionAdvice, requestColumns, BID_DESCRIPTION } from './live-columns';

const shotA = normalizeFields(SHOT_FIELDS_A);
const shotB = normalizeFields(SHOT_FIELDS_B);
const assetA = normalizeFields(ASSET_FIELDS_A);
const assetB = normalizeFields(ASSET_FIELDS_B);

const mappingA = { description: 'description', frames: 'sg_cut_duration', sequence: 'sg_sequence', episode: null, type: null, difficulty: null, assets: 'assets' };
const mappingB = { description: 'sg_brief', frames: 'sg_frame_count', sequence: 'sg_sequence', episode: 'sg_episode', type: 'sg_shot_type', difficulty: 'sg_complexity', assets: 'assets' };

describe('requestColumns', () => {
	it('lists a Shot request’s columns in order, live where a field feeds them', () => {
		const columns = requestColumns('shot', mappingB, shotB);
		expect(columns.map((c) => c.key)).toEqual(['code', 'sequence', 'frames', 'description', 'type', 'difficulty', 'omitted', 'notes']);
		expect(columns.filter((c) => c.live).map((c) => c.key)).toEqual(['code', 'sequence', 'frames', 'description', 'type', 'difficulty']);
		expect(columnByKey(columns, 'difficulty')).toMatchObject({ field: 'sg_complexity', dataType: 'list', validValues: ['A', 'B', 'C', 'D'], lock: null });
		expect(columnByKey(columns, 'frames')).toMatchObject({ field: 'sg_frame_count', dataType: 'number' });
	});

	it('keeps an unmapped concept in the request, with the default tiers for difficulty', () => {
		const columns = requestColumns('shot', mappingA, shotA);
		expect(columnByKey(columns, 'difficulty')).toMatchObject({ field: null, live: false, dataType: 'list', validValues: ['Simple', 'Moderate', 'Complex', 'Hero'] });
		expect(columnByKey(columns, 'type')).toMatchObject({ field: null, live: false, dataType: 'text' });
		expect(columnByKey(columns, 'notes')).toMatchObject({ field: null, live: false });
		expect(columnByKey(columns, 'omitted')).toMatchObject({ field: null, live: false, dataType: 'checkbox' });
	});

	it('leaves a mapped name the schema does not hold in the request', () => {
		const columns = requestColumns('shot', { ...mappingA, frames: 'sg_gone' }, shotA);
		expect(columnByKey(columns, 'frames')).toMatchObject({ field: null, live: false, dataType: 'number' });
	});

	it('reads the code and the Sequence live and edits neither here, saying why', () => {
		const columns = requestColumns('shot', mappingA, shotA);
		expect(columnByKey(columns, 'code')).toMatchObject({ live: true, field: 'code' });
		expect(columnByKey(columns, 'code').lock).toMatch(/Rename/);
		expect(columnByKey(columns, 'sequence').lock).toMatch(/Sequence in Flow PT/);
	});

	it('locks a field the schema says the person may not edit, and one the preflight refused', () => {
		const readOnly = { ...shotA, description: { ...shotA.description, editable: false } };
		expect(columnByKey(requestColumns('shot', mappingA, readOnly), 'description').lock).toBe('You cannot edit Description on Shots in Flow PT.');
		const refused = requestColumns('shot', mappingA, shotA, { sg_cut_duration: 'The field is not editable for this user: [Shot.sg_cut_duration].' });
		expect(columnByKey(refused, 'frames').lock).toBe('Flow PT refused a change to Cut Duration: The field is not editable for this user: [Shot.sg_cut_duration].');
	});

	it('lists an Asset request’s columns', () => {
		const columns = requestColumns('asset', { description: 'sg_brief', type: 'sg_asset_type', difficulty: 'sg_difficulty' }, assetB);
		expect(columns.map((c) => c.key)).toEqual(['code', 'type', 'description', 'difficulty', 'omitted', 'notes']);
		expect(columnByKey(columns, 'type')).toMatchObject({ dataType: 'list', validValues: ['Character', 'Prop'] });
		expect(columnByKey(columns, 'difficulty')).toMatchObject({ field: 'sg_difficulty', dataType: 'text' });
		expect(columnByKey(requestColumns('asset', { description: null, type: null, difficulty: null }, assetA), 'code').label).toBe('Asset');
	});
});

describe('cellTarget', () => {
	const columns = requestColumns('shot', mappingB, shotB);
	const picked = shot('shot-12', { fpt: { type: 'Shot', id: 12 } });
	const typed = shot('shot-bd-1', { source: 'breakdown' });
	const linked = shot('shot-bd-2', { source: 'breakdown', fpt: { type: 'Shot', id: 13 } });

	it('writes a live column of a row picked from Flow PT to Flow PT', () => {
		expect(cellTarget(columnByKey(columns, 'difficulty'), picked, false)).toEqual({ kind: 'fpt', type: 'Shot', id: 12, field: 'sg_complexity' });
	});

	it('keeps every cell of a breakdown row in the request, linked or not', () => {
		expect(cellTarget(columnByKey(columns, 'difficulty'), typed, false)).toEqual({ kind: 'request' });
		expect(cellTarget(columnByKey(columns, 'description'), linked, false)).toEqual({ kind: 'request' });
	});

	it('keeps a request only column in the request on every row', () => {
		expect(cellTarget(columnByKey(columns, 'notes'), picked, false)).toEqual({ kind: 'request' });
		expect(cellTarget(columnByKey(columns, 'omitted'), picked, true)).toEqual({ kind: 'request' });
	});

	it('locks a live cell of a row Flow PT no longer answers for', () => {
		expect(cellTarget(columnByKey(columns, 'difficulty'), picked, true)).toEqual({ kind: 'locked', reason: 'This Shot is gone from Flow PT, or you cannot read it.' });
	});

	it('locks the code and the Sequence, on a breakdown row too', () => {
		expect(cellTarget(columnByKey(columns, 'code'), picked, false).kind).toBe('locked');
		expect(cellTarget(columnByKey(columns, 'code'), typed, false)).toEqual({ kind: 'locked', reason: 'A breakdown row keeps the code it came with.' });
		expect(cellTarget(columnByKey(columns, 'sequence'), typed, false)).toEqual({ kind: 'locked', reason: 'A breakdown row keeps the Sequence it came with.' });
	});

	it('names an Asset in the reason', () => {
		const assetColumns = requestColumns('asset', { description: 'sg_brief', type: 'sg_asset_type', difficulty: 'sg_difficulty' }, assetB);
		const a = asset('asset-4', { fpt: { type: 'Asset', id: 4 } });
		expect(cellTarget(columnByKey(assetColumns, 'type'), a, true)).toEqual({ kind: 'locked', reason: 'This Asset is gone from Flow PT, or you cannot read it.' });
	});
});

describe('descriptionAdvice', () => {
	it('suggests a bid field when Description reads the stock description', () => {
		const advice = descriptionAdvice('shot', mappingA);
		expect(advice).toMatch(/production description/);
		expect(advice).toMatch(BID_DESCRIPTION);
	});

	it('says nothing for a bid field or an unmapped description', () => {
		expect(descriptionAdvice('shot', mappingB)).toBeNull();
		expect(descriptionAdvice('asset', { description: null })).toBeNull();
	});
});
