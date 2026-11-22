/**
 * The requests list across projects: each row named by its project, a project filter that never
 * gates (a pick no row holds is ignored), and a search over title, code, project and bid names.
 * Rows keep the server's order, newest first.
 */

export interface ListRow {
	readonly id: string;
	readonly projectId: number;
	readonly code: string;
	readonly title: string | null;
	readonly status: string;
	/** The request's bids, by name, in order. */
	readonly bids?: readonly string[];
}

export interface ListFilter {
	readonly project: number | null;
	readonly query: string;
}

export interface ProjectOption {
	readonly id: number;
	readonly name: string;
	readonly count: number;
}

export interface ListView<T extends ListRow> {
	readonly rows: readonly (T & { readonly projectName: string })[];
	/** The projects that hold a request, in the order the server named them, then the rest by id. */
	readonly projectOptions: readonly ProjectOption[];
	/** The project filter in force: null when none, or when no row holds the one picked. */
	readonly project: number | null;
	readonly filtered: boolean;
	readonly counts: { readonly shown: number; readonly total: number; readonly drafts: number };
}

const UNTITLED = 'Untitled request';

export function listView<T extends ListRow>(rows: readonly T[], projects: readonly { id: number; name: string }[], filter: ListFilter): ListView<T> {
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
		const text = `${r.title ?? UNTITLED} ${r.code} ${r.projectName} ${(r.bids ?? []).join(' ')}`.toLowerCase();
		return words.every((w) => text.includes(w));
	});
	return {
		rows: shown,
		projectOptions,
		project,
		filtered: project !== null || words.length > 0,
		counts: { shown: shown.length, total: rows.length, drafts: rows.filter((r) => r.status === 'draft').length }
	};
}

/** Bid names shown in the list before "+N". */
export const BIDS_SHOWN = 3;

/** The Bids cell: the first names, how many more, and the whole list for the title. */
export function bidsCell(bids: readonly string[]): { shown: string; more: number; title: string } {
	return { shown: bids.slice(0, BIDS_SHOWN).join(', '), more: Math.max(0, bids.length - BIDS_SHOWN), title: bids.join(', ') };
}
