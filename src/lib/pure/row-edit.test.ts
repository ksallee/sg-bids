import { describe, expect, it } from 'vitest';
import { normalizeFields } from 'sg-widgets-core';
import { SHOT_FIELDS_B } from './fixtures/schema';
import { shotRow } from './fixtures/rows';
import { shot } from './fixtures';
import { requestColumns } from './live-columns';
import { applyLocal, changesOf, itemValue, parseCell, planEdits, readBack, undoPlan, type FptWrite } from './row-edit';

const schema = normalizeFields(SHOT_FIELDS_B);
const mapping = { description: 'sg_brief', frames: 'sg_frame_count', sequence: 'sg_sequence', episode: 'sg_episode', type: 'sg_shot_type', difficulty: 'sg_complexity', assets: 'assets' };
const columns = requestColumns('shot', mapping, schema);

const items = [
	shot('shot-1', { code: 'SH010', fpt: { type: 'Shot', id: 1 }, difficulty: 'A', description: 'Rain' }),
	shot('shot-2', { code: 'SH020', fpt: { type: 'Shot', id: 2 }, difficulty: 'B' }),
	shot('shot-bd-1', { code: 'SH030', source: 'breakdown', difficulty: 'C' }),
	shot('shot-3', { code: 'SH040', fpt: { type: 'Shot', id: 3 } })
];
const none = new Set<string>();

describe('parseCell', () => {
	const by = (key: string) => columns.find((c) => c.key === key)!;

	it('trims text and stores a blank as null (field_types/text)', () => {
		expect(parseCell(by('description'), '  Rain  ')).toEqual({ value: 'Rain' });
		expect(parseCell(by('description'), '   ')).toEqual({ value: null });
		expect(parseCell(by('description'), null)).toEqual({ value: null });
	});

	it('takes a whole number in 32 bits and refuses a decimal (field_types/number)', () => {
		expect(parseCell(by('frames'), 120)).toEqual({ value: 120 });
		expect(parseCell(by('frames'), '96')).toEqual({ value: 96 });
		expect(parseCell(by('frames'), 2.5)).toEqual({ error: 'Whole numbers only.' });
		expect(parseCell(by('frames'), 2 ** 31)).toEqual({ error: 'Too large for Flow PT.' });
		expect(parseCell(by('frames'), null)).toEqual({ value: null });
	});

	it('takes a list value only as the field spells it (field_types/list)', () => {
		expect(parseCell(by('difficulty'), 'B')).toEqual({ value: 'B' });
		expect(parseCell(by('difficulty'), 'b')).toEqual({ error: 'Pick one of A, B, C, D.' });
		expect(parseCell(by('difficulty'), '')).toEqual({ value: null });
	});

	it('takes a checkbox as true or false', () => {
		expect(parseCell(by('omitted'), true)).toEqual({ value: true });
		expect(parseCell(by('omitted'), null)).toEqual({ value: false });
	});
});

describe('itemValue', () => {
	it('reads what the request shows, a blank as null', () => {
		expect(itemValue(items[0], 'difficulty')).toBe('A');
		expect(itemValue(items[3], 'description')).toBeNull();
		expect(itemValue(items[0], 'omitted')).toBe(false);
		expect(itemValue(shot('s', { episode: 'EP1', sequence: 'SQ1' }), 'sequence')).toBe('EP1 / SQ1');
	});
});

