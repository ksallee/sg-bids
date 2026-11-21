import { describe, expect, it } from 'vitest';
import { applyBreakdown, detectColumns, looksLikeHeader, parseFrames, parseTable, planBreakdown, splitTable, type BreakdownPlan, type Column, type PlanInput } from './breakdown';
import type { RequestShot } from './model';
import { asset, shot } from './fixtures';
import { ASSET_LIST, EXCEL_PASTE, NO_HEADER, REPEATS, SEMICOLON_CSV, SHEETS_CSV, WITH_ASSETS } from './fixtures/breakdowns';

function ids(prefix: string) {
	let n = 0;
	return () => `${prefix}${++n}`;
}

function plan(text: string, extra: Partial<PlanInput> = {}) {
	const table = parseTable(text);
	const kind = extra.kind ?? 'shot';
	const split = splitTable(table, kind);
	return <BreakdownPlan<RequestShot>>planBreakdown({
		kind,
		records: split.records,
		columns: detectColumns(split.header, split.records, kind),
		existing: { shots: [], assets: [] },
		duplicates: 'skip',
		addAssets: true,
		newId: (k) => (k === 'shot' ? nextShot() : nextAsset()),
		...extra
	});
}
let nextShot = ids('shot-bd-');
let nextAsset = ids('asset-bd-');

describe('parseTable', () => {
	it('reads an Excel paste: tabs, CRLF, a quoted cell with a line break, the last line break', () => {
		const t = parseTable(EXCEL_PASTE);
		expect(t.delimiter).toBe('\t');
		expect(t.records.map((r) => r.row)).toEqual([1, 2, 3, 4]);
		expect(t.records[2].cells).toEqual(['SH020', 'Two lines\nof action', '96', 'Simple', 'SQ010']);
		expect(t.width).toBe(5);
	});

	it('reads a CSV with a BOM, quoted commas, doubled quotes, and drops blank lines at the end', () => {
		const t = parseTable(SHEETS_CSV);
		expect(t.delimiter).toBe(',');
		expect(t.records[0].cells[0]).toBe('code');
		expect(t.records[1].cells).toEqual(['sh010', 'Explosion, big', 'SQ010', '1,200']);
		expect(t.records[2].cells[1]).toBe('He said "go"');
		expect(t.records.at(-1)!.row).toBe(6);
		expect(t.records).toHaveLength(6);
	});

	it('takes semicolons when a line has them and no comma or tab', () => {
		expect(parseTable(SEMICOLON_CSV).delimiter).toBe(';');
		expect(parseTable('a;b,c\n').delimiter).toBe(',');
	});

	it('keeps the spreadsheet row of each record across blank rows in the middle', () => {
		const t = parseTable('code\nA\n\n\nB\n');
		expect(t.records.map((r) => [r.row, r.cells[0]])).toEqual([
			[1, 'code'],
			[2, 'A'],
			[5, 'B']
		]);
	});

	it('reads a lone CR as a line break, and a quote in the middle of a cell as text', () => {
		const t = parseTable('a,b\rc,5" monitor\r');
		expect(t.records.map((r) => r.cells)).toEqual([
			['a', 'b'],
			['c', '5" monitor']
		]);
	});

	it('answers no records for blank text', () => {
		expect(parseTable('﻿ \r\n\r\n').records).toEqual([]);
	});
});

describe('parseFrames', () => {
	it('reads whole counts with thousands separators of any locale', () => {
		for (const [text, frames] of [
			['96', 96],
			[' 48 ', 48],
			['1,234', 1234],
			['1.234', 1234],
			['1 234', 1234],
			['1 234', 1234],
			["1'234", 1234],
			['1,234,567', 1234567],
			['24.0', 24],
			['24,00', 24]
		] as const) {
			expect(parseFrames(text), text).toEqual({ kind: 'frames', frames });
		}
	});

	it('says what is wrong with a count it cannot read', () => {
		expect(parseFrames('')).toEqual({ kind: 'blank' });
		expect(parseFrames('12a')).toEqual({ kind: 'error', message: '"12a" is not a number of frames.' });
		expect(parseFrames('12.5')).toEqual({ kind: 'error', message: '"12.5" is not a whole number of frames.' });
		expect(parseFrames('-4')).toEqual({ kind: 'error', message: '"-4" is below zero.' });
		expect(parseFrames('00:00:04:12')).toEqual({ kind: 'error', message: '"00:00:04:12" is a timecode. Give the count in frames.' });
		expect(parseFrames('1,23')).toEqual({ kind: 'error', message: '"1,23" is not a whole number of frames.' });
	});
});

