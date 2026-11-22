import { describe, expect, it } from 'vitest';
import { shot } from './fixtures';
import { bySource, hasBothSources, rowSource } from './row-source';

const fpt = shot('shot-1001', { fpt: { type: 'Shot', id: 1001 } });
const pasted = shot('shot-bd-1', { source: 'breakdown' });
const linked = shot('shot-bd-2', { source: 'breakdown', fpt: { type: 'Shot', id: 1002 } });

describe('rowSource', () => {
	it('names where a row comes from: Flow PT, a breakdown, or a breakdown linked to Flow PT', () => {
		expect(rowSource(fpt)).toBe('fpt');
		expect(rowSource(pasted)).toBe('breakdown');
		expect(rowSource(linked)).toBe('linked');
	});
});

describe('bySource', () => {
	const items = [fpt, pasted, linked];

	it('keeps every row for All, the Flow PT rows, or the breakdown rows linked or not', () => {
		expect(bySource(items, 'all')).toBe(items);
		expect(bySource(items, 'fpt').map((i) => i.id)).toEqual(['shot-1001']);
		expect(bySource(items, 'breakdown').map((i) => i.id)).toEqual(['shot-bd-1', 'shot-bd-2']);
	});
});

describe('hasBothSources', () => {
	it('is true only when the request holds rows of both kinds', () => {
		expect(hasBothSources([fpt, pasted])).toBe(true);
		expect(hasBothSources([fpt, linked])).toBe(true);
		expect(hasBothSources([fpt])).toBe(false);
		expect(hasBothSources([pasted, linked])).toBe(false);
		expect(hasBothSources([])).toBe(false);
	});
});