describe('planEdits', () => {
	it('sends a live column of a picked row to Flow PT, a breakdown row to the request', () => {
		const plan = planEdits(
			[
				{ itemId: 'shot-1', key: 'difficulty', value: 'D' },
				{ itemId: 'shot-bd-1', key: 'difficulty', value: 'D' }
			],
			items,
			columns,
			none
		);
		expect(plan.fpt).toEqual([{ itemId: 'shot-1', key: 'difficulty', type: 'Shot', id: 1, field: 'sg_complexity', value: 'D', before: 'A' }]);
		expect(plan.local).toEqual([{ itemId: 'shot-bd-1', key: 'difficulty', value: 'D', before: 'C' }]);
		expect(plan.refused).toEqual([]);
	});

	it('keeps a request only column in the request', () => {
		const plan = planEdits([{ itemId: 'shot-1', key: 'notes', value: 'Matte needed' }], items, columns, none);
		expect(plan.fpt).toEqual([]);
		expect(plan.local).toEqual([{ itemId: 'shot-1', key: 'notes', value: 'Matte needed', before: null }]);
	});

	it('refuses a value the field cannot take and a locked cell, each with the reason', () => {
		const plan = planEdits(
			[
				{ itemId: 'shot-1', key: 'difficulty', value: 'Hero' },
				{ itemId: 'shot-2', key: 'code', value: 'X' },
				{ itemId: 'shot-3', key: 'difficulty', value: 'A' },
				{ itemId: 'shot-9', key: 'difficulty', value: 'A' }
			],
			items,
			columns,
			new Set(['shot-3'])
		);
		expect(plan.fpt).toEqual([]);
		expect(plan.refused.map((r) => [r.itemId, r.reason])).toEqual([
			['shot-1', 'Pick one of A, B, C, D.'],
			['shot-2', 'The code names the Shot in the pipeline. Rename it in Flow PT.'],
			['shot-3', 'This Shot is gone from Flow PT, or you cannot read it.'],
			['shot-9', 'This row is no longer in the request.']
		]);
	});

	it('takes a count and a code on a row in this request only, and refuses a count that does not read or a Flow PT row', () => {
		const plan = planEdits(
			[
				{ itemId: 'shot-bd-1', key: 'count', value: '120' },
				{ itemId: 'shot-bd-1', key: 'code', value: ' SIMPLE ' },
				{ itemId: 'shot-1', key: 'count', value: 3 },
				{ itemId: 'shot-bd-1', key: 'count', value: '0' },
				{ itemId: 'shot-bd-1', key: 'count', value: '2.5' }
			],
			items,
			columns,
			none
		);
		expect(plan.local).toEqual([
			{ itemId: 'shot-bd-1', key: 'count', value: 120, before: 1 },
			{ itemId: 'shot-bd-1', key: 'code', value: 'SIMPLE', before: 'SH030' }
		]);
		expect(plan.refused.map((r) => [r.itemId, r.reason])).toEqual([
			['shot-1', 'This row is one Shot in Flow PT. Its count is 1.'],
			['shot-bd-1', 'A count is 1 at least.'],
			['shot-bd-1', 'A count is a whole number.']
		]);
	});

	it('reads a count of 1 as blank and a blank count as 1, so it writes nothing on a row of 1', () => {
		expect(planEdits([{ itemId: 'shot-bd-1', key: 'count', value: '' }], items, columns, none)).toEqual({ fpt: [], local: [], refused: [] });
		expect(itemValue(shot('x', { source: 'breakdown', count: 40 }), 'count')).toBe(40);
		expect(itemValue(items[0], 'count')).toBeNull();
	});

	it('writes nothing for a value the cell already holds', () => {
		const plan = planEdits([{ itemId: 'shot-1', key: 'difficulty', value: 'A' }], items, columns, none);
		expect(plan).toEqual({ fpt: [], local: [], refused: [] });
	});
});

describe('applyLocal', () => {
	it('sets each value on its item, and a cleared text leaves the item', () => {
		const next = applyLocal(items, [
			{ itemId: 'shot-bd-1', key: 'difficulty', value: null, before: 'C' },
			{ itemId: 'shot-1', key: 'notes', value: 'Matte', before: null },
			{ itemId: 'shot-2', key: 'omitted', value: true, before: false }
		]);
		expect('difficulty' in next[2]).toBe(false);
		expect(next[0].notes).toBe('Matte');
		expect(next[1].omitted).toBe(true);
		expect(next[3]).toBe(items[3]);
	});

	it('sets a count, and a count of 1 leaves the field off; a code goes on a shot code or an asset name', () => {
		const counted = applyLocal(items, [{ itemId: 'shot-bd-1', key: 'count', value: 120, before: 1 }]);
		expect(counted[2].count).toBe(120);
		expect('count' in applyLocal(counted, [{ itemId: 'shot-bd-1', key: 'count', value: 1, before: 120 }])[2]).toBe(false);
		expect(applyLocal(items, [{ itemId: 'shot-bd-1', key: 'code', value: 'SIMPLE', before: 'SH030' }])[2].code).toBe('SIMPLE');
		expect(applyLocal(items, [{ itemId: 'shot-bd-1', key: 'code', value: null, before: 'SH030' }])[2].code).toBe('');
		const assets = [{ id: 'asset-bd-1', name: '', source: 'breakdown' as const }];
		expect(applyLocal(assets, [{ itemId: 'asset-bd-1', key: 'code', value: 'Props', before: null }])[0]).toEqual({ id: 'asset-bd-1', name: 'Props', source: 'breakdown' });
	});
});

