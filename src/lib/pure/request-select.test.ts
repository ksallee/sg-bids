import { describe, expect, it } from 'vitest';
import type { DeletionFacts } from './request-delete';
import {
	bulkDeletePlan,
	copies,
	DELETE_WORD,
	headerState,
	NOTHING,
	picked,
	press,
	pressAll,
	prune,
	resultLine,
	splitDelete,
	wordMatches,
	type Selection
} from './request-select';

const shown = ['a', 'b', 'c', 'd', 'e'];
const sel = (ids: string[], anchor: string | null = null): Selection => ({ selected: new Set(ids), anchor });
const ids = (s: Selection) => [...s.selected].sort();

const facts = (extra: Partial<DeletionFacts> = {}): DeletionFacts => ({
	id: 'r1',
	code: 'BR-1',
	title: 'Rooftop',
	round: 1,
	status: 'draft',
	shots: 4,
	assets: 1,
	invitations: 0,
	bids: 0,
	vendors: [],
	scenarios: 0,
	rates: 0,
	award: null,
	...extra
});

describe('press', () => {
	it('ticks one row and makes it the anchor', () => {
		const next = press(NOTHING, 'b', shown, false);
		expect(ids(next)).toEqual(['b']);
		expect(next.anchor).toBe('b');
	});

	it('unticks a ticked row', () => {
		expect(ids(press(sel(['b', 'c'], 'c'), 'b', shown, false))).toEqual(['c']);
	});

	it('with Shift, gives the range from the anchor the state the pressed row takes', () => {
		expect(ids(press(sel(['b'], 'b'), 'd', shown, true))).toEqual(['b', 'c', 'd']);
		expect(ids(press(sel(['d'], 'd'), 'b', shown, true))).toEqual(['b', 'c', 'd']);
	});

	it('with Shift, unticks the range when the pressed row was ticked', () => {
		expect(ids(press(sel(['a', 'b', 'c', 'd'], 'a'), 'c', shown, true))).toEqual(['d']);
	});

	it('with Shift and no anchor, ticks the one row', () => {
		expect(ids(press(NOTHING, 'c', shown, true))).toEqual(['c']);
	});

	it('with Shift and an anchor no longer shown, ticks the one row', () => {
		expect(ids(press(sel([], 'z'), 'c', shown, true))).toEqual(['c']);
	});
});

describe('headerState and pressAll', () => {
	it('says none, some or all of the rows shown', () => {
		expect(headerState(NOTHING, shown)).toBe('none');
		expect(headerState(sel(['a']), shown)).toBe('some');
		expect(headerState(sel(shown), shown)).toBe('all');
	});

	it('says none when nothing is shown', () => {
		expect(headerState(sel(['a']), [])).toBe('none');
	});

	it('ticks every row shown, then none', () => {
		const all = pressAll(sel(['b'], 'b'), shown);
		expect(ids(all)).toEqual(shown);
		expect(ids(pressAll(all, shown))).toEqual([]);
	});

	it('ticks only the rows the filters show', () => {
		expect(ids(pressAll(NOTHING, ['b', 'd']))).toEqual(['b', 'd']);
	});
});

describe('prune', () => {
	it('drops the rows no longer shown, and their anchor', () => {
		const next = prune(sel(['a', 'c', 'e'], 'e'), ['a', 'b', 'c']);
		expect(ids(next)).toEqual(['a', 'c']);
		expect(next.anchor).toBeNull();
	});

	it('answers the same selection when every row is still shown', () => {
		const same = sel(['a', 'c'], 'c');
		expect(prune(same, shown)).toBe(same);
	});
});

describe('picked', () => {
	it('answers the ticked rows in the order shown', () => {
		const rows = shown.map((id) => ({ id }));
		expect(picked(rows, sel(['d', 'a'])).map((r) => r.id)).toEqual(['a', 'd']);
	});
});

describe('splitDelete', () => {
	it('splits drafts, requests sent to vendors and the ones that cannot go', () => {
		const split = splitDelete([
			{ facts: facts({ id: 'd1', title: 'Rooftop' }) },
			{ facts: facts({ id: 'i1', title: 'Beach', status: 'issued', round: 2 }) },
			{ facts: facts({ id: 'c1', title: 'Night', status: 'closed' }) },
			{ facts: facts({ id: 'w1', title: 'Harbour', status: 'issued', award: 'published' }) },
			{ facts: facts({ id: 'w2', title: 'Tunnel', status: 'awarded' }) },
			{ id: 'x1', name: 'Gone', reason: 'The request is not there.' }
		]);
		expect(split.drafts.map((f) => f.id)).toEqual(['d1']);
		expect(split.sent.map((f) => f.id)).toEqual(['i1', 'c1']);
		expect(split.skipped).toEqual([
			{ id: 'w1', name: 'Harbour', reason: 'The award is in Flow PT. Undo the award first.' },
			{ id: 'w2', name: 'Tunnel', reason: 'The award is in Flow PT. Undo the award first.' },
			{ id: 'x1', name: 'Gone', reason: 'The request is not there.' }
		]);
	});
});

