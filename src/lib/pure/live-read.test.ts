import { describe, expect, it } from 'vitest';
import { normalizeFields } from 'sg-widgets-core';
import { SHOT_FIELDS_B } from './fixtures/schema';
import { shotRow } from './fixtures/rows';
import { shot } from './fixtures';
import { freezeShot } from './freeze';
import { liveKeys, liveItems } from './live-read';

const schema = normalizeFields(SHOT_FIELDS_B);
const mapping = { description: 'sg_brief', frames: 'sg_frame_count', sequence: 'sg_sequence', episode: 'sg_episode', type: 'sg_shot_type', difficulty: null, assets: 'assets' };
const freeze = (row: Parameters<typeof freezeShot>[0], position: number) => freezeShot(row, mapping, new Map(), position);

describe('liveKeys', () => {
	it('names the item keys a mapped field feeds, and the code', () => {
		expect([...liveKeys('shot', mapping, schema)].sort()).toEqual(['assetIds', 'code', 'description', 'episode', 'frames', 'sequence', 'type']);
		expect([...liveKeys('shot', { ...mapping, frames: 'sg_gone' }, schema)]).not.toContain('frames');
	});
});

describe('liveItems', () => {
	const keys = liveKeys('shot', mapping, schema);
	const items = [
		shot('shot-1', { code: 'SH010', fpt: { type: 'Shot', id: 1 }, description: 'Old', difficulty: 'Hero', notes: 'Matte', omitted: true }),
		shot('shot-bd-1', { code: 'SH020', source: 'breakdown', description: 'Typed' }),
		shot('shot-2', { code: 'SH030', fpt: { type: 'Shot', id: 2 }, description: 'Kept' })
	];

	it('takes each live value from Flow PT and keeps the request’s own', () => {
		const rows = [shotRow(1, { code: 'SH010', sg_brief: 'Rain at night', sg_frame_count: 96, sg_shot_type: null }, { sg_sequence: { type: 'Sequence', id: 5, name: 'SQ1' } })];
		const { items: next, gone } = liveItems(items, rows, keys, freeze);
		expect(next[0]).toEqual({
			id: 'shot-1',
			code: 'SH010',
			fpt: { type: 'Shot', id: 1 },
			description: 'Rain at night',
			frames: 96,
			sequence: 'SQ1',
			difficulty: 'Hero',
			notes: 'Matte',
			omitted: true,
			assetIds: []
		});
		expect(gone).toEqual(['shot-2']);
	});

	it('clears a live value Flow PT no longer holds', () => {
		const { items: next } = liveItems([items[0]], [shotRow(1, { code: 'SH010', sg_brief: '' })], keys, freeze);
		expect('description' in next[0]).toBe(false);
	});

	it('keeps a breakdown row as typed, and a row Flow PT did not answer for as it was, flagged', () => {
		const { items: next, gone } = liveItems(items, [], keys, freeze);
		expect(next[1]).toBe(items[1]);
		expect(next[2]).toBe(items[2]);
		expect(gone).toEqual(['shot-1', 'shot-2']);
	});

	it('answers the same items when nothing changed, so nothing is saved', () => {
		const rows = [shotRow(1, { code: 'SH010', sg_brief: 'New' }), shotRow(2, { code: 'SH030', sg_brief: 'Kept' })];
		const first = liveItems(items, rows, keys, freeze);
		const again = liveItems(first.items, rows, keys, freeze);
		expect(again.changed).toBe(false);
		expect(first.changed).toBe(true);
	});
});
