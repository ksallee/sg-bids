import { describe, expect, it } from 'vitest';
import { listView, type ListRow } from './request-list';

const row = (id: string, projectId: number, extra: Partial<ListRow> = {}): ListRow => ({
	id,
	projectId,
	code: id.toUpperCase(),
	title: `Title ${id}`,
	status: 'issued',
	...extra
});

const projects = [
	{ id: 70, name: 'Big Show' },
	{ id: 91, name: 'Kids Room' },
	{ id: 5, name: 'Old one' }
];
const rows = [row('a', 70), row('b', 91, { status: 'draft' }), row('c', 70, { status: 'awarded', title: null }), row('d', 91, { code: 'KR-ROOF' })];

describe('listView', () => {
	it('keeps every row in order with no filter, and offers each project that holds one, with its count', () => {
		const view = listView(rows, projects, { project: null, query: '' });
		expect(view.rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
		expect(view.projectOptions).toEqual([
			{ id: 70, name: 'Big Show', count: 2 },
			{ id: 91, name: 'Kids Room', count: 2 }
		]);
		expect(view.filtered).toBe(false);
	});

	it('names each row’s project, and a project the server did not name by its id', () => {
		const view = listView([...rows, row('e', 12)], projects, { project: null, query: '' });
		expect(view.rows.find((r) => r.id === 'a')?.projectName).toBe('Big Show');
		expect(view.rows.find((r) => r.id === 'e')?.projectName).toBe('Project 12');
		expect(view.projectOptions.at(-1)).toEqual({ id: 12, name: 'Project 12', count: 1 });
	});

	it('filters by project: a filter, not a gate', () => {
		const view = listView(rows, projects, { project: 91, query: '' });
		expect(view.rows.map((r) => r.id)).toEqual(['b', 'd']);
		expect(view.filtered).toBe(true);
		expect(view.projectOptions).toHaveLength(2);
	});

	it('ignores a project filter no row holds, so a stale pick never empties the list', () => {
		const view = listView(rows, projects, { project: 5, query: '' });
		expect(view.rows).toHaveLength(4);
		expect(view.project).toBeNull();
	});

	it('finds by title, code or project name, every word, any case', () => {
		expect(listView(rows, projects, { project: null, query: 'kr-roof' }).rows.map((r) => r.id)).toEqual(['d']);
		expect(listView(rows, projects, { project: null, query: 'kids title' }).rows.map((r) => r.id)).toEqual(['b', 'd']);
		expect(listView(rows, projects, { project: null, query: '  untitled ' }).rows.map((r) => r.id)).toEqual(['c']);
		expect(listView(rows, projects, { project: 70, query: 'kids' }).rows).toEqual([]);
	});

	it('counts what is shown and what waits on production', () => {
		const view = listView(rows, projects, { project: null, query: '' });
		expect(view.counts).toEqual({ shown: 4, total: 4, drafts: 1 });
	});
});
