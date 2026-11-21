import { describe, expect, it } from 'vitest';
import { asset, shot } from './fixtures';
import { emptyHeaderForm, type HeaderForm } from './header';
import { controlId, foldOf, readiness } from './readiness';
import type { BuilderState } from './request';

const TODAY = '2026-11-20';
const form: HeaderForm = { ...emptyHeaderForm('GBP'), code: 'DS-01', title: 'Main bid' };

function state(extra: Partial<BuilderState> = {}): BuilderState {
	return { id: 'draft-1', project: { id: 85, name: 'Demo Show' }, form, shots: [shot('shot-1')], assets: [], ...extra };
}

describe('readiness', () => {
	it('is ready with a title, a code, a round, a currency and one item in', () => {
		const r = readiness({ state: state(), today: TODAY });
		expect(r.problems).toEqual([]);
		expect(r.toIssue).toEqual([]);
		expect(r.canSave).toBe(true);
		expect(r.canIssue).toBe(true);
	});

	it('names every problem with its field, in the order of the page', () => {
		const r = readiness({ state: state({ form: { ...form, title: '', materialLink: 'nope' }, shots: [] }), today: TODAY });
		expect(r.problems.map((p) => [p.target, p.label, p.short])).toEqual([
			['title', 'Title', 'missing'],
			['materialLink', 'Bid material', 'not a web link'],
			['items', 'Shots and assets', 'none picked']
		]);
		expect(r.problems[2].message).toBe('Pick at least one shot or asset.');
		expect(r.canIssue).toBe(false);
	});

	it('never counts without naming: every problem has a label, a short and a message', () => {
		const r = readiness({ state: state({ project: null, form: { ...emptyHeaderForm(), round: 'x', baseCurrency: '' }, shots: [] }), today: TODAY });
		for (const p of r.problems) {
			expect(p.label).not.toBe('');
			expect(p.short).not.toBe('');
			expect(p.message).not.toBe('');
		}
		expect(r.problems.map((p) => p.target)).toEqual(['project', 'title', 'code', 'round', 'baseCurrency', 'items']);
	});

	it('blocks saving on nothing but a project', () => {
		expect(readiness({ state: state({ form: emptyHeaderForm(), shots: [] }), today: TODAY }).canSave).toBe(true);
		expect(readiness({ state: state({ project: null }), today: TODAY }).canSave).toBe(false);
	});

	it('warns on a past due date while drafting and blocks the issue on it', () => {
		const r = readiness({ state: state({ form: { ...form, dueDate: '2026-11-01' } }), today: TODAY });
		expect(r.problems).toEqual([
			{ id: 'dueDate', target: 'dueDate', label: 'Bids due', tone: 'warning', missing: false, short: 'the day has passed', message: 'The bids due day has passed. Move it before you issue.' }
		]);
		expect(r.toIssue.map((p) => [p.target, p.tone])).toEqual([['dueDate', 'error']]);
		expect(r.canIssue).toBe(false);
	});

	it('wants one item still in', () => {
		const r = readiness({ state: state({ shots: [shot('s', { omitted: true })], assets: [asset('a', { omitted: true })] }), today: TODAY });
		expect(r.problems.map((p) => [p.target, p.short, p.message])).toEqual([['items', 'every one is omitted', 'Every picked item is omitted. Bring one back.']]);
	});

	it('refuses a code another request of the project uses in the same round', () => {
		const others = [
			{ id: 'other', code: 'DS-01', round: 1 },
			{ id: 'draft-1', code: 'DS-02', round: 1 }
		];
		const r = readiness({ state: state(), today: TODAY, others });
		expect(r.problems.map((p) => [p.target, p.short, p.message])).toEqual([
			['code', 'used by another request', 'Another request in this project has the code DS-01 in round 1. Change the code.']
		]);
		expect(readiness({ state: state({ form: { ...form, round: '2' } }), today: TODAY, others }).problems).toEqual([]);
		expect(readiness({ state: state({ id: 'other' }), today: TODAY, others }).problems).toEqual([]);
	});

	it('lists the checklist: what is set, then what is wrong, each pointing at its control', () => {
		const r = readiness({ state: state({ form: { ...form, title: '' }, shots: [shot('a'), shot('b', { omitted: true })], assets: [asset('x')] }), today: TODAY });
		expect(r.checklist).toEqual([
			{ key: 'title', label: 'Title', state: 'todo', detail: 'missing', target: 'title' },
			{ key: 'code', label: 'Code', state: 'done', detail: 'DS-01', target: 'code' },
			{ key: 'round', label: 'Round', state: 'done', detail: '1', target: 'round' },
			{ key: 'baseCurrency', label: 'Base currency', state: 'done', detail: 'GBP', target: 'baseCurrency' },
			{ key: 'items', label: 'Shots and assets', state: 'done', detail: '1 shot, 1 asset', target: 'items' }
		]);
	});

	it('adds a line for any other problem, a warning in its tone', () => {
		const r = readiness({ state: state({ form: { ...form, dueDate: '2026-11-01', turnoverDate: 'soon' } }), today: TODAY });
		expect(r.checklist.slice(5)).toEqual([
			{ key: 'dueDate', label: 'Bids due', state: 'warning', detail: 'the day has passed', target: 'dueDate' },
			{ key: 'turnoverDate', label: 'Turnover', state: 'error', detail: 'not a day', target: 'turnoverDate' }
		]);
	});
});

