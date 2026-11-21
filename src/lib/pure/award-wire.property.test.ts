import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { apply, AWARD_SITE, awardInput, uuid, worldArb } from './arbitraries';
import { parseAwardRecord, parseSite, parseWritten } from './award-wire';
import { planAward, type Written } from './fpt-award';

const overTheWire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** What a publish wrote, for any request, answers and scenario, with the rows it created. */
const writtenArb: fc.Arbitrary<Written> = fc
	.tuple(worldArb(), fc.boolean(), fc.array(fc.tuple(fc.constantFrom('Shot' as const, 'Asset' as const, 'Sequence' as const), fc.integer({ min: 1, max: 1e9 })), { maxLength: 4 }))
	.map(([world, allLines, made]) => {
		const { written } = apply(planAward(awardInput(world, allLines)));
		const items = made.map(([type, id], i) => ({ key: type === 'Sequence' ? `sequence:sq${i}0` : `${type.toLowerCase()}:${type === 'Shot' ? 'shot' : 'asset'}-${i}`, type, id }));
		return items.length > 0 ? { ...written, items } : written;
	});

describe('what a publish wrote, for any award', () => {
	it('reads back exactly what the page sent', () => {
		fc.assert(
			fc.property(writtenArb, (written) => {
				expect(parseWritten(overTheWire(written))).toEqual(written);
			})
		);
	});

	it('passes no field the record lacks', () => {
		fc.assert(
			fc.property(writtenArb, (written) => {
				const extra = { note: 'x', siteHost: 'other.test' };
				const tampered = {
					...written,
					...extra,
					bids: written.bids.map((r) => ({ ...r, ...extra })),
					lines: written.lines.map((r) => ({ ...r, ...extra })),
					groups: written.groups.map((g) => ({ ...g, ...extra })),
					attachments: written.attachments.map((a) => ({ ...a, ...extra }))
				};
				expect(parseWritten(overTheWire(tampered))).toEqual(written);
			})
		);
	});

	it('refuses a record with any one row not of the app’s making', () => {
		const breaks: ((w: Written) => unknown)[] = [
			(w) => ({ ...w, bids: [...w.bids, { key: 'sgbids/req1/v1/r1', id: 5, created: true }] }),
			(w) => ({ ...w, lines: [...w.lines, { key: `sgbids/${uuid(1, 0)}/${uuid(2, 0)}/r1/shot:has space`, id: 5, created: true }] }),
			(w) => ({ ...w, bids: [...w.bids, { key: `sgbids/${uuid(1, 0)}/${uuid(2, 0)}/r1`, id: 0, created: true }] }),
			(w) => ({ ...w, groups: [...w.groups, { itemType: 'Sequence', id: 3, field: 'sg_vendor_groups', groups: [38] }] }),
			(w) => ({ ...w, groups: [...w.groups, { itemType: 'Shot', id: 3, field: 'sg_vendor_groups; drop', groups: [38] }] }),
			(w) => ({ ...w, items: [{ key: 'asset:a1', type: 'Shot', id: 3 }] })
		];
		fc.assert(
			fc.property(writtenArb, fc.constantFrom(...breaks), (written, broken) => {
				expect(parseWritten(overTheWire(broken(written)))).toBeNull();
			})
		);
	});
});

describe('the site’s names and an award record, for any project', () => {
	const projectArb = fc.integer({ min: 1, max: 1e7 });

	it('reads back the site for its own project, and nothing for another', () => {
		fc.assert(
			fc.property(projectArb, projectArb, (project, other) => {
				const site = { ...AWARD_SITE, projectId: project };
				expect(parseSite(overTheWire(site), project)).toEqual(site);
				if (other !== project) expect(parseSite(overTheWire(site), other)).toBeNull();
			})
		);
	});

	it('refuses a record whose site is another project’s', () => {
		fc.assert(
			fc.property(writtenArb, projectArb, projectArb, (written, project, other) => {
				const record = {
					requestId: uuid(1, 0),
					scenarioId: uuid(4, 0),
					state: 'published',
					site: { ...AWARD_SITE, projectId: project },
					written,
					options: { allLines: false, groups: {} },
					problems: [],
					error: null,
					exposure: null,
					byName: null
				};
				expect(parseAwardRecord(overTheWire(record) as Record<string, unknown>, project)).toMatchObject({ ok: true, value: { written } });
				if (other !== project) expect(parseAwardRecord(overTheWire(record) as Record<string, unknown>, other)).toMatchObject({ ok: false });
			})
		);
	});
});
