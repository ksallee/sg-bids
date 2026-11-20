/**
 * Picking Shots and Assets: the filter the table reads with, and the picked items kept as frozen
 * copies while the selection changes. Pure, no I/O.
 *
 * Every read carries the project filter: the endpoint is not scoped (entity_types/Shot). Text is
 * matched with `contains`, every word required; status, type and links with `in` (017). An
 * Episode filter on a site whose Shots reach the Episode only through the Sequence becomes the
 * list of that Episode's Sequences, so no dotted path ending on a link is needed.
 */

import type { ColumnSpec, EntityRef, EntityRow, FieldSchema, WireCondition, WireGroup } from 'sg-widgets-core';
import { EPISODE_FROM_SEQUENCE, type ItemKind, type Mapping } from './field-map';

/** One choice in a list filter. */
export interface ListOption {
	readonly code: string;
	readonly label: string;
}
import type { SequenceIndex } from './freeze';

export interface PickFilter {
	readonly search: string;
	/** Sequence ids. */
	readonly sequences: readonly number[];
	/** Episode ids. */
	readonly episodes: readonly number[];
	/** Status codes. */
	readonly statuses: readonly string[];
	/** Type values. */
	readonly types: readonly string[];
}

export const EMPTY_FILTER: PickFilter = { search: '', sequences: [], episodes: [], statuses: [], types: [] };

/** Which fields each filter reads on this type. A null field turns its filter off. */
export interface FilterContext {
	readonly projectId: number;
	readonly statusField: string | null;
	readonly typeField: string | null;
	readonly sequenceField: string | null;
	/** A Shot field linking an Episode, or `EPISODE_FROM_SEQUENCE`. */
	readonly episodeField: string | null;
	readonly sequences: SequenceIndex;
}

/** The fields each filter reads for this kind, from the mapping and what the schema holds. */
export function filterContext(kind: ItemKind, projectId: number, mapping: Mapping, schema: Record<string, FieldSchema>, sequences: SequenceIndex): FilterContext {
	const has = (name: string | null | undefined): name is string => typeof name === 'string' && name in schema;
	return {
		projectId,
		statusField: has('sg_status_list') ? 'sg_status_list' : null,
		typeField: has(mapping.type) && schema[mapping.type].dataType === 'list' ? mapping.type : null,
		sequenceField: kind === 'shot' && has(mapping.sequence) ? mapping.sequence : null,
		episodeField: kind !== 'shot' ? null : mapping.episode === EPISODE_FROM_SEQUENCE ? EPISODE_FROM_SEQUENCE : has(mapping.episode) ? mapping.episode : null,
		sequences
	};
}

export type FilterResult = { readonly kind: 'filters'; readonly filters: WireGroup } | { readonly kind: 'none' };

export function isFiltered(filter: PickFilter): boolean {
	return filter.search.trim() !== '' || filter.sequences.length > 0 || filter.episodes.length > 0 || filter.statuses.length > 0 || filter.types.length > 0;
}

const ref = (type: string, id: number) => ({ type, id });

/** The filter for the table and for select all. `none` when no row can match, so nothing is read. */
export function pickFilters(filter: PickFilter, context: FilterContext): FilterResult {
	const conditions: WireCondition[] = [['project', 'is', ref('Project', context.projectId)]];
	for (const word of filter.search.trim().split(/\s+/).filter(Boolean)) conditions.push(['code', 'contains', word]);
	if (context.statusField && filter.statuses.length > 0) conditions.push([context.statusField, 'in', [...filter.statuses]]);
	if (context.typeField && filter.types.length > 0) conditions.push([context.typeField, 'in', [...filter.types]]);

	let sequenceIds: number[] | null = context.sequenceField && filter.sequences.length > 0 ? [...filter.sequences] : null;
	if (context.episodeField && filter.episodes.length > 0) {
		if (context.episodeField === EPISODE_FROM_SEQUENCE) {
			if (!context.sequenceField) return { kind: 'none' };
			const wanted = new Set(filter.episodes);
			const inEpisodes = [...context.sequences.values()].filter((s) => s.episode && wanted.has(s.episode.id)).map((s) => s.id);
			sequenceIds = sequenceIds === null ? inEpisodes : sequenceIds.filter((id) => inEpisodes.includes(id));
			if (sequenceIds.length === 0) return { kind: 'none' };
		} else {
			conditions.push([
				context.episodeField,
				'in',
				filter.episodes.map((id) => ref('Episode', id))
			]);
		}
	}
	if (context.sequenceField && sequenceIds !== null) {
		conditions.push([context.sequenceField, 'in', sequenceIds.map((id) => ref('Sequence', id))]);
	}
	return { kind: 'filters', filters: { logical_operator: 'and', conditions } };
}

