import { describe, expect, it } from 'vitest';
import { normalizeFields } from 'sg-widgets-core';
import { SHOT_FIELDS_B } from './fixtures/schema';
import { shot } from './fixtures';
import { columnByKey, requestColumns } from './live-columns';
import { bulkConfirm, editLine, splitTargets, undoLine } from './edit-words';
import type { Change } from './row-edit';

const columns = requestColumns('shot', { description: 'sg_brief', difficulty: 'sg_complexity', sequence: 'sg_sequence' }, normalizeFields(SHOT_FIELDS_B));
const difficulty = columnByKey(columns, 'difficulty');
const notes = columnByKey(columns, 'notes');
const picked = (n: number) => Array.from({ length: n }, (_, i) => shot(`shot-${i + 1}`, { code: `SH${i + 1}`, fpt: { type: 'Shot', id: i + 1 } }));
const typed = (n: number) => Array.from({ length: n }, (_, i) => shot(`shot-bd-${i}`, { source: 'breakdown' }));

describe('splitTargets', () => {
	it('counts the rows an edit sends to Flow PT, keeps in the bid, and leaves', () => {
		const items = [...picked(3), ...typed(2)];
		expect(splitTargets(difficulty, items, new Set(['shot-1']))).toEqual({ fpt: 2, request: 2, locked: ['This Shot is gone from Flow PT, or you cannot read it.'] });
		expect(splitTargets(notes, items, new Set())).toEqual({ fpt: 0, request: 5, locked: [] });
	});
});

describe('bulkConfirm', () => {
	it('says what changes in Flow PT', () => {
		expect(bulkConfirm('shot', 'Difficulty', { fpt: 40, request: 0, locked: [] })).toEqual({ title: 'Change Difficulty on 40 rows?', lines: ['This changes Difficulty on 40 Shots in Flow PT.'] });
	});

	it('says what stays in the bid', () => {
		expect(bulkConfirm('shot', 'Note to vendors', { fpt: 0, request: 40, locked: [] }).lines).toEqual(['This changes Note to vendors on 40 rows in this request.']);
	});

	it('says both counts for a mixed selection, and the rows it leaves', () => {
		const words = bulkConfirm('shot', 'Difficulty', { fpt: 38, request: 1, locked: ['Gone.', 'Gone.'] });
		expect(words.title).toBe('Change Difficulty on 39 rows?');
		expect(words.lines).toEqual(['This changes Difficulty on 38 Shots in Flow PT and on 1 row in this request.', '2 selected rows stay as they are. Gone.']);
	});

	it('speaks of one Asset', () => {
		expect(bulkConfirm('asset', 'Type', { fpt: 1, request: 0, locked: [] }).lines).toEqual(['This changes Type on 1 Asset in Flow PT.']);
	});
});

const change = (itemId: string, fpt: boolean): Change => ({ itemId, key: 'difficulty', target: fpt ? { type: 'Shot', id: 1, field: 'sg_complexity' } : null, before: 'A', after: 'B' });
const codes = new Map([
	['shot-1', 'SH010'],
	['shot-2', 'SH020']
]);
const codeOf = (id: string) => codes.get(id) ?? id;

describe('editLine', () => {
	it('names the one row an edit changed, and where', () => {
		expect(editLine('shot', 'Difficulty', [change('shot-1', true)], codeOf)).toBe('Difficulty of SH010 changed in Flow PT.');
		expect(editLine('shot', 'Note to vendors', [change('shot-1', false)], codeOf)).toBe('Note to vendors of SH010 changed in this request.');
	});

	it('counts the rows of a bulk edit', () => {
		expect(editLine('shot', 'Difficulty', [change('shot-1', true), change('shot-2', true), change('x', false)], codeOf)).toBe('Difficulty changed on 2 Shots in Flow PT and on 1 row in this request.');
	});
});

describe('undoLine', () => {
	it('says the old values are back', () => {
		expect(undoLine({ fpt: [1], local: [], conflicts: [], gone: [] }, codeOf)).toBe('The old values are back.');
	});

	it('names the values changed in Flow PT since, and left', () => {
		const line = undoLine({ fpt: [], local: [], conflicts: [{ change: change('shot-1', true), now: 'C' }, { change: change('shot-2', true), now: null }], gone: [change('x', true)] }, codeOf);
		expect(line).toBe('2 changed in Flow PT since your edit and stay as Flow PT holds them: SH010 (now C), SH020 (now empty). 1 is gone from Flow PT.');
	});
});
