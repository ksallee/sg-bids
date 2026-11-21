import { describe, expect, it } from 'vitest';
import { asset, shot } from './fixtures';
import { codesToFind, linkPlan, matchRows, unmatched, withLinks } from './match';

const rows = [
	shot('shot-bd-1', { code: 'SH010', source: 'breakdown' }),
	shot('shot-bd-2', { code: 'sh020', source: 'breakdown' }),
	shot('shot-bd-3', { code: 'SH030', source: 'breakdown' }),
	shot('shot-bd-4', { code: 'SH040', source: 'breakdown' }),
	shot('shot-bd-5', { code: 'SH050', source: 'breakdown' }),
	shot('shot-bd-6', { code: 'SH060', source: 'breakdown', fpt: { type: 'Shot', id: 9 } }),
	shot('shot-7', { code: 'SH070', fpt: { type: 'Shot', id: 7 } })
];

describe('unmatched', () => {
	it('lists the breakdown rows with no Flow PT row, nothing else', () => {
		expect(unmatched(rows).map((r) => r.id)).toEqual(['shot-bd-1', 'shot-bd-2', 'shot-bd-3', 'shot-bd-4', 'shot-bd-5']);
		expect(unmatched([asset('asset-bd-1', { source: 'breakdown' }), asset('asset-2', { fpt: { type: 'Asset', id: 2 } })]).map((a) => a.id)).toEqual(['asset-bd-1']);
	});
});

describe('a counted row', () => {
	it('is never matched to one Flow PT row: it waits for none, and a link to it is left', () => {
		const counted = shot('shot-bd-9', { code: 'SH010', source: 'breakdown', count: 120 });
		expect(unmatched([counted])).toEqual([]);
		expect(codesToFind([counted])).toEqual([]);
		expect(withLinks([counted], [{ kind: 'shot', key: 'shot-bd-9', fpt: { type: 'Shot', id: 1 } }])).toEqual([counted]);
	});

	it('leaves out a row typed by hand with no code yet', () => {
		expect(unmatched([shot('shot-bd-10', { code: ' ', source: 'breakdown' })])).toEqual([]);
	});
});

describe('matchRows', () => {
	const candidates = [
		{ id: 101, code: 'SH010' },
		{ id: 102, code: 'SH020' },
		{ id: 103, code: 'sh030' },
		{ id: 104, code: 'SH030' },
		{ id: 105, code: 'Sh040' },
		{ id: 106, code: 'sh040' },
		{ id: 7, code: 'SH050' },
		{ id: 200, code: 'SH01' }
	];

	it('matches exactly first, then without case, never by a near code', () => {
		const out = matchRows('shot', rows, candidates);
		expect(out.map((m) => [m.code, m.state, m.state === 'exact' || m.state === 'case' ? m.fpt.id : null])).toEqual([
			['SH010', 'exact', 101],
			['sh020', 'case', 102],
			['SH030', 'exact', 104],
			['SH040', 'several', null],
			['SH050', 'taken', null]
		]);
	});

	it('names the rows several codes fit, and the row already holding the Flow PT row', () => {
		const out = matchRows('shot', rows, candidates);
		expect(out[3]).toMatchObject({ state: 'several', ids: [105, 106] });
		expect(out[4]).toMatchObject({ state: 'taken', by: 'SH070' });
	});

	it('answers none for a code Flow PT does not hold', () => {
		expect(matchRows('shot', [shot('shot-bd-9', { code: 'NEW', source: 'breakdown' })], candidates)[0]).toMatchObject({ state: 'none' });
	});

	it('does not give one Flow PT row to two rows', () => {
		const twins = [shot('shot-bd-1', { code: 'SH010', source: 'breakdown' }), shot('shot-bd-2', { code: 'sh010', source: 'breakdown' })];
		const out = matchRows('shot', twins, [{ id: 101, code: 'SH010' }]);
		expect(out.map((m) => m.state)).toEqual(['exact', 'taken']);
	});
});

describe('codesToFind and withLinks', () => {
	it('looks up each waiting code once, and links only rows still waiting', () => {
		expect(codesToFind([...rows, shot('shot-bd-8', { code: ' SH010 ', source: 'breakdown' })])).toEqual(['SH010', 'sh020', 'SH030', 'SH040', 'SH050']);
		const out = withLinks(rows, [
			{ kind: 'shot', key: 'shot-bd-1', fpt: { type: 'Shot', id: 101 } },
			{ kind: 'shot', key: 'shot-bd-6', fpt: { type: 'Shot', id: 102 } }
		]);
		expect(out[0].fpt).toEqual({ type: 'Shot', id: 101 });
		expect(out[5].fpt).toEqual({ type: 'Shot', id: 9 });
		expect(out[1]).toBe(rows[1]);
	});
});

describe('linkPlan', () => {
	it('links the rows picked that have one match, as the link call takes them', () => {
		const out = matchRows('shot', rows, [
			{ id: 101, code: 'SH010' },
			{ id: 102, code: 'SH020' }
		]);
		expect(linkPlan('shot', out, new Set(['shot-bd-1', 'shot-bd-2', 'shot-bd-3']))).toEqual([
			{ kind: 'shot', key: 'shot-bd-1', fpt: { type: 'Shot', id: 101 } },
			{ kind: 'shot', key: 'shot-bd-2', fpt: { type: 'Shot', id: 102 } }
		]);
	});
});
