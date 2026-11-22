import { describe, expect, it } from 'vitest';
import { asset, shot } from './fixtures';
import type { ProductionBid, RequestPackage } from './model';
import { composeDraft } from './request-bids';

const seq: ProductionBid = { id: 'b1', name: 'SEQ010', shots: [shot('sh010', { frames: 10 }), shot('sh020')], assets: [] };
const creature: ProductionBid = { id: 'b2', name: 'Creature', shots: [shot('sh030')], assets: [asset('hero')] };

const pkg = (bid: ProductionBid, id = `bid:${bid.id}`): RequestPackage => ({ id, name: bid.name, bid: bid.id });

describe('composeDraft', () => {
	it('makes each bid a package of the request, named as it, holding its rows, in order', () => {
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
	});

	it('keeps a package key from before, so a vendor’s choice stands', () => {
		const out = composeDraft([pkg(seq, 'seq:SEQ010')], new Map([[seq.id, seq]]));
		expect(out.packages[0].id).toBe('seq:SEQ010');
		expect(out.shots.every((s) => s.package === 'seq:SEQ010')).toBe(true);
	});

	it('leaves out a package whose bid it was not given', () => {
		const out = composeDraft([pkg(seq), pkg(creature)], new Map([[seq.id, seq]]));
		expect(out.packages.map((p) => p.id)).toEqual(['bid:b1']);
	});
});
