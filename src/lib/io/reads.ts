/**
 * The builder's reads. Calls the client and hands rows to the pure modules; no logic beyond paging
 * and the request shapes. Nothing here writes.
 *
 * Every `_search` pages at 5000, the cap (082), until a short page: the client's `hasMore` says so,
 * since `links.next` is emitted on empty pages too (006). Schema is read once per type through the
 * context's cache, never looped over every type (002).
 */

import type { EntityRow, FieldSchema, SgClient, SgContext, WireGroup } from 'sg-widgets-core';
import { sequenceEpisodeField, type SiteShape } from '$lib/pure/field-map';

/** 082: `page[size]` takes 1 to 5000. */
export const PAGE_SIZE = 5000;

/** How many ids one `in` filter carries when rows are read again by id. */
export const ID_CHUNK = 500;

export async function searchAll(client: SgClient, entityType: string, filters: WireGroup, fields: string[], sort?: string): Promise<EntityRow[]> {
	const rows: EntityRow[] = [];
	for (let number = 1; ; number++) {
		const page = await client.search(entityType, { filters, fields, sort, page: { size: PAGE_SIZE, number } });
		rows.push(...page.data);
		if (!page.hasMore) return rows;
	}
}

/** Rows by id, a chunk of ids per read. */
export async function rowsByIds(client: SgClient, entityType: string, ids: readonly number[], fields: string[]): Promise<EntityRow[]> {
	const rows: EntityRow[] = [];
	for (let i = 0; i < ids.length; i += ID_CHUNK) {
		const chunk = ids.slice(i, i + ID_CHUNK);
		rows.push(...(await searchAll(client, entityType, { logical_operator: 'and', conditions: [['id', 'in', chunk]] }, fields)));
	}
	return rows;
}

/**
 * The project's rows whose code is one of `codes`, 500 codes to a read. Text filters ignore case
 * (field_types/text), so a code in another case comes back too; `match.ts` tells them apart.
 */
export async function rowsByCodes(client: SgClient, entityType: string, projectId: number, codes: readonly string[]): Promise<EntityRow[]> {
	const rows: EntityRow[] = [];
	for (let i = 0; i < codes.length; i += ID_CHUNK) {
		const chunk = codes.slice(i, i + ID_CHUNK);
		const filters: WireGroup = {
			logical_operator: 'and',
			conditions: [
				['project', 'is', { type: 'Project', id: projectId }],
				['code', 'in', chunk]
			]
		};
		rows.push(...(await searchAll(client, entityType, filters, ['code'])));
	}
	return rows;
}

export interface ProjectShape {
	readonly shot: Record<string, FieldSchema>;
	readonly asset: Record<string, FieldSchema>;
	readonly site: SiteShape;
}

/** Shot and Asset fields, whether the site has Episodes, and Sequence's link to one. */
export async function loadShape(context: SgContext): Promise<ProjectShape> {
	const [types, shot, asset] = await Promise.all([context.schema.entityTypes(), context.schema.fields('Shot'), context.schema.fields('Asset')]);
	const episodes = types.some((type) => type.name === 'Episode');
	const sequenceTypeOn = types.some((type) => type.name === 'Sequence');
	const sequenceEpisode = episodes && sequenceTypeOn ? sequenceEpisodeField(await context.schema.fields('Sequence')) : null;
	return { shot, asset, site: { episodes, sequenceEpisodeField: sequenceEpisode } };
}

/** The project's Sequences with their code and, when the site links one, their Episode. */
export function loadSequences(client: SgClient, projectId: number, episodeField: string | null): Promise<EntityRow[]> {
	const fields = episodeField ? ['code', episodeField] : ['code'];
	return searchAll(client, 'Sequence', { logical_operator: 'and', conditions: [['project', 'is', { type: 'Project', id: projectId }]] }, fields, 'code');
}
