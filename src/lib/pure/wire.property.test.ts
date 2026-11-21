import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { uuid } from './arbitraries';
import { CURRENCIES } from './currencies';
import type { RequestAsset, RequestHeader, RequestShot } from './model';
import { parseDraftSave, parseInvitationPackages, parseLinks, type DraftSaveInput } from './wire';

/** Over the wire and back, as the browser sends it. */
const overTheWire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** The body the draft store sends (`src/lib/drafts.ts`): each bid's rows under `items`. */
const body = (draft: DraftSaveInput) => ({ ...draft, bids: draft.bids!.map(({ shots, assets, ...b }) => ({ ...b, items: { shots, assets } })) });

const textArb = fc.string({ maxLength: 40 });
const trimmedArb = (min = 0) => fc.string({ minLength: min, maxLength: 40 }).map((s) => s.trim()).filter((s) => s.length >= min);
const dayArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2035-12-31'), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10));

const headerArb: fc.Arbitrary<RequestHeader> = fc.record(
	{
		code: textArb,
		title: textArb,
		project: textArb,
		studio: textArb,
		director: textArb,
		cutVersion: textArb,
		round: fc.integer({ min: 1, max: 20 }),
		dueDate: dayArb,
		deliveryDate: dayArb,
		baseCurrency: fc.constantFrom(...CURRENCIES.map((c) => c.code)),
		materialLink: fc.webUrl({ validSchemes: ['https'] }),
		assumptions: fc.array(textArb, { maxLength: 4 })
	},
	{ requiredKeys: ['project', 'round', 'baseCurrency', 'assumptions'] }
);

const shotArb = (i: number): fc.Arbitrary<RequestShot> =>
	fc.record(
		{
			id: fc.constant(`shot-${100 + i}`),
			code: textArb,
			fpt: fc.integer({ min: 1, max: 1e9 }).map((id) => ({ type: 'Shot', id })),
			source: fc.constant('breakdown' as const),
			description: textArb,
			sequence: textArb,
			episode: textArb,
			type: textArb,
			difficulty: textArb,
			notes: textArb,
			frames: fc.nat({ max: 10_000 }),
			cutCount: fc.nat({ max: 10 }),
			omitted: fc.boolean(),
			assetIds: fc.array(fc.constantFrom('asset-200', 'asset-201'), { maxLength: 2 })
		},
		{ requiredKeys: ['id', 'code', 'omitted', 'assetIds'] }
	);

const assetArb = (i: number): fc.Arbitrary<RequestAsset> =>
	fc.record(
		{
			id: fc.constant(`asset-${200 + i}`),
			name: textArb,
			fpt: fc.integer({ min: 1, max: 1e9 }).map((id) => ({ type: 'Asset', id })),
			description: textArb,
			type: textArb,
			omitted: fc.boolean()
		},
		{ requiredKeys: ['id', 'name'] }
	);

/** One to three bids, each with its own rows; one to three vendors, each invited to all or some. */
const draftArb: fc.Arbitrary<DraftSaveInput> = fc
	.record({
		header: headerArb,
		bids: fc.array(fc.record({ name: trimmedArb(), shots: fc.nat(3), assets: fc.nat(2) }), { minLength: 1, maxLength: 3 }),
		vendors: fc.array(fc.record({ name: trimmedArb(), email: trimmedArb(), group: fc.option(fc.record({ id: fc.integer({ min: 1, max: 1e6 }), name: trimmedArb() })), some: fc.option(fc.array(fc.boolean(), { minLength: 3, maxLength: 3 })) }), { maxLength: 3 })
	})
	.chain(({ header, bids, vendors }) => {
		let shot = 0;
		let asset = 0;
		const rows = bids.map((b) => ({ shots: Array.from({ length: b.shots }, () => shot++), assets: Array.from({ length: b.assets }, () => asset++) }));
		return fc
			.tuple(...rows.map((r) => fc.tuple(fc.tuple(...r.shots.map(shotArb)), fc.tuple(...r.assets.map(assetArb)))))
			.map((made): DraftSaveInput => {
				const saved = bids.map((b, i) => ({ key: `bid:${uuid(9, i)}`, name: `${b.name} ${i + 1}`.trim(), shots: [...made[i][0]], assets: [...made[i][1]] }));
				return {
					id: uuid(1, 0),
					header,
					bids: saved,
					vendors: vendors.map((v, j) => {
						const picked = v.some ? saved.filter((_, i) => v.some![i]).map((b) => b.key) : null;
						return { id: uuid(2, j), name: v.name, email: v.email, group: v.group, bids: picked && picked.length > 0 ? picked : null };
					})
				};
			});
	});

