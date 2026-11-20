/**
 * Freeze: a Flow PT row becomes a request shot or asset, a copy that no longer follows the site.
 * Production edits the copy; the vendor gets the copy. Pure, no I/O.
 *
 * Scalars are read from `attributes`, links from `relationships` (003_query), a link's label from
 * its `name`, the target's `cached_display_name` (060). `image` is a presigned URL (081): it
 * expires, so whatever stores a request for a vendor must copy the picture, not the link.
 */

import type { EntityRow } from 'sg-widgets-core';
import { EPISODE_FROM_SEQUENCE, type Mapping } from './field-map';
import type { Id, RequestAsset, RequestShot } from './model';

export interface SequenceInfo {
	readonly id: number;
	readonly code: string;
	readonly episode: { readonly id: number; readonly name: string } | null;
}

export type SequenceIndex = ReadonlyMap<number, SequenceInfo>;

export function shotItemId(fptId: number): Id {
	return `shot-${fptId}`;
}

export function assetItemId(fptId: number): Id {
	return `asset-${fptId}`;
}

type Ref = { type: string; id: number; name?: string | null };

function link(row: EntityRow, field: string | null | undefined): Ref | null {
	if (!field) return null;
	const data = row.relationships?.[field]?.data;
	return data && !Array.isArray(data) ? (data as Ref) : null;
}

function links(row: EntityRow, field: string | null | undefined): Ref[] {
	if (!field) return [];
	const data = row.relationships?.[field]?.data;
	return Array.isArray(data) ? (data as Ref[]) : [];
}

function text(row: EntityRow, field: string | null | undefined): string | undefined {
	if (!field) return undefined;
	const value = row.attributes?.[field];
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (typeof value !== 'string') return undefined;
	return value.trim() === '' ? undefined : value.trim();
}

function count(row: EntityRow, field: string | null | undefined): number | undefined {
	if (!field) return undefined;
	const value = row.attributes?.[field];
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
	return Math.round(value);
}

function code(row: EntityRow): string {
	const value = row.attributes?.code;
	return typeof value === 'string' && value.trim() !== '' ? value : `${row.type} ${row.id}`;
}

function image(row: EntityRow): string | undefined {
	const value = row.attributes?.image;
	return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Drop the keys left undefined, so a copy holds only what it has. */
function compact<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export function freezeShot(row: EntityRow, mapping: Mapping, sequences: SequenceIndex = new Map()): RequestShot {
	const sequence = link(row, mapping.sequence);
	const episode =
		mapping.episode === EPISODE_FROM_SEQUENCE
			? (sequence && sequences.get(sequence.id)?.episode?.name) || undefined
			: link(row, mapping.episode)?.name || undefined;
	return compact({
		id: shotItemId(row.id),
		code: code(row),
		fpt: { type: 'Shot', id: row.id },
		description: text(row, mapping.description),
		episode,
		sequence: sequence?.name || undefined,
		type: text(row, mapping.type),
		difficulty: text(row, mapping.difficulty),
		frames: count(row, mapping.frames),
		omitted: false,
		assetIds: links(row, mapping.assets)
			.filter((ref) => ref.type === 'Asset')
			.map((ref) => assetItemId(ref.id)),
		thumbnail: image(row)
	});
}

export function freezeAsset(row: EntityRow, mapping: Mapping): RequestAsset {
	return compact({
		id: assetItemId(row.id),
		name: code(row),
		fpt: { type: 'Asset', id: row.id },
		description: text(row, mapping.description),
		type: text(row, mapping.type),
		difficulty: text(row, mapping.difficulty),
		omitted: false
	});
}

/** The project's Sequences by id, each with its code and, when the site links one, its Episode. */
export function sequenceIndex(rows: readonly EntityRow[], episodeField: string | null): Map<number, SequenceInfo> {
	return new Map(
		rows.map((row) => {
			const episode = episodeField ? link(row, episodeField) : null;
			return [row.id, { id: row.id, code: code(row), episode: episode ? { id: episode.id, name: episode.name ?? `Episode ${episode.id}` } : null }];
		})
	);
}
