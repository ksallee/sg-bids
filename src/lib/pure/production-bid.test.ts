import { describe, expect, it } from 'vitest';
import { asset, shot } from './fixtures';
import { bidSavable, bidSummary, hasBidContent, MAX_BID_NAME, UNTITLED_BID, type BidEditorState } from './production-bid';

function state(extra: Partial<BidEditorState> = {}): BidEditorState {
	return {
		id: 'local-1',
		project: { id: 85, name: 'Demo Show' },
		name: ' SEQ010 ',
		shots: [shot('shot-1', { thumbnail: 'https://s3/presigned?sig=x', fpt: { type: 'Shot', id: 1 }, frames: 48 })],
		assets: [asset('asset-9', { timesUsed: 3 })],
		...extra
	};
}

describe('hasBidContent', () => {
	it('is a name or a row', () => {
		expect(hasBidContent(state({ name: '  ', shots: [], assets: [] }))).toBe(false);
		expect(hasBidContent(state({ name: 'Creature', shots: [], assets: [] }))).toBe(true);
		expect(hasBidContent(state({ name: '', assets: [] }))).toBe(true);
	});
});

describe('bidSavable', () => {
	it('gives the name, trimmed, and the rows to store', () => {
		const out = bidSavable(state());
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.name).toBe('SEQ010');
		expect(out.shots.map((s) => s.id)).toEqual(['shot-1']);
		expect(out.assets.map((a) => a.id)).toEqual(['asset-9']);
	});

	it('stores no thumbnail (a presigned URL expires, 081) and no count it makes itself', () => {
		const out = bidSavable(state());
		expect(out.ok && 'thumbnail' in out.shots[0]).toBe(false);
		expect(out.ok && 'timesUsed' in out.assets[0]).toBe(false);
	});

	it('waits for a project, then for a name or a row', () => {
		expect(bidSavable(state({ project: null }))).toEqual({ ok: false, reason: 'Pick a project to save the bid.' });
		expect(bidSavable(state({ name: '', shots: [], assets: [] }))).toEqual({ ok: false, reason: 'Name the bid or add a row to save it.' });
	});

	it('saves a bid with rows and no name as Untitled bid', () => {
		const out = bidSavable(state({ name: '   ' }));
		expect(out.ok && out.name).toBe(UNTITLED_BID);
	});

	it('refuses a name too long to store, and says how long it may be', () => {
		expect(bidSavable(state({ name: 'x'.repeat(MAX_BID_NAME + 1) }))).toEqual({ ok: false, reason: `A bid name is ${MAX_BID_NAME} characters at most.` });
		expect(bidSavable(state({ name: 'x'.repeat(MAX_BID_NAME) })).ok).toBe(true);
	});

	it('drops a package a row carried from a request: a bid has none', () => {
		const out = bidSavable(state({ shots: [shot('shot-1', { package: 'seq:SQ1' })] }));
		expect(out.ok && 'package' in out.shots[0]).toBe(false);
	});
});

describe('bidSummary', () => {
	it('counts the rows in, the omitted ones and the frames of the shots in', () => {
		const summary = bidSummary(
			[shot('a', { frames: 10 }), shot('b', { frames: 20, omitted: true }), shot('c')],
			[asset('x'), asset('y', { omitted: true })]
		);
		expect(summary).toEqual({ shots: 2, assets: 1, omitted: 2, frames: 10, shotsWithoutFrames: 1 });
	});
});
