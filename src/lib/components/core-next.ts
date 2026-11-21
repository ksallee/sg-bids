/**
 * What sg-widgets-core gains in sg-widgets PR #382 (issue #381), PR #380 and PR #384 (issue #383),
 * copied until sg-bids moves to the core release that ships them: the bulk edit plan, the list
 * source over rows the host holds, `updateRows` on a source, `fillWidths`, and `tableGrouping`. The code is core's, unchanged but for the
 * imports. Delete this file then, and import the names from 'sg-widgets-core'.
 */
import { cellValue, rowKey, toWireGroup } from 'sg-widgets-core';
import type { EntityRef, EntityRow, EntitySource, EntitySourceState, SortSpec, SourceFilters, SourceMode } from 'sg-widgets-core';

/** An entity source that may write several rows at once (core's `EntitySource.updateRows`). */
export type EntitySourceNext = EntitySource & {
	updateRows?(updates: RowUpdate[]): Promise<RowWriteResult[]>;
};

/** core `table-width.ts` (PR #380). */
export function fillWidths(sizes: readonly number[], room: number): number[] {
	const widths = [...sizes];
	if (widths.length === 0 || !Number.isFinite(room) || room <= 0) return widths;
	const total = widths.reduce((sum, size) => sum + size, 0);
	const extra = Math.floor(room) - total;
	const last = widths.length - 1;
	if (extra > 0) widths[last] = (widths[last] ?? 0) + extra;
	return widths;
}

/** core `collection-state.ts` (PR #384): what a table groups on, and the group path no column shows. */
export interface TableGrouping {
	grouping: string[];
	groupOnly: string | null;
}

export function tableGrouping(groupBy: string | null | undefined, columnPaths: readonly string[]): TableGrouping {
	if (!groupBy) return { grouping: [], groupOnly: null };
	return { grouping: [groupBy], groupOnly: columnPaths.includes(groupBy) ? null : groupBy };
}

/* core `bulk-edit.ts` (PR #382) */

/** One row's write: the fields to set on it. */
export interface RowUpdate {
	ref: EntityRef;
	patch: Record<string, unknown>;
}

/** What one row's write did: the row as it reads now, or why it was refused. */
export type RowWriteResult =
	| { ref: EntityRef; ok: true; row: EntityRow }
	| { ref: EntityRef; ok: false; message: string };

/** A selected row the edit leaves, and why. */
export interface SkippedRow {
	row: EntityRow;
	reason: string;
}

/** One cell's value applied to a column over the selected rows. */
export interface BulkEdit {
	/** The column's path. */
	path: string;
	value: unknown;
	/** True when the edited row is one of two or more selected rows. */
	bulk: boolean;
	/** The rows the edit writes, the edited row first. */
	rows: EntityRow[];
	/** Selected rows on screen whose cell cannot be edited. */
	skipped: SkippedRow[];
	/** Selected rows not loaded, which the edit does not reach. */
	unloaded: number;
}

export interface BulkEditInput {
	/** The rows on screen, in their order. */
	rows: readonly EntityRow[];
	selection: readonly EntityRef[];
	/** The row whose cell was edited. */
	edited: EntityRow;
	path: string;
	value: unknown;
	/** Why a row's cell at `path` cannot be edited, or null when it can. */
	lockOf: (row: EntityRow) => string | null;
}

/**
 * The edit as it would land. It reaches the edited row alone unless that row is one of two or more
 * selected rows; then it reaches every selected row on screen whose cell can be edited, in row
 * order after the edited one.
 */
export function planBulkEdit(input: BulkEditInput): BulkEdit {
	const { edited, path, value } = input;
	const selected = new Set(input.selection.map(rowKey));
	const editedKey = rowKey(edited);
	if (!selected.has(editedKey) || selected.size < 2) {
		return { path, value, bulk: false, rows: [edited], skipped: [], unloaded: 0 };
	}
	const rows: EntityRow[] = [edited];
	const skipped: SkippedRow[] = [];
	const loaded = new Set<string>();
	for (const row of input.rows) {
		const key = rowKey(row);
		if (!selected.has(key) || loaded.has(key)) continue;
		loaded.add(key);
		if (key === editedKey) continue;
		const reason = input.lockOf(row);
		if (reason === null) rows.push(row);
		else skipped.push({ row, reason });
	}
	loaded.add(editedKey);
	const unloaded = [...selected].filter((key) => !loaded.has(key)).length;
	return { path, value, bulk: true, rows, skipped, unloaded };
}

/** The writes a plan makes: the same field set on each row it reaches. */
export function bulkUpdates(edit: BulkEdit): RowUpdate[] {
	return edit.rows.map((row) => ({ ref: { type: row.type, id: row.id }, patch: { [edit.path]: edit.value } }));
}

/** How many of the results landed and how many were refused. */
export function countResults(results: readonly RowWriteResult[]): { landed: number; refused: number } {
	const landed = results.filter((result) => result.ok).length;
	return { landed, refused: results.length - landed };
}

/** The message of an error, whatever was thrown. */
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Write each update with `write`, one at a time, and answer a result per update in order. A
 * refusal is a result, not a throw, so one refused row never stops the rest.
 */
export async function writeEach(
	updates: readonly RowUpdate[],
	write: (update: RowUpdate) => Promise<EntityRow>,
): Promise<RowWriteResult[]> {
	const results: RowWriteResult[] = [];
	for (const update of updates) {
		try {
			results.push({ ref: update.ref, ok: true, row: await write(update) });
		} catch (error) {
			results.push({ ref: update.ref, ok: false, message: messageOf(error) });
		}
	}
	return results;
}

/* core `list-source.ts` (PR #382) */

