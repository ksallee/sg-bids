/**
 * A counted row at the award: never created, a Bid Line with its amount (unit price times count)
 * and its count, in its name always and in Bid Line's optional Count field when the site has it.
 * A row of count 1 plans exactly as before.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { gate, siteOf } from './award-gate';
import { asset, bid, line, onAsset, onShot, request, shot } from './fixtures';
import { bidKey, lineKey, packageBidKey, planAward, toLookUp, type AwardInput, type FptSite, type Write } from './fpt-award';
import { BID_FIELDS, LINE_FIELDS, linkTypes, type FieldSpec } from './fpt-fields';
import { fieldsToCreate, setupReport, type SetupInput } from './fpt-setup';
import type { AwardScenario, BidRequest, InvitedVendor, VendorBid } from './model';
import { money } from './money';

const SITE: FptSite = {
	projectId: 1180,
	bidType: 'CustomEntity14',
	lineType: 'CustomEntity15',
	vendorField: { Shot: 'sg_vendor_groups', Asset: 'sg_vendor_groups' },
	statuses: { draft: 'wtg', submitted: 'ip', awarded: 'fin' }
};
const vendor = (id: string, name: string, group: number): InvitedVendor => ({ id, name, email: `${id}@x.test`, ndaExecuted: true, fpt: { type: 'Group', id: group } });

const REQUEST = request({
	id: 'req1',
	shots: [shot('sh010', { fpt: { type: 'Shot', id: 101 } }), shot('shot-bd-1', { code: 'SIMPLE', source: 'breakdown', count: 120, frames: 80 })],
	assets: [asset('asset-bd-1', { name: 'props', source: 'breakdown', count: 12 })],
	vendors: [vendor('va', 'Vendor A', 38)]
});
const A = bid({
	id: 'bidA',
	vendorId: 'va',
	currency: 'USD',
	number: '1',
	lines: [
		line('a1', onShot('sh010'), money(90_000, 'USD')),
		line('a2', onShot('shot-bd-1'), money(18_000_000, 'USD'), { unit: money(150_000, 'USD') }),
		line('a3', onAsset('asset-bd-1'), money(300_000, 'USD'), { unit: money(25_000, 'USD') })
	]
});
const SC: AwardScenario = {
	id: 'sc1',
	requestId: 'req1',
	name: 'count',
	picks: [
		{ target: onShot('sh010'), shares: [{ bidId: 'bidA', percent: '100' }] },
		{ target: onShot('shot-bd-1'), shares: [{ bidId: 'bidA', percent: '100' }] },
		{ target: onAsset('asset-bd-1'), shares: [{ bidId: 'bidA', percent: '100' }] }
	]
};
const input = (extra: Partial<AwardInput> = {}): AwardInput => ({
	request: REQUEST,
	bids: [A],
	scenario: SC,
	options: { date: '2026-11-20', requestCode: 'RQ-1', missing: { shot: 'create', asset: 'create' } },
	site: SITE,
	existing: { bids: [], lines: [], groups: {}, sequences: [], codes: { Shot: [], Asset: [] } },
	...extra
});
const writes = (plan: ReturnType<typeof planAward>) => plan.steps.flatMap((s) => s.writes);
const lineData = (plan: ReturnType<typeof planAward>, target: Parameters<typeof lineKey>[1]) =>
	(writes(plan).find((w) => w.kind === 'create' && w.entity === 'line' && w.key === lineKey(bidKey('req1', 'va', 1), target)) as Extract<Write, { kind: 'create' }>).data;

describe('a counted row at the award', () => {
	it('creates no Shot or Asset, even with create on: it lands as a Bid Line with no item, its amount the line total', () => {
		const plan = planAward(input());
		expect(writes(plan).filter((w) => w.kind === 'createItem')).toEqual([]);
		expect(plan.preview.created).toEqual([]);
		const simple = lineData(plan, onShot('shot-bd-1'));
		expect(simple).toMatchObject({ code: 'SIMPLE x120 Vendor A', sg_item: null, sg_amount: '180000.00', sg_awarded: true });
		expect(lineData(plan, onAsset('asset-bd-1'))).toMatchObject({ code: 'props x12 Vendor A', sg_item: null, sg_amount: '3000.00' });
		expect(lineData(plan, onShot('sh010'))).toMatchObject({ code: 'SH010 Vendor A', sg_item: { type: 'Shot', id: 101 } });
		expect(plan.preview.unlinked).toEqual([
			{ item: 'SIMPLE', kind: 'shot', count: 120 },
			{ item: 'props', kind: 'asset', count: 12 }
		]);
	});

	it('shows its count and unit price in the preview, and the Bid total is its lines summed exactly', () => {
		const plan = planAward(input());
		const simple = plan.preview.lines.find((l) => l.item === 'SIMPLE')!;
		expect(simple).toMatchObject({ count: 120, unit: money(150_000, 'USD'), amount: money(18_000_000, 'USD') });
		expect(plan.preview.lines.find((l) => l.item === 'SH010')).toMatchObject({ count: 1, unit: null });
		expect(plan.preview.bids[0].total).toEqual(money(18_390_000, 'USD'));
		const sum = plan.preview.lines.reduce((n, l) => n + (l.amount?.minor ?? 0), 0);
		expect(sum).toBe(plan.preview.bids[0].total.minor);
	});

	it('writes no Count on a site without the field, and says the count is in the name alone', () => {
		const plan = planAward(input());
		expect(writes(plan).some((w) => (w.kind === 'create' || w.kind === 'update') && LINE_FIELDS.find((f) => f.key === 'count')!.name in w.data)).toBe(false);
		expect(plan.warnings).toContain('The site has no Count field on Bid Line. The 2 counted rows carry their count in the Bid Line name alone. Create the field to write it.');
	});

	it('writes the count on every line of a site with the field, 1 for a Flow PT row', () => {
		const plan = planAward(input({ site: { ...SITE, lineCount: true } }));
		expect(lineData(plan, onShot('shot-bd-1')).sg_count).toBe(120);
		expect(lineData(plan, onAsset('asset-bd-1')).sg_count).toBe(12);
		expect(lineData(plan, onShot('sh010')).sg_count).toBe(1);
		expect(plan.warnings.some((w) => w.includes('Count field'))).toBe(false);
	});

	it('is not looked up for a code collision: nothing is created for it', () => {
		const { existing: _, ...rest } = input();
		expect(toLookUp(rest)).toEqual({ Shot: [], Asset: [], sequences: [] });
	});

	it('asks no choice at the gate, and needs no vendor field', () => {
		const counted = request({ id: 'req1', shots: [shot('shot-bd-1', { code: 'SIMPLE', source: 'breakdown', count: 120 })], vendors: [vendor('va', 'Vendor A', 38)] });
		const scenario: AwardScenario = { ...SC, picks: [SC.picks[1]] };
		const g = gate({ projectId: 1180, report: null, request: counted, bids: [A], scenario, allLines: false, groups: {}, exposureAccepted: false });
		expect(g.missing.shot).toEqual({ labels: [], choice: null });
		expect(g.problems.map((p) => p.target)).toEqual(['gate-site']);
	});
});

describe('count 1 at the award is as before (differential and properties)', () => {
	const unitArb = fc.integer({ min: 0, max: 50_000_000 });
	const countArb = fc.integer({ min: 1, max: 2000 });
	const rowsArb = fc.array(fc.record({ unit: unitArb, count: countArb, pkg: fc.constantFrom('p1', 'p2') }), { minLength: 1, maxLength: 8 });

	function build(rows: { unit: number; count: number; pkg: string }[], counts: 'absent' | 'one' | 'own'): { request: BidRequest; bid: VendorBid; scenario: AwardScenario } {
		const req = request({
			id: 'req1',
			packages: [
				{ id: 'p1', name: 'Simple' },
				{ id: 'p2', name: 'Hard' }
			],
			shots: rows.map((r, i) => shot(`bd-${i}`, { source: 'breakdown', package: r.pkg, ...(counts === 'one' ? { count: 1 } : counts === 'own' && r.count > 1 ? { count: r.count } : {}) })),
			vendors: [vendor('va', 'Vendor A', 38)]
		});
		const n = (r: { count: number }) => (counts === 'own' ? r.count : 1);
		const b = bid({
			id: 'bidA',
			vendorId: 'va',
			currency: 'USD',
			number: '1',
			lines: rows.map((r, i) => line(`l${i}`, onShot(`bd-${i}`), money(r.unit * n(r), 'USD'), n(r) > 1 ? { unit: money(r.unit, 'USD') } : {}))
		});
		const scenario: AwardScenario = { id: 's', requestId: 'req1', name: 's', picks: rows.map((_, i) => ({ target: onShot(`bd-${i}`), shares: [{ bidId: 'bidA', percent: '100' }] })) };
		return { request: req, bid: b, scenario };
	}
	const plan = (built: ReturnType<typeof build>, site: FptSite = SITE) =>
		planAward({ ...input({ site }), request: built.request, bids: [built.bid], scenario: built.scenario, options: { date: '2026-11-20', requestCode: 'RQ-1', missing: { shot: 'without', asset: 'without' } } });

	it('a count of 1 plans the same writes as a row with no count', () => {
		fc.assert(
			fc.property(rowsArb, (rows) => {
				expect(plan(build(rows, 'one'))).toEqual(plan(build(rows, 'absent')));
			})
		);
	});

	it('each Bid total is its lines summed, and the Bids sum to the grand total, in minor units', () => {
		fc.assert(
			fc.property(rowsArb, (rows) => {
				const built = build(rows, 'own');
				const p = plan(built, { ...SITE, lineCount: true });
				for (const b of p.preview.bids) {
					const lines = p.preview.lines.filter((l) => l.key.startsWith(`${b.key}/`));
					expect(lines.reduce((n, l) => n + BigInt(l.amount?.minor ?? 0), 0n)).toBe(BigInt(b.total.minor));
				}
				const grand = rows.reduce((n, r) => n + BigInt(r.unit) * BigInt(r.count), 0n);
				expect(p.preview.bids.reduce((n, b) => n + BigInt(b.total.minor), 0n)).toBe(grand);
				for (const l of p.preview.lines) {
					const row = rows[Number(l.target.split('bd-')[1])];
					expect(l.count).toBe(row.count);
					if (row.count > 1) expect(l.unit).toEqual(money(row.unit, 'USD'));
				}
				expect(p.preview.bids.map((b) => b.key).every((k) => k.startsWith(packageBidKey(bidKey('req1', 'va', 1), '')))).toBe(true);
			})
		);
	});
});

describe('the Count field in the setup', () => {
	const complete = (fields: readonly FieldSpec[]) =>
		Object.fromEntries(fields.map((f) => [f.name, f.validTypes ? { dataType: f.dataType, validTypes: linkTypes(f.validTypes, 'CustomEntity14') } : { dataType: f.dataType }]));
	const ITEM = { code: { dataType: 'text' }, sg_vendor_groups: { dataType: 'multi_entity', validTypes: ['Group'] } };
	const types = [
		{ name: 'Shot', displayName: 'Shot' },
		{ name: 'Asset', displayName: 'Asset' },
		{ name: 'Group', displayName: 'Group' },
		{ name: 'CustomEntity14', displayName: 'Bid' },
		{ name: 'CustomEntity15', displayName: 'Bid Line' }
	];
	const without = complete(LINE_FIELDS.filter((f) => f.key !== 'count'));
	const input = (line: Record<string, unknown>): SetupInput => ({
		entityTypes: types,
		fields: { CustomEntity14: complete(BID_FIELDS), CustomEntity15: line as SetupInput['fields'][string], Shot: ITEM, Asset: ITEM },
		vendorGroup: 'vendor',
		rights: {}
	});

	it('is a number field named sg_count, optional', () => {
		expect(LINE_FIELDS.find((f) => f.key === 'count')).toMatchObject({ name: 'sg_count', display: 'Count', dataType: 'number', optional: true });
	});

	it('missing, leaves a site set up before counts ready, and is in the create plan', () => {
		const report = setupReport(input(without));
		expect(report.ready).toBe(true);
		expect(report.fields.find((f) => f.spec.key === 'count' && f.entity === 'line')?.state).toBe('missing');
		const plan = fieldsToCreate(report, types);
		expect(plan.creates).toEqual([
			{
				entity: 'line',
				entityType: 'CustomEntity15',
				name: 'sg_count',
				body: {
					data_type: 'number',
					properties: [
						{ property_name: 'name', value: 'Count' },
						{ property_name: 'description', value: 'Written by sg-bids. How many shots or assets the line stands for. 1 for a Shot or Asset of Flow PT.' }
					]
				}
			}
		]);
		expect(siteOf(report, 1180)?.lineCount).toBe(false);
	});

	it('of another type is a problem, never ready', () => {
		const report = setupReport(input({ ...without, sg_count: { dataType: 'text' } }));
		expect(report.ready).toBe(false);
		expect(report.risks.some((r) => r.includes('sg_count is a text field'))).toBe(true);
	});

	it('present, is written by the award', () => {
		expect(siteOf(setupReport(input(complete(LINE_FIELDS))), 1180)?.lineCount).toBe(true);
	});
});