interface Picked {
	readonly id: string;
	readonly fpt?: { readonly type: string; readonly id: number };
	readonly source?: 'breakdown';
}

/**
 * The picked items for a new selection: an item still picked keeps its edited copy and its place, a
 * new pick is frozen from its row and goes after, an unpicked item leaves. A breakdown row stays
 * whatever the table selects: it leaves only when taken out. `missing` names the picks with no row
 * at hand.
 */
export function mergePicked<T extends Picked>(
	current: readonly T[],
	selected: readonly number[],
	rows: readonly EntityRow[],
	freeze: (row: EntityRow, position: number) => T
): { items: T[]; missing: number[] } {
	const wanted = new Set(selected);
	const items: T[] = current.filter((item) => item.source === 'breakdown' || (item.fpt && wanted.has(item.fpt.id)));
	const have = new Set(items.flatMap((item) => (item.fpt ? [item.fpt.id] : [])));
	const rowById = new Map(rows.map((row) => [row.id, row]));
	const missing: number[] = [];
	for (const id of selected) {
		if (have.has(id)) continue;
		const row = rowById.get(id);
		if (row) items.push(freeze(row, items.length + 1));
		else missing.push(id);
	}
	return { items, missing };
}

/**
 * Every item picked from Flow PT copied again from its row, in place; one whose row is gone leaves.
 * A breakdown row stays as typed: its values never came from Flow PT.
 */
export function refrozen<T extends Picked>(current: readonly T[], rows: readonly EntityRow[], freeze: (row: EntityRow, position: number) => T): T[] {
	const rowById = new Map(rows.map((row) => [row.id, row]));
	const out: T[] = [];
	for (const item of current) {
		if (item.source === 'breakdown') out.push(item);
		else {
			const row = item.fpt ? rowById.get(item.fpt.id) : undefined;
			if (row) out.push(freeze(row, out.length + 1));
		}
	}
	return out;
}

/** The picks with every row of a select all added; what was picked stays as it is. */
export function addPicked<T extends Picked>(current: readonly T[], rows: readonly EntityRow[], freeze: (row: EntityRow, position: number) => T): T[] {
	const have = new Set(current.map((item) => item.fpt?.id));
	return [...current, ...rows.filter((row) => !have.has(row.id)).map((row, i) => freeze(row, current.length + i + 1))];
}

/**
 * The table's columns: the thumbnail (081, free on the same read), the code, where it sits, the
 * status, then the mapped fields, each only when the schema has it. Nothing is editable here.
 */
export function pickColumns(kind: ItemKind, mapping: Mapping, schema: Record<string, FieldSchema>): ColumnSpec[] {
	const wanted: ColumnSpec[] = [
		{ path: 'image', width: 96, sortable: false },
		{ path: 'code', width: 200 },
		...(kind === 'shot' ? [{ path: mapping.sequence ?? '', width: 130 }] : []),
		...(kind === 'shot' && mapping.episode !== EPISODE_FROM_SEQUENCE ? [{ path: mapping.episode ?? '', width: 120 }] : []),
		{ path: 'sg_status_list', width: 150 },
		{ path: mapping.type ?? '', width: 130 },
		{ path: mapping.difficulty ?? '', width: 120 },
		...(kind === 'shot' ? [{ path: mapping.frames ?? '', width: 100, align: 'right' as const }] : []),
		{ path: mapping.description ?? '', width: 340 }
	];
	const seen = new Set<string>();
	return wanted
		.filter((spec) => spec.path in schema && !seen.has(spec.path) && seen.add(spec.path))
		.map((spec) => ({ ...spec, editable: false }));
}

/** Filter options from the project's Sequences: each Sequence, and each Episode they link. */
export function sequenceOptions(sequences: SequenceIndex): { sequences: ListOption[]; episodes: ListOption[] } {
	const all = [...sequences.values()].sort((a, b) => a.code.localeCompare(b.code));
	const episodes = new Map<number, string>();
	for (const s of all) if (s.episode) episodes.set(s.episode.id, s.episode.name);
	return {
		sequences: all.map((s) => ({ code: String(s.id), label: s.code })),
		episodes: [...episodes].map(([id, name]) => ({ code: String(id), label: name })).sort((a, b) => a.label.localeCompare(b.label))
	};
}

/** The type filter's options: a list field's values. A text field gets none, so no filter. */
export function typeOptions(field: FieldSchema | undefined): ListOption[] {
	return field?.dataType === 'list' ? (field.validValues ?? []).map((value) => ({ code: value, label: value })) : [];
}

/** The picked items as the table's selection. */
export function selectionRefs(items: readonly (Picked & { code?: string; name?: string })[]): EntityRef[] {
	return items.filter((item) => item.fpt).map((item) => ({ type: item.fpt!.type, id: item.fpt!.id, name: item.code ?? item.name }));
}
