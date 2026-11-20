/**
 * Picking Shots and Assets: the filter the table reads with, and the picked items kept as frozen
 * copies while the selection changes. Pure, no I/O.
 *
 * Every read carries the project filter: the endpoint is not scoped (entity_types/Shot). Text is
 * matched with `contains`, every word required; status, type and links with `in` (017). An
 * Episode filter on a site whose Shots reach the Episode only through the Sequence becomes the
 * list of that Episode's Sequences, so no dotted path ending on a link is needed.
 */

import type { EntityRef, EntityRow, WireCondition, WireGroup } from 'sg-widgets-core';
import { EPISODE_FROM_SEQUENCE } from './field-map';
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
}

/**
 * The picked items for a new selection: an item still picked keeps its edited copy, a new pick is
 * frozen from its row, an unpicked item leaves. `missing` names the picks with no row at hand.
 */
export function mergePicked<T extends Picked>(
	current: readonly T[],
	selected: readonly number[],
	rows: readonly EntityRow[],
	freeze: (row: EntityRow) => T
): { items: T[]; missing: number[] } {
	const byFpt = new Map(current.filter((item) => item.fpt).map((item) => [item.fpt!.id, item]));
	const rowById = new Map(rows.map((row) => [row.id, row]));
	const items: T[] = [];
	const missing: number[] = [];
	for (const id of selected) {
		const kept = byFpt.get(id);
		if (kept) items.push(kept);
		else {
			const row = rowById.get(id);
			if (row) items.push(freeze(row));
			else missing.push(id);
		}
	}
	return { items, missing };
}

/** The picks with every row of a select all added; what was picked stays as it is. */
export function addPicked<T extends Picked>(current: readonly T[], rows: readonly EntityRow[], freeze: (row: EntityRow) => T): T[] {
	const have = new Set(current.map((item) => item.fpt?.id));
	return [...current, ...rows.filter((row) => !have.has(row.id)).map(freeze)];
}

/** The picked items as the table's selection. */
export function selectionRefs(items: readonly (Picked & { code?: string; name?: string })[]): EntityRef[] {
	return items.filter((item) => item.fpt).map((item) => ({ type: item.fpt!.type, id: item.fpt!.id, name: item.code ?? item.name }));
}