describe('header and columns', () => {
	it('takes a first row with known names as the header', () => {
		expect(looksLikeHeader(['Shot', 'Description', 'Frames'], 'shot')).toBe(true);
		expect(looksLikeHeader(['SH010', 'Car crash', '96'], 'shot')).toBe(false);
		expect(looksLikeHeader(['VFX ID', 'Action', 'Linked Assets'], 'shot')).toBe(true);
	});

	it('matches columns by header name, each column once', () => {
		const t = splitTable(parseTable(WITH_ASSETS), 'shot');
		expect(detectColumns(t.header, t.records, 'shot')).toEqual(['code', 'description', 'assets', 'frames', 'episode', 'scene', 'type', 'notes']);
		const e = splitTable(parseTable(EXCEL_PASTE), 'shot');
		expect(detectColumns(e.header, e.records, 'shot')).toEqual(['code', 'description', 'frames', 'difficulty', 'sequence']);
	});

	it('leaves an unknown header unmatched, and offers only what an asset has', () => {
		const t = splitTable(parseTable(SEMICOLON_CSV), 'shot');
		expect(detectColumns(t.header, t.records, 'shot')).toEqual(['code', null, 'frames']);
		const a = splitTable(parseTable(ASSET_LIST), 'asset');
		expect(detectColumns(a.header, a.records, 'asset')).toEqual(['code', 'type', 'difficulty', 'description']);
		const s = splitTable(parseTable(WITH_ASSETS), 'asset');
		expect(detectColumns(s.header, s.records, 'asset')).toEqual(['code', 'description', null, null, null, null, 'type', 'notes']);
	});

	it('with no header, reads the code first, then a description, then a column of whole numbers as frames', () => {
		const t = splitTable(parseTable(NO_HEADER), 'shot');
		expect(t.header).toBeNull();
		expect(detectColumns(t.header, t.records, 'shot')).toEqual(['code', 'description']);
		const n = splitTable(parseTable('SH1\tA wide\tSQ1\t96\nSH2\tA close\tSQ1\t1,200\n'), 'shot');
		expect(detectColumns(n.header, n.records, 'shot')).toEqual(['code', 'description', null, 'frames']);
	});
});

