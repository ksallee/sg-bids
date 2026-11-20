/**
 * `POST /entity/<type>/_search` rows in the shape the corpus shows (003_query): scalars under
 * `attributes`, every link under `relationships` as `{data, links}` with the target's
 * `cached_display_name` as `name` (060). `image` is a presigned URL string (081).
 */

import type { EntityRow } from 'sg-widgets-core';

type Link = { type: string; id: number; name: string } | null;

function rel(data: Link | Link[], self: string) {
	return { data, links: { self } };
}

export function shotRow(id: number, attributes: Record<string, unknown>, links: Record<string, Link | Link[]> = {}): EntityRow {
	return {
		type: 'Shot',
		id,
		attributes,
		relationships: Object.fromEntries(Object.entries(links).map(([field, data]) => [field, rel(data, `/api/v1/entity/shots/${id}/relationships/${field}`)]))
	} as EntityRow;
}

export function assetRow(id: number, attributes: Record<string, unknown>, links: Record<string, Link | Link[]> = {}): EntityRow {
	return {
		type: 'Asset',
		id,
		attributes,
		relationships: Object.fromEntries(Object.entries(links).map(([field, data]) => [field, rel(data, `/api/v1/entity/assets/${id}/relationships/${field}`)]))
	} as EntityRow;
}

export function sequenceRow(id: number, code: string, episode: Link): EntityRow {
	return {
		type: 'Sequence',
		id,
		attributes: { code },
		relationships: { episode: rel(episode, `/api/v1/entity/sequences/${id}/relationships/episode`) }
	} as EntityRow;
}

const IMAGE = 'https://sg-media-usor-01.s3-accelerate.amazonaws.com/abc/thumb.jpg?X-Amz-Signature=x';

/** Site A: a shot with every stock field filled. */
export const SHOT_1001 = shotRow(
	1001,
	{ code: 'sh010_0010', description: ' Hero lands on the roof. ', sg_status_list: 'ip', sg_cut_duration: 96, image: IMAGE },
	{
		sg_sequence: { type: 'Sequence', id: 31, name: 'sh010' },
		assets: [
			{ type: 'Asset', id: 501, name: 'heroA' },
			{ type: 'Asset', id: 502, name: 'roofEnv' }
		]
	}
);

/** Site A: a shot with nothing but its code. */
export const SHOT_1002 = shotRow(1002, { code: 'sh010_0020', description: null, sg_status_list: 'wtg', sg_cut_duration: null, image: null }, { sg_sequence: null, assets: [] });

export const ASSET_501 = assetRow(501, { code: 'heroA', description: 'The hero, full CG double.', sg_asset_type: 'Character', sg_status_list: 'ip', image: IMAGE });
export const ASSET_502 = assetRow(502, { code: 'roofEnv', description: '', sg_asset_type: 'Environment', sg_status_list: 'wtg', image: null });
