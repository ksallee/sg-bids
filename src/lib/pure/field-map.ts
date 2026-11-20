/**
 * The field mapping: which Flow PT field fills each thing a request shot or asset carries. Sites
 * differ, so nothing is assumed: the options come from the type's schema, by data type and, for a
 * link, by the type it links (`valid_types`). The defaults are picked by name and the user can
 * change any of them. Pure, no I/O.
 *
 * The episode is special. A Shot may link an Episode itself, or only through its Sequence
 * (`Sequence.episode`, entity_types/Sequence). The second is offered as `EPISODE_FROM_SEQUENCE` and
 * resolved from the project's Sequences, read once, since a dotted path ending on a link was not
 * measured.
 */

import type { FieldSchema } from 'sg-widgets-core';

export type ItemKind = 'shot' | 'asset';
export type ShotSlot = 'description' | 'frames' | 'sequence' | 'episode' | 'type' | 'difficulty' | 'assets';
export type AssetSlot = 'description' | 'type' | 'difficulty';
export type Slot = ShotSlot | AssetSlot;

/** Slot to field name, or null when the slot is left empty. */
export type Mapping = Record<string, string | null>;

/** What the site holds beyond the type's own fields. */
export interface SiteShape {
	/** The Episode entity type is enabled on the site. */
	readonly episodes: boolean;
	/** Sequence's field linking an Episode, null when it has none. */
	readonly sequenceEpisodeField: string | null;
}

export interface SlotSpec {
	readonly slot: Slot;
	/** What the request calls it. */
	readonly label: string;
	/** One line on what it is for. */
	readonly line: string;
	readonly dataTypes: readonly string[];
	/** For a link: the type it must link. */
	readonly linksTo?: string;
	/** Names tried first, in order. */
	readonly names: readonly string[];
	/** A name matching this is the next best guess. */
	readonly pattern?: RegExp;
}

export interface FieldOption {
	readonly code: string;
	readonly label: string;
}

/** The episode read from the shot's Sequence, not from a field of the shot. */
export const EPISODE_FROM_SEQUENCE = '@sequence.episode';

const SHOT_SLOTS: readonly SlotSpec[] = [
	{
		slot: 'description',
		label: 'Description',
		line: 'What happens in the shot.',
		dataTypes: ['text'],
		names: ['description', 'sg_description'],
		pattern: /desc|brief|summary/i
	},
	{
		slot: 'frames',
		label: 'Frame count',
		line: 'The cut length in frames.',
		dataTypes: ['number', 'float'],
		names: ['sg_cut_duration', 'cut_duration', 'sg_frame_count', 'frame_count', 'sg_frames', 'frames'],
		pattern: /cut_duration|frame|duration/i
	},
	{ slot: 'sequence', label: 'Sequence', line: 'Where the shot sits.', dataTypes: ['entity'], linksTo: 'Sequence', names: ['sg_sequence', 'sequence'] },
	{ slot: 'episode', label: 'Episode', line: 'For a series.', dataTypes: ['entity'], linksTo: 'Episode', names: ['sg_episode', 'episode'] },
	{
		slot: 'type',
		label: 'Type',
		line: 'The kind of work.',
		dataTypes: ['list', 'text'],
		names: ['sg_shot_type', 'shot_type', 'sg_type', 'type'],
		pattern: /type|category|kind/i
	},
	{
		slot: 'difficulty',
		label: 'Difficulty',
		line: 'How hard the work is.',
		dataTypes: ['list', 'text', 'number'],
		names: ['sg_difficulty', 'difficulty', 'sg_complexity', 'complexity', 'sg_tier', 'tier'],
		pattern: /difficult|complex|tier/i
	},
	{ slot: 'assets', label: 'Linked assets', line: 'The assets the shot uses.', dataTypes: ['multi_entity'], linksTo: 'Asset', names: ['assets'] }
];

const ASSET_SLOTS: readonly SlotSpec[] = [
	{ ...SHOT_SLOTS[0], line: 'What the asset is.' },
	{
		slot: 'type',
		label: 'Type',
		line: 'Character, prop, environment.',
		dataTypes: ['list', 'text'],
		names: ['sg_asset_type', 'asset_type', 'sg_type', 'type'],
		pattern: /type|category|kind/i
	},
	SHOT_SLOTS[5]
];