describe('planBreakdown', () => {
	it('makes a breakdown row per record, with the mapped fields and no Flow PT row', () => {
		nextShot = ids('shot-bd-');
		const p = plan(EXCEL_PASTE);
		expect(p.add).toEqual([
			{ id: 'shot-bd-1', code: 'SH010', source: 'breakdown', omitted: false, assetIds: [], description: 'Car crash, wide', frames: 1234, difficulty: 'Complex', sequence: 'SQ010' },
			{ id: 'shot-bd-2', code: 'SH020', source: 'breakdown', omitted: false, assetIds: [], description: 'Two lines\nof action', frames: 96, difficulty: 'Simple', sequence: 'SQ010' },
			{ id: 'shot-bd-3', code: 'SH030', source: 'breakdown', omitted: false, assetIds: [], description: 'Sky replacement', frames: 48, difficulty: 'Moderate', sequence: 'SQ020' }
		]);
		expect(p.issues).toEqual([]);
		expect(p.ready).toBe(true);
	});

	it('names a blank code and a bad number by row: the first is left out, the second keeps its row with no count', () => {
		const p = plan(SHEETS_CSV);
		expect(p.add.map((s) => [s.code, s.frames])).toEqual([
			['sh010', 1200],
			['sh020', 96],
			['sh030', undefined],
			['sh040', undefined]
		]);
		expect(p.issues).toEqual([
			{ row: 4, level: 'error', message: 'Row 4 has no code. It is left out.' },
			{ row: 5, level: 'warning', code: 'sh030', message: 'Row 5, sh030: "12a" is not a number of frames. Frames left blank.' },
			{ row: 6, level: 'warning', code: 'sh040', message: 'Row 6, sh040: "12.5" is not a whole number of frames. Frames left blank.' }
		]);
	});

	it('cannot go without a code column', () => {
		const t = splitTable(parseTable(EXCEL_PASTE), 'shot');
		const p = planBreakdown({ kind: 'shot', records: t.records, columns: [null, 'description', 'frames', null, null], existing: { shots: [], assets: [] }, duplicates: 'skip', addAssets: true, newId: () => 'x' });
		expect(p.ready).toBe(false);
		expect(p.add).toEqual([]);
		expect(p.issues[0]).toEqual({ row: 0, level: 'error', message: 'Pick the column that holds the code.' });
	});

	it('refuses the same column twice', () => {
		const t = splitTable(parseTable(EXCEL_PASTE), 'shot');
		const p = planBreakdown({ kind: 'shot', records: t.records, columns: ['code', 'description', 'description', null, null], existing: { shots: [], assets: [] }, duplicates: 'skip', addAssets: true, newId: () => 'x' });
		expect(p.ready).toBe(false);
		expect(p.issues[0].message).toBe('Description is picked for two columns. Pick it once.');
	});

	describe('a code already in the bid or repeated in the paste', () => {
		const existing = { shots: [shot('shot-55', { code: 'SH010', fpt: { type: 'Shot', id: 55 }, description: 'From Flow PT', frames: 10, notes: 'keep' })], assets: [] };

		it('skips them, named by row, when the choice is skip', () => {
			nextShot = ids('shot-bd-');
			const p = plan(REPEATS, { existing, duplicates: 'skip' });
			expect(p.add.map((s) => s.code)).toEqual(['SH500']);
			expect(p.replace).toEqual([]);
			expect(p.duplicates).toEqual([
				{ row: 2, code: 'SH010', matches: 'in the bid' },
				{ row: 4, code: 'sh500', matches: 'row 3' }
			]);
		});

		it('replaces the earlier one, keeping its id and Flow PT row, when the choice is replace', () => {
			nextShot = ids('shot-bd-');
			const p = plan(REPEATS, { existing, duplicates: 'replace' });
			expect(p.replace).toEqual([{ row: 2, id: 'shot-55', item: { ...existing.shots[0], code: 'SH010', description: 'First take' } }]);
			expect(p.add).toEqual([{ id: 'shot-bd-1', code: 'sh500', source: 'breakdown', omitted: false, assetIds: [], description: 'Again' }]);
		});

		it('keeps both when the choice is both', () => {
			nextShot = ids('shot-bd-');
			const p = plan(REPEATS, { existing, duplicates: 'both' });
			expect(p.add.map((s) => [s.id, s.code])).toEqual([
				['shot-bd-1', 'SH010'],
				['shot-bd-2', 'SH500'],
				['shot-bd-3', 'sh500']
			]);
			expect(p.duplicates).toHaveLength(2);
		});
	});

	it('links the assets a shot names, adding those the bid lacks, and names a count it cannot read', () => {
		nextShot = ids('shot-bd-');
		nextAsset = ids('asset-bd-');
		const existing = { shots: [], assets: [asset('asset-9', { name: 'Castle', fpt: { type: 'Asset', id: 9 } })] };
		const p = plan(WITH_ASSETS, { existing });
		expect(p.assetsToAdd).toEqual([
			{ id: 'asset-bd-1', name: 'Dragon', source: 'breakdown', omitted: false },
			{ id: 'asset-bd-2', name: 'Banner', source: 'breakdown', omitted: false }
		]);
		expect(p.add[0]).toMatchObject({ code: 'ep01_sh010', assetIds: ['asset-bd-1', 'asset-9'], frames: 120, episode: 'EP01', scene: '12', type: 'CG creature', notes: 'Hero shot' });
		expect(p.add[1]).toMatchObject({ code: 'ep01_sh020', assetIds: ['asset-9', 'asset-bd-2'], scene: '12A' });
		expect(p.add[1]).not.toHaveProperty('frames');
		expect(p.add[1]).not.toHaveProperty('notes');
		expect(p.issues).toEqual([{ row: 3, level: 'warning', code: 'ep01_sh020', message: 'Row 3, ep01_sh020: "00:00:04:12" is a timecode. Give the count in frames. Frames left blank.' }]);
	});

	it('names the assets it does not add when asked not to', () => {
		const p = plan(WITH_ASSETS, { addAssets: false });
		expect(p.assetsToAdd).toEqual([]);
		expect(p.add[0].assetIds).toEqual([]);
		expect(p.issues.filter((i) => i.message.includes('not in the bid')).map((i) => i.message)).toEqual([
			'Row 2, ep01_sh010: Dragon and Castle are not in the bid. Not linked.',
			'Row 3, ep01_sh020: castle and Banner are not in the bid. Not linked.'
		]);
	});

	it('makes assets from an asset list', () => {
		nextAsset = ids('asset-bd-');
		const p = plan(ASSET_LIST, { kind: 'asset' });
		expect(p.add).toEqual([
			{ id: 'asset-bd-1', name: 'Dragon', source: 'breakdown', omitted: false, type: 'Character', difficulty: 'Hero', description: 'The big one' },
			{ id: 'asset-bd-2', name: 'Banner', source: 'breakdown', omitted: false, type: 'Prop', difficulty: 'Simple' }
		]);
	});

	it('caps a code at 200 characters, named by row', () => {
		const p = plan(`code\n${'x'.repeat(201)}\nok\n`);
		expect(p.add.map((s) => s.code)).toEqual(['ok']);
		expect(p.issues[0]).toEqual({ row: 2, level: 'error', message: 'Row 2: the code is longer than 200 characters. It is left out.' });
	});
});

