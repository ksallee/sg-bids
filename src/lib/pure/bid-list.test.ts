import { describe, expect, it } from 'vitest';
import { bidHref, bidListView, newRequestHref, selectionRequest, type BidListRow } from './bid-list';

const row = (id: string, projectId: number, extra: Partial<BidListRow> = {}): BidListRow => ({ id, projectId, name: `Bid ${id}`, requests: [], ...extra });
const projects = [
	{ id: 70, name: 'Big Show' },
	{ id: 91, name: 'Kids Room' }
];
const rows = [row('a', 70, { name: 'SEQ010' }), row('b', 91, { requests: [{ code: 'KR_R1' }] }), row('c', 70, { name: 'Creature' })];

describe('bidListView', () => {
	it('keeps every row in order and offers each project that holds one, with its count', () => {
		const view = bidListView(rows, projects, { project: null, query: '' });
		expect(view.rows.map((r) => [r.id, r.projectName])).toEqual([
			['a', 'Big Show'],
			['b', 'Kids Room'],
			['c', 'Big Show']
		]);
		expect(view.projectOptions).toEqual([
			{ id: 70, name: 'Big Show', count: 2 },
			{ id: 91, name: 'Kids Room', count: 1 }
		]);
		expect(view.filtered).toBe(false);
	});

	it('filters by project, ignoring a project no row holds', () => {
		expect(bidListView(rows, projects, { project: 70, query: '' }).rows.map((r) => r.id)).toEqual(['a', 'c']);
		const none = bidListView(rows, projects, { project: 5, query: '' });
		expect(none.project).toBeNull();
		expect(none.rows).toHaveLength(3);
	});

	it('searches the name, the project and the codes of the requests a bid is in', () => {
		expect(bidListView(rows, projects, { project: null, query: 'creat' }).rows.map((r) => r.id)).toEqual(['c']);
		expect(bidListView(rows, projects, { project: null, query: 'kr_r1' }).rows.map((r) => r.id)).toEqual(['b']);
		expect(bidListView(rows, projects, { project: null, query: 'big seq' }).counts).toEqual({ shown: 1, total: 3 });
	});
});

describe('selectionRequest', () => {
	it('makes a request of the ticked bids of one project, in the list’s order', () => {
		expect(selectionRequest(rows, new Set(['c', 'a']))).toEqual({ ok: true, projectId: 70, bids: ['a', 'c'] });
	});

	it('says why when nothing is ticked or the bids span projects', () => {
		expect(selectionRequest(rows, new Set())).toEqual({ ok: false, reason: 'Tick one bid or more.' });
		expect(selectionRequest(rows, new Set(['a', 'b']))).toEqual({ ok: false, reason: 'A request is made in one project. Tick bids of one project.' });
	});
});

describe('the paths', () => {
	it('open a bid in its project, and start a request with the ticked bids', () => {
		expect(bidHref({ id: 'b1', projectId: 70 })).toBe('/bids/b1?project=70');
		expect(newRequestHref({ projectId: 70, bids: ['b1', 'b2'] })).toBe('/requests/new?project=70&bids=b1,b2');
	});
});
