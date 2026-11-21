import { describe, expect, it } from 'vitest';
import { listTotals } from './list-totals';

const requests = [
	{ id: 'd', status: 'draft' as const },
	{ id: 'i', status: 'issued' as const },
	{ id: 'e', status: 'closed' as const }
];

describe('listTotals', () => {
	it('names each request’s bids in order', () => {
		const totals = listTotals(requests, {
			packages: [
				{ request_id: 'd', name: 'Creature', position: 1 },
				{ request_id: 'i', name: 'Only', position: 0 },
				{ request_id: 'd', name: 'Seq A', position: 0 }
			],
			draftBids: [],
			items: []
		});
		expect(totals.get('d')?.bids).toEqual(['Seq A', 'Creature']);
		expect(totals.get('i')?.bids).toEqual(['Only']);
		expect(totals.get('e')).toEqual({ bids: [], shots: 0, assets: 0 });
	});

	it('adds a draft’s bids, as the database keeps them: units, omitted rows left out', () => {
		const totals = listTotals(requests, {
			packages: [],
			draftBids: [
				{ request_id: 'd', shot_count: 124, asset_count: 1 },
				{ request_id: 'd', shot_count: 3, asset_count: 0 },
				{ request_id: 'i', shot_count: 99, asset_count: 99 }
			],
			items: []
		});
		expect(totals.get('d')).toMatchObject({ shots: 127, assets: 1 });
		expect(totals.get('i')).toMatchObject({ shots: 0, assets: 0 });
	});

	it('counts an issued request’s rows by unit, and leaves omitted rows out', () => {
		const totals = listTotals(requests, {
			packages: [],
			draftBids: [],
			items: [
				{ request_id: 'i', kind: 'shot', unit_count: 120, omitted: false },
				{ request_id: 'i', kind: 'shot', unit_count: 1, omitted: false },
				{ request_id: 'i', kind: 'shot', unit_count: 40, omitted: true },
				{ request_id: 'i', kind: 'asset', unit_count: 2, omitted: false },
				{ request_id: 'e', kind: 'asset', unit_count: null, omitted: false },
				{ request_id: 'd', kind: 'shot', unit_count: 5, omitted: false }
			]
		});
		expect(totals.get('i')).toMatchObject({ shots: 121, assets: 2 });
		expect(totals.get('e')).toMatchObject({ shots: 0, assets: 1 });
		expect(totals.get('d')).toMatchObject({ shots: 0, assets: 0 });
	});
});
