import { describe, expect, it } from 'vitest';
import { asset, bid, line, onShot, request, shot } from './fixtures';
import { money } from './money';
import { groupItems, groupings, itemMatches, vendorBidView, vendorRequestView } from './vendor-view';

describe('vendorRequestView', () => {
	const req = request({
		id: 'req-uuid',
		header: { project: 'Show', projectRef: { type: 'Project', id: 70 }, round: 1, baseCurrency: 'USD', assumptions: ['4K'] },
		shots: [shot('sh010', { fpt: { type: 'Shot', id: 1234 }, sequence: 'SQ1', frames: 96 })],
		assets: [asset('hero', { fpt: { type: 'Asset', id: 55 } })],
		vendors: [{ id: 'inv-a', name: 'Vendor A', email: 'a@example.com', ndaExecuted: true, fpt: { type: 'Group', id: 7 } }]
	});

	it('keeps what the vendor bids on, and drops every vendor, id and Flow PT ref', () => {
		const view = vendorRequestView({ request: req, code: 'BR-1', status: 'issued', issuedAt: '2026-11-20T10:00:00Z', expiresAt: '2027-01-19T10:00:00Z' });
		expect(view).toEqual({
			code: 'BR-1',
			status: 'issued',
			issuedAt: '2026-11-20T10:00:00Z',
			expiresAt: '2027-01-19T10:00:00Z',
			header: { project: 'Show', round: 1, baseCurrency: 'USD', assumptions: ['4K'] },
			shots: [{ id: 'sh010', code: 'SH010', omitted: false, assetIds: [], sequence: 'SQ1', frames: 96 }],
			assets: [{ id: 'hero', name: 'hero' }]
		});
		const text = JSON.stringify(view);
		for (const secret of ['inv-a', 'Vendor A', 'a@example.com', 'req-uuid', '1234', '"vendors"']) expect(text).not.toContain(secret);
	});
});

describe('vendorBidView', () => {
	const v1 = bid({ id: 'b1', vendorId: 'inv-a', requestId: 'req-uuid', currency: 'USD', status: 'submitted', lines: [line('l1', onShot('sh010'), money(100, 'USD'))] });
	const v2 = bid({ id: 'b2', vendorId: 'inv-a', requestId: 'req-uuid', currency: 'USD', status: 'draft' });

	it('answers the latest version, with every version listed, and no vendor or request id', () => {
		const view = vendorBidView([
			{ bid: v1, version: 1, submittedAt: '2026-11-21T10:00:00Z', withdrawnAt: null },
			{ bid: v2, version: 2, submittedAt: null, withdrawnAt: null }
		]);
		expect(view.bid?.id).toBe('b2');
		expect(view.bid?.version).toBe(2);
		expect(view.versions).toEqual([
			{ id: 'b1', version: 1, status: 'submitted', submittedAt: '2026-11-21T10:00:00Z', withdrawnAt: null },
			{ id: 'b2', version: 2, status: 'draft', submittedAt: null, withdrawnAt: null }
		]);
		const text = JSON.stringify(view);
		expect(text).not.toContain('inv-a');
		expect(text).not.toContain('req-uuid');
	});

	it('answers no bid before the first save', () => {
		expect(vendorBidView([])).toEqual({ bid: null, versions: [] });
	});
});

describe('groupings', () => {
	it('offers episode and sequence when shots carry them', () => {
		expect(groupings([shot('a', { sequence: 'SQ1' }), shot('b')])).toEqual(['sequence']);
		expect(groupings([shot('a', { sequence: 'SQ1', episode: 'E1' })])).toEqual(['episode', 'sequence']);
		expect(groupings([shot('a')])).toEqual([]);
	});
});

describe('groupItems', () => {
	const shots = [shot('a', { sequence: 'SQ2' }), shot('b', { sequence: 'SQ1' }), shot('c'), shot('d', { sequence: 'SQ2' })];

	it('groups in the order groups first appear, the shots without one last', () => {
		expect(groupItems(shots, 'sequence')).toEqual([
			{ label: 'SQ2', ids: ['a', 'd'] },
			{ label: 'SQ1', ids: ['b'] },
			{ label: 'No sequence', ids: ['c'] }
		]);
	});

	it('is one group of everything with no grouping', () => {
		expect(groupItems(shots, null)).toEqual([{ label: null, ids: ['a', 'b', 'c', 'd'] }]);
	});
});

describe('itemMatches', () => {
	it('finds the words in code, name, description, sequence, episode or type, any case', () => {
		const s = shot('sh010', { description: 'Hero jumps the gap', sequence: 'Rooftop', type: 'CG' });
		expect(itemMatches(s, '')).toBe(true);
		expect(itemMatches(s, 'sh01')).toBe(true);
		expect(itemMatches(s, 'roof jump')).toBe(true);
		expect(itemMatches(s, 'cg')).toBe(true);
		expect(itemMatches(s, 'water')).toBe(false);
		expect(itemMatches(asset('hero', { name: 'Hero Suit' }), 'suit')).toBe(true);
	});
});
