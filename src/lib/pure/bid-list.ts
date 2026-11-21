/**
 * The Bids list across projects, and the request a selection of bids makes. Pure, no I/O.
 *
 * Each row is named by its project; the project filter never gates (a pick no row holds is
 * ignored); the search reads the bid's name, its project and the codes of the requests it is in.
 * Rows keep the server's order, newest change first. A request is made in one project, so a
 * selection of bids makes one only when every bid ticked is in the same project.
 */

import type { Id } from './model';
import type { ProjectOption } from './request-list';

export interface BidListRow {
	readonly id: Id;
	readonly projectId: number;
	readonly name: string;
	readonly requests: readonly { readonly code: string }[];
}

export interface BidListView<T extends BidListRow> {
	readonly rows: readonly (T & { readonly projectName: string })[];
	readonly projectOptions: readonly ProjectOption[];
	readonly project: number | null;
	readonly filtered: boolean;
	readonly counts: { readonly shown: number; readonly total: number };
}

export function bidListView<T extends BidListRow>(rows: readonly T[], projects: readonly { id: number; name: string }[], filter: { project: number | null; query: string }): BidListView<T> {
	const names = new Map(projects.map((p) => [p.id, p.name]));
	const nameOf = (id: number) => names.get(id) ?? `Project ${id}`;
	const counts = new Map<number, number>();
	for (const r of rows) counts.set(r.projectId, (counts.get(r.projectId) ?? 0) + 1);
	const order = [...projects.map((p) => p.id).filter((id) => counts.has(id)), ...[...counts.keys()].filter((id) => !names.has(id)).sort((a, b) => a - b)];
	const projectOptions = order.map((id) => ({ id, name: nameOf(id), count: counts.get(id) ?? 0 }));
	const project = filter.project !== null && counts.has(filter.project) ? filter.project : null;
	const words = filter.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const named = rows.map((r) => ({ ...r, projectName: nameOf(r.projectId) }));
	const shown = named.filter((r) => {
		if (project !== null && r.projectId !== project) return false;
		if (words.length === 0) return true;
		const text = `${r.name} ${r.projectName} ${r.requests.map((q) => q.code).join(' ')}`.toLowerCase();
		return words.every((w) => text.includes(w));
	});
	return { rows: shown, projectOptions, project, filtered: project !== null || words.length > 0, counts: { shown: shown.length, total: rows.length } };
}

export type Selection = { readonly ok: true; readonly projectId: number; readonly bids: readonly Id[] } | { readonly ok: false; readonly reason: string };

/** The request the ticked bids make: their project and their ids, in the list's order. */
export function selectionRequest(rows: readonly BidListRow[], ticked: ReadonlySet<Id>): Selection {
	const picked = rows.filter((r) => ticked.has(r.id));
	if (picked.length === 0) return { ok: false, reason: 'Tick one bid or more.' };
	const projects = new Set(picked.map((r) => r.projectId));
	if (projects.size > 1) return { ok: false, reason: 'A request is made in one project. Tick bids of one project.' };
	return { ok: true, projectId: picked[0].projectId, bids: picked.map((r) => r.id) };
}

/** Where a bid opens, naming its project. */
export function bidHref(row: { id: Id; projectId: number }): string {
	return `/bids/${encodeURIComponent(row.id)}?project=${row.projectId}`;
}

/** Where the send flow starts for the ticked bids. */
export function newRequestHref(selection: { projectId: number; bids: readonly Id[] }): string {
	return `/requests/new?project=${selection.projectId}&bids=${selection.bids.map(encodeURIComponent).join(',')}`;
}