export interface ListSourceOptions {
	/** The type the column choice is kept under. The rows may be of any type. */
	entityType: string;
	rows?: readonly EntityRow[];
	sort?: SortSpec[];
	/** Write one row and answer it as it reads afterwards. A throw is a refusal. */
	update?: (update: RowUpdate) => Promise<EntityRow>;
	/** Write several rows and answer one result per update, in order. Without it `update` runs per row. */
	updateMany?: (updates: RowUpdate[]) => Promise<RowWriteResult[]>;
}

export interface ListSource extends EntitySourceNext {
	/** Replace the rows. The sort in force orders them. */
	setRows(rows: readonly EntityRow[]): void;
}

/** The text or number a cell sorts on: an entity by its name, a list of them by their names. */
function sortKeyOf(value: unknown): string | number | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) return value.map((item) => String(sortKeyOf(item) ?? '')).join(', ') || null;
	if (typeof value === 'object') {
		const named = value as { name?: unknown; code?: unknown; id?: unknown };
		const label = named.name ?? named.code;
		return typeof label === 'string' ? label : typeof named.id === 'number' ? named.id : null;
	}
	return String(value);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Two cells in sort order. An empty cell goes last whichever way the sort runs. */
export function compareCells(a: unknown, b: unknown, descending = false): number {
	const x = sortKeyOf(a);
	const y = sortKeyOf(b);
	if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
	const order = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
	return descending ? -order : order;
}

/** The rows in the order the sort keys give, ties kept in the host's order. */
export function sortRows(rows: readonly EntityRow[], sort: readonly SortSpec[]): EntityRow[] {
	const keys = sort.filter((key) => key.path);
	if (keys.length === 0) return [...rows];
	return rows
		.map((row, index) => ({ row, index }))
		.sort((a, b) => {
			for (const key of keys) {
				const order = compareCells(cellValue(a.row, key.path), cellValue(b.row, key.path), key.descending);
				if (order !== 0) return order;
			}
			return a.index - b.index;
		})
		.map((entry) => entry.row);
}

export function createListSource(options: ListSourceOptions): ListSource {
	let held: EntityRow[] = [...(options.rows ?? [])];
	let fields: string[] = ['id'];
	let state: EntitySourceState = {
		rows: [],
		status: 'ready',
		error: null,
		hasMore: false,
		total: 0,
		filters: null,
		sort: [...(options.sort ?? [])],
		mode: 'infinite',
		page: 1,
		pageSize: 1,
	};
	const listeners = new Set<() => void>();

	function publish(next: Partial<EntitySourceState> = {}): void {
		const sort = next.sort ?? state.sort;
		const rows = sortRows(held, sort);
		state = { ...state, ...next, rows, total: rows.length, pageSize: Math.max(1, rows.length) };
		for (const listener of listeners) listener();
	}

	/** Put written rows in place of the ones they replace, keeping the host's order. */
	function swap(fresh: readonly EntityRow[]): void {
		if (fresh.length === 0) return;
		const byKey = new Map(fresh.map((row) => [rowKey(row), row]));
		held = held.map((row) => byKey.get(rowKey(row)) ?? row);
		publish();
	}

	function refused(): Promise<never> {
		return Promise.reject(new Error('These rows are read only.'));
	}

	publish();

	const source: ListSource = {
		entityType: options.entityType,
		get fields(): readonly string[] {
			return fields;
		},
		get rows(): EntityRow[] {
			return state.rows;
		},
		get status() {
			return state.status;
		},
		get error() {
			return state.error;
		},
		get hasMore() {
			return false;
		},
		get filters() {
			return state.filters;
		},
		get sort(): SortSpec[] {
			return state.sort;
		},
		get mode(): SourceMode {
			return state.mode;
		},
		get page() {
			return 1;
		},
		get pageSize() {
			return state.pageSize;
		},
		get total() {
			return state.total;
		},

		setRows(rows: readonly EntityRow[]): void {
			held = [...rows];
			publish();
		},
		load: () => Promise.resolve(),
		loadMore: () => Promise.resolve(),
		refresh: () => Promise.resolve(),
		addFields(paths: readonly string[]): Promise<void> {
			fields = [...new Set([...fields, ...paths.filter(Boolean)])];
			return Promise.resolve();
		},
		/** Held for the two-way prop and never applied: the host hands over the rows it wants shown. */
		setFilters(filters: SourceFilters): Promise<void> {
			publish({ filters: toWireGroup(filters) });
			return Promise.resolve();
		},
		setSort(sort: SortSpec[]): Promise<void> {
			publish({ sort: [...sort] });
			return Promise.resolve();
		},
		setPage: () => Promise.resolve(),
		setMode(mode: SourceMode): Promise<void> {
			if (mode !== state.mode) publish({ mode });
			return Promise.resolve();
		},
		setPageSize: () => Promise.resolve(),
		count: () => Promise.resolve(held.length),

		async updateRow(ref: EntityRef, patch: Record<string, unknown>): Promise<EntityRow> {
			if (options.update) {
				const fresh = await options.update({ ref, patch });
				swap([fresh]);
				return fresh;
			}
			if (!options.updateMany) return refused();
			const [result] = await options.updateMany([{ ref, patch }]);
			if (!result) throw new Error('The write answered nothing.');
			if (!result.ok) throw new Error(result.message);
			swap([result.row]);
			return result.row;
		},

		async updateRows(updates: RowUpdate[]): Promise<RowWriteResult[]> {
			const write = options.update;
			const results = options.updateMany
				? await options.updateMany(updates)
				: write
					? await writeEach(updates, write)
					: updates.map((update) => ({ ref: update.ref, ok: false as const, message: 'These rows are read only.' }));
			swap(results.flatMap((result) => (result.ok ? [result.row] : [])));
			return results;
		},

		rereadRows: () => Promise.resolve(),
		snapshot: () => state,
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return source;
}