describe('bulkDeletePlan', () => {
	it('asks once for drafts alone, naming them', () => {
		const plan = bulkDeletePlan(splitDelete([{ facts: facts({ title: 'Rooftop' }) }, { facts: facts({ id: 'r2', title: 'Beach', invitations: 2 }) }]));
		expect(plan).toEqual({
			title: 'Delete 2 drafts?',
			lines: ['2 drafts: Rooftop and Beach.', '2 invitations. Their links stop working.'],
			skipped: [],
			typed: false,
			confirm: 'Delete 2 drafts'
		});
	});

	it('asks for the word when a request sent to vendors is in it, and names what goes', () => {
		const plan = bulkDeletePlan(
			splitDelete([
				{ facts: facts({ title: 'Rooftop' }) },
				{ facts: facts({ id: 'i1', title: 'Beach', status: 'issued', round: 2, invitations: 3, bids: 2, vendors: ['A', 'B'], scenarios: 1, rates: 1 }) },
				{ facts: facts({ id: 'w1', title: 'Harbour', status: 'issued', award: 'published' }) }
			])
		);
		expect(plan).toEqual({
			title: 'Delete 2 requests?',
			lines: ['1 draft: Rooftop.', '1 request sent to vendors: Beach (round 2).', '3 invitations. Their links stop working.', '2 submitted bids.', '1 award scenario.', '1 exchange rate.'],
			skipped: ['Harbour is skipped. The award is in Flow PT. Undo the award first.'],
			typed: true,
			confirm: 'Delete 2 requests'
		});
	});

	it('offers no delete when every request is skipped', () => {
		const plan = bulkDeletePlan(splitDelete([{ facts: facts({ title: 'Harbour', status: 'issued', award: 'partial' }) }, { facts: facts({ id: 'w2', title: 'Tunnel', status: 'awarded' }) }]));
		expect(plan.title).toBe('Nothing here can be deleted yet');
		expect(plan.confirm).toBeNull();
		expect(plan.skipped).toEqual(['Harbour and Tunnel are skipped. The award is in Flow PT. Undo the award first.']);
	});
});

describe('wordMatches', () => {
	it('takes the word, spaces and case aside', () => {
		expect(DELETE_WORD).toBe('delete');
		expect(wordMatches(' Delete ')).toBe(true);
		expect(wordMatches('delet')).toBe(false);
		expect(wordMatches('')).toBe(false);
	});
});

describe('copies', () => {
	it('names each copy after its request, title else code', () => {
		expect(copies([{ id: 'a', projectId: 7, title: 'Rooftop', code: 'BR-1' }, { id: 'b', projectId: 8, title: null, code: 'BR-2' }])).toEqual([
			{ id: 'a', projectId: 7, name: 'Rooftop', copy: 'Rooftop copy' },
			{ id: 'b', projectId: 8, name: 'BR-2', copy: 'BR-2 copy' }
		]);
	});
});

describe('resultLine', () => {
	it('counts what went', () => {
		expect(resultLine('delete', { went: 3, missed: [] })).toBe('Deleted 3 requests.');
		expect(resultLine('delete', { went: 1, missed: [] })).toBe('Deleted 1 request.');
		expect(resultLine('duplicate', { went: 2, missed: [] })).toBe('Made 2 draft copies.');
		expect(resultLine('duplicate', { went: 1, missed: [] })).toBe('Made 1 draft copy.');
	});

	it('names what did not go, grouped by reason', () => {
		const missed = [
			{ id: '1', name: 'Harbour', reason: 'The award is in Flow PT. Undo the award first.' },
			{ id: '2', name: 'Night', reason: 'The app could not reach its server.' },
			{ id: '3', name: 'Tunnel', reason: 'The award is in Flow PT. Undo the award first.' }
		];
		expect(resultLine('delete', { went: 2, missed })).toBe(
			'Deleted 2 requests. Harbour and Tunnel were not deleted. The award is in Flow PT. Undo the award first. Night was not deleted. The app could not reach its server.'
		);
	});

	it('says nothing went, and ends a reason with a stop', () => {
		expect(resultLine('duplicate', { went: 0, missed: [{ id: '1', name: 'Beach', reason: 'The server failed' }] })).toBe('Nothing duplicated. Beach was not duplicated. The server failed.');
	});
});
