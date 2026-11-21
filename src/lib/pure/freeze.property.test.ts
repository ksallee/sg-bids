import fc from 'fast-check';
import type { EntityRow } from 'sg-widgets-core';
import { describe, expect, it } from 'vitest';
import { freezeAsset, freezeShot } from './freeze';
import type { RequestShot } from './model';
import { refrozen } from './pick';

const STOCK = { description: 'description', frames: 'sg_cut_duration', sequence: 'sg_sequence', episode: null, type: 'sg_shot_type', difficulty: 'sg_difficulty', assets: 'assets' };

const textArb = fc.oneof(fc.string({ maxLength: 30 }), fc.constant(null), fc.integer());

/** A Shot as Flow PT answers it: scalars in `attributes`, links in `relationships`. */
const shotRowArb: fc.Arbitrary<EntityRow> = fc
	.record({
		id: fc.integer({ min: 1, max: 1e7 }),
		code: textArb,
		description: textArb,
		frames: fc.oneof(fc.nat({ max: 5000 }), fc.constant(null), fc.double()),
		type: textArb,
		difficulty: textArb,
		sequence: fc.option(fc.record({ type: fc.constant('Sequence'), id: fc.integer({ min: 1, max: 1e6 }), name: fc.option(fc.string({ maxLength: 20 })) })),
		assets: fc.array(fc.record({ type: fc.constantFrom('Asset', 'Shot'), id: fc.integer({ min: 1, max: 1e6 }) }), { maxLength: 4 })
	})
	.map(
		(r) =>
			({
				type: 'Shot',
				id: r.id,
				attributes: { code: r.code, description: r.description, sg_cut_duration: r.frames, sg_shot_type: r.type, sg_difficulty: r.difficulty },
				relationships: { sg_sequence: { data: r.sequence }, assets: { data: r.assets } }
			}) as unknown as EntityRow
	);

/** Every value of the row changed in place, as a later read of the site would. */
function changeInPlace(row: EntityRow): void {
	const r = row as unknown as { attributes: Record<string, unknown>; relationships: Record<string, { data: unknown }> };
	for (const key of Object.keys(r.attributes)) r.attributes[key] = `changed ${key}`;
	const sequence = r.relationships.sg_sequence.data as { name?: unknown } | null;
	if (sequence) sequence.name = 'SQ999';
	for (const a of r.relationships.assets.data as { id: number }[]) a.id += 1;
	(r.relationships.assets.data as unknown[]).push({ type: 'Asset', id: 424242 });
}

describe('a frozen copy, for any Flow PT row', () => {
	it('never follows a later change to its row', () => {
		fc.assert(
			fc.property(shotRowArb, fc.option(fc.integer({ min: 1, max: 500 }), { nil: undefined }), (row, position) => {
				const shot = freezeShot(row, STOCK, new Map(), position);
				const asset = freezeAsset(row, STOCK, position);
				const before = structuredClone({ shot, asset });
				changeInPlace(row);
				expect({ shot, asset }).toEqual(before);
			})
		);
	});

	it('is labelled by its code or its place, never by its Flow PT id', () => {
		fc.assert(
			fc.property(shotRowArb, fc.integer({ min: 1, max: 500 }), (row, position) => {
				const code = (row as unknown as { attributes: { code: unknown } }).attributes.code;
				const shot = freezeShot(row, STOCK, new Map(), position);
				expect(shot.code).toBe(typeof code === 'string' && code.trim() !== '' ? code : `Shot ${position}`);
			})
		);
	});

	it('keeps a breakdown row as typed whatever the site answers', () => {
		fc.assert(
			fc.property(fc.array(shotRowArb, { maxLength: 5 }), fc.string({ maxLength: 20 }), (rows, code) => {
				const typed: RequestShot = { id: 'bd-s0', code, omitted: false, assetIds: [], source: 'breakdown' };
				expect(refrozen([typed], rows, (r, p) => freezeShot(r, STOCK, new Map(), p))).toEqual([typed]);
			})
		);
	});
});