describe('applyBreakdown', () => {
	it('adds after what is there, replaces in place, and adds the named assets', () => {
		nextShot = ids('shot-bd-');
		nextAsset = ids('asset-bd-');
		const existing = { shots: [shot('shot-55', { code: 'SH010', fpt: { type: 'Shot', id: 55 } }), shot('shot-56', { code: 'SH020' })], assets: [] };
		const p = plan('code,description,assets\nSH010,Replaced,Rock\nSH600,New,\n', { existing, duplicates: 'replace' });
		const out = applyBreakdown(existing, p, 'shot');
		expect(out.shots.map((s) => [s.id, s.code, s.description ?? null])).toEqual([
			['shot-55', 'SH010', 'Replaced'],
			['shot-56', 'SH020', null],
			['shot-bd-1', 'SH600', 'New']
		]);
		expect(out.shots[0].fpt).toEqual({ type: 'Shot', id: 55 });
		expect(out.shots[0].assetIds).toEqual(['asset-bd-1']);
		expect(out.assets).toEqual([{ id: 'asset-bd-1', name: 'Rock', source: 'breakdown', omitted: false }]);
	});

	it('with a blank mapped cell, a replace clears that field and keeps the unmapped ones', () => {
		const existing = { shots: [shot('shot-55', { code: 'SH010', description: 'Old', notes: 'Keep me' })], assets: [] };
		const p = plan('code,description\nSH010,\n', { existing, duplicates: 'replace' });
		const out = applyBreakdown(existing, p, 'shot');
		expect(out.shots[0]).toEqual(shot('shot-55', { code: 'SH010', notes: 'Keep me' }));
	});
});

describe('the column list', () => {
	it('offers every field the issue names for a shot', () => {
		const t = splitTable(parseTable('code,description,sequence,episode,scene,frames,difficulty,type,linked assets,notes\n'), 'shot');
		const cols: (Column | null)[] = detectColumns(t.header, t.records, 'shot');
		expect(cols).toEqual(['code', 'description', 'sequence', 'episode', 'scene', 'frames', 'difficulty', 'type', 'assets', 'notes']);
	});
});