describe('controlId and foldOf', () => {
	it('names the control each problem points at', () => {
		expect(controlId('title')).toBe('f-title');
		expect(controlId('items')).toBe('f-items');
		expect(controlId('project')).toBe('f-project');
	});

	it('says which folded group holds an optional field', () => {
		expect(foldOf('turnoverDate')).toBe('delivery');
		expect(foldOf('materialLink')).toBe('delivery');
		expect(foldOf('assumptions')).toBe('assumptions');
		expect(foldOf('title')).toBeNull();
		expect(foldOf('items')).toBeNull();
	});
});

describe('readiness of a request made from bids', () => {
	const send = { bids: ['SEQ010', 'Creature'], overlaps: [], vendors: [{ name: 'Vendor A', bids: 2 }] };

	it('is ready with the header, a bid with a row in, and a vendor with a bid', () => {
		const r = readiness({ state: state(), today: TODAY, send });
		expect(r.problems).toEqual([]);
		expect(r.canIssue).toBe(true);
		expect(r.checklist.slice(4).map((l) => [l.label, l.state, l.detail])).toEqual([
			['Bids', 'done', '2 bids: 1 shot'],
			['Vendors', 'done', '1 vendor']
		]);
	});

	it('wants a bid, a vendor, and a bid for each vendor, each pointing at its step', () => {
		const r = readiness({ state: state({ shots: [] }), today: TODAY, send: { bids: [], overlaps: [], vendors: [{ name: 'Vendor B', bids: 0 }] } });
		expect(r.problems.map((p) => [p.target, p.short])).toEqual([
			['bids', 'none picked'],
			['vendors', 'Vendor B has no bid']
		]);
		expect(readiness({ state: state(), today: TODAY, send: { ...send, vendors: [] } }).problems.map((p) => [p.target, p.message])).toEqual([['vendors', 'Add a vendor to send the request to.']]);
	});

	it('points rows with nothing in at the bids', () => {
		const r = readiness({ state: state({ shots: [shot('s', { omitted: true })] }), today: TODAY, send });
		expect(r.problems.map((p) => [p.target, p.message])).toEqual([['bids', 'Every row of the bids is omitted. Bring one back in its bid.']]);
	});

	it('names a row in two bids, and counts the rest', () => {
		const overlaps = [
			{ code: 'SH010', bids: ['SEQ010', 'SEQ010 copy'] as const },
			{ code: 'SH020', bids: ['SEQ010', 'SEQ010 copy'] as const }
		];
		const r = readiness({ state: state(), today: TODAY, send: { ...send, overlaps } });
		expect(r.problems.map((p) => [p.target, p.short, p.message])).toEqual([['bids', 'SH010 is in two bids', 'SH010 is in SEQ010 and in SEQ010 copy. A request takes each row once. And 1 more.']]);
		expect(r.checklist.find((l) => l.label === 'Bids')?.state).toBe('error');
	});
});
