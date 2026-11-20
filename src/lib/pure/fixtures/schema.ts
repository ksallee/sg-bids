/**
 * `GET /schema/<Type>/fields?project_id=N` answers, cut to the fields the tests need, in the raw
 * shape the corpus shows (endpoints/get_schema_type_fields): every value wrapped in
 * `{value, editable}`, list values under `properties`. Tests run them through core's
 * `normalizeFields`, as the client does.
 *
 * Site A is the stock shape the corpus measured: Shot with `description`, `sg_sequence`, `assets`,
 * `image`, `sg_cut_in`, `sg_cut_out`, `sg_cut_duration` (156), Asset with `sg_asset_type`. No Episode.
 * Site B is a configured site: Shot links an Episode itself and carries custom frame, type and
 * difficulty fields. Its names are invented for the test.
 */

import type { RawFieldSchema, RawFieldsResponse } from 'sg-widgets-core';

type Props = Record<string, unknown>;

function field(entityType: string, name: string, displayName: string, dataType: string, props: Props = {}, editable = true): [string, RawFieldSchema] {
	const wrap = <T>(value: T) => ({ value, editable: false });
	return [
		name,
		{
			name: { value: displayName, editable: true },
			entity_type: wrap(entityType),
			data_type: wrap(dataType),
			editable: wrap(editable),
			mandatory: wrap(name === 'code'),
			unique: wrap(false),
			properties: Object.fromEntries([['default_value', null], ...Object.entries(props)].map(([key, value]) => [key, wrap(value)]))
		}
	];
}

function response(entries: [string, RawFieldSchema][]): RawFieldsResponse {
	return { data: Object.fromEntries(entries) };
}

const STATUS = {
	valid_values: ['wtg', 'rdy', 'ip', 'fin', 'omt'],
	display_values: { wtg: 'Waiting to Start', rdy: 'Ready to Start', ip: 'In Progress', fin: 'Final', omt: 'Omit' },
	hidden_values: []
};

const shotA = (name: string, label: string, type: string, props: Props = {}, editable = true) => field('Shot', name, label, type, props, editable);
const assetA = (name: string, label: string, type: string, props: Props = {}) => field('Asset', name, label, type, props);

export const SHOT_FIELDS_A = response([
	shotA('code', 'Shot Code', 'text'),
	shotA('description', 'Description', 'text'),
	shotA('sg_status_list', 'Status', 'status_list', STATUS),
	shotA('sg_latest_vendor_status', 'Latest Vendor Status', 'status_list', STATUS),
	shotA('sg_sequence', 'Sequence', 'entity', { valid_types: ['Sequence'] }),
	shotA('assets', 'Assets', 'multi_entity', { valid_types: ['Asset'] }),
	shotA('parent_shots', 'Parent Shots', 'multi_entity', { valid_types: ['Shot'] }),
	shotA('image', 'Thumbnail', 'image'),
	shotA('sg_cut_in', 'Cut In', 'number'),
	shotA('sg_cut_out', 'Cut Out', 'number'),
	shotA('sg_cut_duration', 'Cut Duration', 'number'),
	shotA('step_0', 'ALL TASKS', 'pivot_column', {}, false),
	shotA('project', 'Project', 'entity', { valid_types: ['Project'] }),
	// Read only, and it lists every type on the site, Episode and Sequence among them (entity_types/Shot).
	shotA('image_source_entity', 'Image Source Entity', 'entity', { valid_types: ['Asset', 'Episode', 'Sequence', 'Shot', 'Version'] }, false),
	shotA('created_by', 'Created by', 'entity', { valid_types: ['HumanUser', 'ApiUser'] }, false),
	shotA('created_at', 'Date Created', 'date_time', {}, false)
]);

export const ASSET_FIELDS_A = response([
	assetA('code', 'Asset Name', 'text'),
	assetA('description', 'Description', 'text'),
	assetA('sg_status_list', 'Status', 'status_list', STATUS),
	assetA('sg_asset_type', 'Type', 'list', { valid_values: ['Character', 'Environment', 'Prop', 'Vehicle'] }),
	assetA('image', 'Thumbnail', 'image'),
	assetA('shots', 'Shots', 'multi_entity', { valid_types: ['Shot'] }),
	assetA('episodes', 'Episodes', 'multi_entity', { valid_types: ['Episode'] })
]);

const seq = (name: string, label: string, type: string, props: Props = {}) => field('Sequence', name, label, type, props);

/** The stock Sequence links an Episode as `episode` (entity_types/Sequence). */
export const SEQUENCE_FIELDS_A = response([
	seq('code', 'Sequence Name', 'text'),
	seq('shots', 'Shots', 'multi_entity', { valid_types: ['Shot'] }),
	seq('episode', 'Episode', 'entity', { valid_types: ['Episode'] }),
	seq('assets', 'Assets', 'multi_entity', { valid_types: ['Asset'] })
]);

/** A Sequence with a custom Episode link and no stock one. */
export const SEQUENCE_FIELDS_CUSTOM = response([seq('code', 'Sequence Name', 'text'), seq('sg_ep', 'Episode', 'entity', { valid_types: ['Episode'] })]);

/** Two custom Episode links, neither the stock one: no way to tell which. */
export const SEQUENCE_FIELDS_TWO = response([
	seq('code', 'Sequence Name', 'text'),
	seq('sg_ep_a', 'Episode A', 'entity', { valid_types: ['Episode'] }),
	seq('sg_ep_b', 'Episode B', 'entity', { valid_types: ['Episode'] })
]);

export const SHOT_FIELDS_B = response([
	shotA('code', 'Shot Code', 'text'),
	shotA('sg_brief', 'Brief', 'text'),
	shotA('sg_status_list', 'Status', 'status_list', STATUS),
	shotA('sg_sequence', 'Sequence', 'entity', { valid_types: ['Sequence'] }),
	shotA('sg_episode', 'Episode', 'entity', { valid_types: ['Episode'] }),
	shotA('assets', 'Assets', 'multi_entity', { valid_types: ['Asset'] }),
	shotA('sg_frame_count', 'Frame Count', 'number'),
	shotA('sg_shot_type', 'Shot Type', 'list', { valid_values: ['2D', '3D', 'FX'] }),
	shotA('sg_complexity', 'Complexity', 'list', { valid_values: ['A', 'B', 'C', 'D'] }),
	shotA('sg_notes_text', 'Notes', 'text')
]);

export const ASSET_FIELDS_B = response([
	assetA('code', 'Asset Name', 'text'),
	assetA('sg_brief', 'Brief', 'text'),
	assetA('sg_asset_type', 'Type', 'list', { valid_values: ['Character', 'Prop'] }),
	assetA('sg_difficulty', 'Difficulty', 'text')
]);