const write = (id: number, value: string | null, before: string | null = 'A'): FptWrite => ({ itemId: `shot-${id}`, key: 'difficulty', type: 'Shot', id, field: 'sg_complexity', value, before });

describe('readBack', () => {
	it('reads each write as landed, refused, silent or gone, by the row read back (028)', () => {
		const writes = [write(1, 'D'), write(2, 'D'), write(3, 'D'), write(4, 'D')];
		const rows = [shotRow(1, { sg_complexity: 'D' }), shotRow(2, { sg_complexity: 'B' }), shotRow(4, { sg_complexity: 'D' })];
		const outcomes = readBack(writes, new Map([[3, 'The field is not editable for this user: [Shot.sg_complexity].']]), rows);
		expect(outcomes.map((o) => o.state)).toEqual(['landed', 'silent', 'gone', 'refused']);
		expect(outcomes[1]).toEqual({ state: 'silent', now: 'B', reason: 'Flow PT answered, then still held B.' });
		expect(outcomes[2]).toEqual({ state: 'gone', reason: 'This Shot is gone from Flow PT, or you cannot read it.' });
		expect(outcomes[3]).toMatchObject({ state: 'refused', reason: 'The field is not editable for this user: [Shot.sg_complexity].' });
	});

	it('reads a cleared text as null, as the site stores it', () => {
		const outcomes = readBack([{ ...write(1, null), field: 'sg_brief', key: 'description' }], new Map(), [shotRow(1, { sg_brief: null })]);
		expect(outcomes[0]).toEqual({ state: 'landed', now: null });
	});
});

describe('changesOf and undoPlan', () => {
	const writes = [write(1, 'D', 'A'), write(2, 'D', 'B')];
	const local = [{ itemId: 'shot-bd-1', key: 'difficulty' as const, value: 'D', before: 'C' }];
	const outcomes = readBack(writes, new Map(), [shotRow(1, { sg_complexity: 'D' }), shotRow(2, { sg_complexity: 'D' })]);
	const changes = changesOf(writes, outcomes, local);

	it('keeps what landed and what changed in the request, with the value before', () => {
		expect(changes).toEqual([
			{ itemId: 'shot-1', key: 'difficulty', target: { type: 'Shot', id: 1, field: 'sg_complexity' }, before: 'A', after: 'D' },
			{ itemId: 'shot-2', key: 'difficulty', target: { type: 'Shot', id: 2, field: 'sg_complexity' }, before: 'B', after: 'D' },
			{ itemId: 'shot-bd-1', key: 'difficulty', target: null, before: 'C', after: 'D' }
		]);
	});

	it('writes the old values back where Flow PT still holds the edit', () => {
		const plan = undoPlan(changes, [shotRow(1, { sg_complexity: 'D' }), shotRow(2, { sg_complexity: 'D' })]);
		expect(plan.fpt.map((w) => [w.id, w.value, w.before])).toEqual([
			[1, 'A', 'D'],
			[2, 'B', 'D']
		]);
		expect(plan.local).toEqual([{ itemId: 'shot-bd-1', key: 'difficulty', value: 'C', before: 'D' }]);
		expect(plan.conflicts).toEqual([]);
	});

	it('leaves a value changed in Flow PT since the edit, and one gone, and says which', () => {
		const plan = undoPlan(changes, [shotRow(1, { sg_complexity: 'C' })]);
		expect(plan.fpt).toEqual([]);
		expect(plan.conflicts).toEqual([{ change: changes[0], now: 'C' }]);
		expect(plan.gone).toEqual([changes[1]]);
		expect(plan.local.length).toBe(1);
	});
});
