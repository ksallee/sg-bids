import { describe, expect, it } from 'vitest';
import { asset, shot } from './fixtures';
import type { ProductionBid, RequestPackage } from './model';
import { bidPackageId, composeDraft, freeNames, wentOutIn } from './request-bids';

const seq: ProductionBid = { id: 'b1', name: 'SEQ010', shots: [shot('sh010', { frames: 10 }), shot('sh020')], assets: [] };
const creature: ProductionBid = { id: 'b2', name: 'Creature', shots: [shot('sh030')], assets: [asset('hero')] };

const pkg = (bid: ProductionBid, id = bidPackageId(bid.id)): RequestPackage => ({ id, name: bid.name, bid: bid.id });

describe('freeNames', () => {
	it('keeps each name, and makes a repeat unique in any case as the issue does', () => {
		expect(freeNames(['SEQ010', 'Assets', 'assets', 'Assets'])).toEqual(['SEQ010', 'Assets', 'assets 2', 'Assets 3']);
	});

	it('steers clear of names taken already', () => {
		expect(freeNames(['Assets'], ['ASSETS'])).toEqual(['Assets 2']);
	});

	it('keeps a long name to 120 characters with its number', () => {
		const long = 'x'.repeat(120);
		const [, second] = freeNames([long, long]);
		expect(second).toHaveLength(120);
		expect(second.endsWith(' 2')).toBe(true);
	});
});

describe('composeDraft', () => {
	it('makes each bid a package of the request, named as the bid, holding its rows', () => {
		const out = composeDraft([pkg(seq), pkg(creature)], new Map([[seq.id, seq], [creature.id, creature]]));
		expect(out.packages).toEqual([
			{ id: 'bid:b1', name: 'SEQ010', bid: 'b1' },
			{ id: 'bid:b2', name: 'Creature', bid: 'b2' }
		]);
		expect(out.shots.map((s) => [s.id, s.package])).toEqual([
			['sh010', 'bid:b1'],
			['sh020', 'bid:b1'],
			['sh030', 'bid:b2']
		]);
		expect(out.assets.map((a) => [a.id, a.package])).toEqual([['hero', 'bid:b2']]);
		expect(out.overlaps).toEqual([]);
	});

	it('takes the bid’s name as it is now, made unique in the request', () => {
		const renamed = { ...creature, name: 'seq010' };
		const out = composeDraft([pkg(seq), { ...pkg(creature), name: 'Creature' }], new Map([[seq.id, seq], [creature.id, renamed]]));
		expect(out.packages.map((p) => p.name)).toEqual(['SEQ010', 'seq010 2']);
	});

	it('keeps a package key from before bids, so a vendor’s choice stands', () => {
		const out = composeDraft([pkg(seq, 'seq:SEQ010')], new Map([[seq.id, seq]]));
		expect(out.packages[0].id).toBe('seq:SEQ010');
		expect(out.shots.every((s) => s.package === 'seq:SEQ010')).toBe(true);
	});

	it('names a row in two bids, and leaves it in the first alone', () => {
		const again: ProductionBid = { id: 'b3', name: 'SEQ010 copy', shots: [shot('sh020'), shot('sh040')], assets: [] };
		const out = composeDraft([pkg(seq), pkg(again)], new Map([[seq.id, seq], [again.id, again]]));
		expect(out.overlaps).toEqual([{ kind: 'shot', key: 'sh020', code: 'SH020', bids: ['SEQ010', 'SEQ010 copy'] }]);
		expect(out.shots.map((s) => [s.id, s.package])).toEqual([
			['sh010', 'bid:b1'],
			['sh020', 'bid:b1'],
			['sh040', 'bid:b3']
		]);
	});

	it('leaves out a package whose bid it was not given', () => {
		const out = composeDraft([pkg(seq), pkg(creature)], new Map([[seq.id, seq]]));
		expect(out.packages.map((p) => p.id)).toEqual(['bid:b1']);
	});
});

describe('wentOutIn', () => {
	it('lists the requests a bid is in, issued first, newest first', () => {
		const lines = wentOutIn([
			{ id: 'r1', code: 'DS_R1', round: 1, status: 'draft', createdAt: '2026-11-20T10:00:00Z' },
			{ id: 'r2', code: 'DS_R1', round: 2, status: 'issued', createdAt: '2026-11-21T10:00:00Z' },
			{ id: 'r3', code: 'DS_R2', round: 1, status: 'awarded', createdAt: '2026-11-19T10:00:00Z' }
		]);
		expect(lines.map((l) => l.id)).toEqual(['r2', 'r3', 'r1']);
		expect(lines.map((l) => l.label)).toEqual(['DS_R1 round 2', 'DS_R2', 'DS_R1']);
	});
});