describe('a draft save, for any draft', () => {
	it('reads back what the page sent', () => {
		fc.assert(
			fc.property(draftArb, (draft) => {
				expect(parseDraftSave(overTheWire(body(draft)))).toEqual({ ok: true, value: draft });
			})
		);
	});

	it('passes no field the model lacks, and no project from the body', () => {
		fc.assert(
			fc.property(draftArb, fc.integer({ min: 1, max: 1e6 }), (draft, project) => {
				const sent = body(draft);
				const tampered = {
					...sent,
					projectId: project,
					siteHost: 'other.shotgrid.autodesk.com',
					header: { ...draft.header, projectRef: { type: 'Project', id: project }, vendorName: 'Rival' },
					bids: sent.bids.map((b) => ({
						...b,
						owner: 'someone',
						items: {
							shots: b.items.shots.map((s) => ({ ...s, thumbnail: 'https://x.test/t.jpg', techRequirements: { Comp: 'x' }, vendorId: uuid(2, 9), package: b.key })),
							assets: b.items.assets.map((a) => ({ ...a, groupId: 38 }))
						}
					})),
					vendors: draft.vendors!.map((v) => ({ ...v, token: 'secret' }))
				};
				// Bid rows go under their bid: a package named in the body is dropped too.
				expect(parseDraftSave(overTheWire(tampered))).toEqual({ ok: true, value: draft });
			})
		);
	});

	it('refuses a draft broken in any one way', () => {
		type Body = ReturnType<typeof body>;
		const breaks: ((d: Body) => unknown)[] = [
			(d) => ({ ...d, id: 'not-a-uuid' }),
			(d) => ({ ...d, header: { ...d.header, round: 0 } }),
			(d) => ({ ...d, header: { ...d.header, baseCurrency: 'XXX' } }),
			(d) => ({ ...d, header: { ...d.header, materialLink: 'javascript:alert(1)' } }),
			(d) => ({ ...d, bids: [] }),
			(d) => ({ ...d, bids: [...d.bids, { ...d.bids[0], name: `${d.bids[0].name}x` }] }),
			(d) => ({ ...d, bids: [...d.bids, { ...d.bids[0], key: 'bid:other', name: d.bids[0].name.toUpperCase(), items: { shots: [], assets: [] } }] }),
			(d) => ({ ...d, bids: d.bids.map((b) => ({ ...b, items: { ...b.items, shots: [...b.items.shots, { id: '', code: 'X', omitted: false, assetIds: [] }] } })) }),
			(d) => ({ ...d, vendors: [{ id: uuid(2, 0), name: 'V', email: 'v@x.test', group: null, bids: ['bid:not-in-the-draft'] }] }),
			(d) => ({ ...d, vendors: [{ id: 'v1', name: 'V', email: 'v@x.test', group: null, bids: null }] })
		];
		fc.assert(
			fc.property(draftArb, fc.constantFrom(...breaks), (draft, broken) => {
				expect(parseDraftSave(overTheWire(broken(body(draft))))).toMatchObject({ ok: false });
			})
		);
	});
});

describe('links and invitations, for any body', () => {
	const linksArb = fc.uniqueArray(fc.record({ kind: fc.constantFrom('shot' as const, 'asset' as const), key: fc.string({ minLength: 1, maxLength: 200 }), id: fc.integer({ min: 1, max: 1e9 }) }), {
		minLength: 1,
		maxLength: 20,
		selector: (l) => `${l.kind}:${l.key}`
	});

	it('reads back the rows to link that the page sent', () => {
		fc.assert(
			fc.property(linksArb, (links) => {
				const body = { requestId: uuid(1, 0), links: links.map((l) => ({ kind: l.kind, key: l.key, fpt: { type: l.kind === 'shot' ? 'Shot' : 'Asset', id: l.id } })) };
				expect(parseLinks(overTheWire(body))).toEqual({ ok: true, value: body });
			})
		);
	});

	it('refuses a link to a row of the other kind', () => {
		fc.assert(
			fc.property(linksArb, (links) => {
				const body = { requestId: uuid(1, 0), links: links.map((l) => ({ kind: l.kind, key: l.key, fpt: { type: l.kind === 'shot' ? 'Asset' : 'Shot', id: l.id } })) };
				expect(parseLinks(overTheWire(body))).toMatchObject({ ok: false });
			})
		);
	});

	it('reads back an invitation’s bids, every bid or one each, at least one', () => {
		const keysArb = fc.option(fc.uniqueArray(fc.string({ minLength: 1, maxLength: 200 }), { minLength: 1, maxLength: 10 }));
		fc.assert(
			fc.property(keysArb, (packages) => {
				const body = { invitationId: uuid(5, 0), packages };
				expect(parseInvitationPackages(overTheWire(body))).toEqual({ ok: true, value: body });
				if (packages) expect(parseInvitationPackages({ ...body, packages: [...packages, packages[0]] })).toMatchObject({ ok: false });
			})
		);
	});
});