export function slotsFor(kind: ItemKind): readonly SlotSpec[] {
	return kind === 'shot' ? SHOT_SLOTS : ASSET_SLOTS;
}

function specOf(kind: ItemKind, slot: Slot): SlotSpec {
	const spec = slotsFor(kind).find((s) => s.slot === slot);
	if (!spec) throw new Error(`A ${kind} has no ${slot}.`);
	return spec;
}

function fits(spec: SlotSpec, field: FieldSchema): boolean {
	if (!spec.dataTypes.includes(field.dataType)) return false;
	if (spec.linksTo) return field.validTypes?.includes(spec.linksTo) ?? false;
	return true;
}

/** The fields that may fill a slot, by label. The episode adds its route through the Sequence. */
export function slotOptions(kind: ItemKind, slot: Slot, schema: Record<string, FieldSchema>, shape: SiteShape): FieldOption[] {
	const spec = specOf(kind, slot);
	const options = Object.values(schema)
		.filter((field) => fits(spec, field))
		.map((field) => ({ code: field.name, label: field.displayName || field.name }))
		.sort((a, b) => a.label.localeCompare(b.label) || a.code.localeCompare(b.code));
	if (kind === 'shot' && slot === 'episode' && shape.episodes && shape.sequenceEpisodeField) {
		const sequence = specOf('shot', 'sequence');
		if (Object.values(schema).some((field) => fits(sequence, field))) {
			options.push({ code: EPISODE_FROM_SEQUENCE, label: "The Sequence's Episode" });
		}
	}
	return options;
}

function guess(kind: ItemKind, spec: SlotSpec, schema: Record<string, FieldSchema>, shape: SiteShape): string | null {
	const offered = slotOptions(kind, spec.slot, schema, shape).map((o) => o.code);
	for (const name of spec.names) if (offered.includes(name)) return name;
	const byName = offered.find((code) => code !== 'code' && spec.pattern?.test(code));
	if (byName) return byName;
	// A link field is the right kind by its target alone; a text field is not.
	const direct = offered.filter((code) => code !== EPISODE_FROM_SEQUENCE);
	if (spec.linksTo && direct.length === 1) return direct[0];
	if (offered.includes(EPISODE_FROM_SEQUENCE)) return EPISODE_FROM_SEQUENCE;
	return null;
}

/** The default mapping: for each slot, the best named field on offer, or none. */
export function detectMapping(kind: ItemKind, schema: Record<string, FieldSchema>, shape: SiteShape): Mapping {
	return Object.fromEntries(slotsFor(kind).map((spec) => [spec.slot, guess(kind, spec, schema, shape)]));
}

/**
 * A saved mapping made fit for the schema read now: a pick still on offer stays, a slot saved empty
 * stays empty, anything else is detected again.
 */
export function cleanMapping(kind: ItemKind, saved: Mapping, schema: Record<string, FieldSchema>, shape: SiteShape): Mapping {
	const detected = detectMapping(kind, schema, shape);
	return Object.fromEntries(
		slotsFor(kind).map((spec) => {
			const pick = saved[spec.slot];
			if (pick === null) return [spec.slot, null];
			if (typeof pick === 'string' && slotOptions(kind, spec.slot, schema, shape).some((o) => o.code === pick)) return [spec.slot, pick];
			return [spec.slot, detected[spec.slot]];
		})
	);
}

/** Sequence's field linking an Episode: `episode` when the site has it, else the one entity field to Episode, else none. */
export function sequenceEpisodeField(sequenceSchema: Record<string, FieldSchema>): string | null {
	const links = Object.values(sequenceSchema).filter((field) => field.dataType === 'entity' && field.validTypes?.includes('Episode'));
	return links.find((field) => field.name === 'episode')?.name ?? (links.length === 1 ? links[0].name : null);
}

/** The fields a pick reads: the code, the thumbnail and the status when the type has them, then the mapping. */
export function readFields(kind: ItemKind, mapping: Mapping, schema: Record<string, FieldSchema>): string[] {
	const wanted = ['code', 'image', 'sg_status_list', ...slotsFor(kind).map((spec) => mapping[spec.slot])];
	return [...new Set(wanted.filter((name): name is string => typeof name === 'string' && name in schema))];
}
