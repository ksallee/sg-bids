/**
 * The award for rows with no Flow PT row: create them first and link the Bid Lines and Groups to
 * them, or publish their Bid Lines with no item. Code collisions are caught, earlier runs reused,
 * and the undo retires only what a publish created.
 */
import { describe, expect, it } from 'vitest';
import { asset, bid, line, onAsset, onShot, request, shot } from './fixtures';
import { bidKey, isClean, lineKey, mergeWritten, NOTHING_WRITTEN, planAward, planUndo, toBatchRequest, toLookUp, verify, type AwardInput, type Existing, type FptSite, type ReadRow, type Write, type Written } from './fpt-award';
import type { AwardScenario, InvitedVendor } from './model';
import { money } from './money';

const SITE: FptSite = {
	projectId: 1180,
	bidType: 'CustomEntity14',
	lineType: 'CustomEntity15',
	vendorField: { Shot: 'sg_vendor_groups', Asset: 'sg_vendor_groups' },
	statuses: { draft: 'wtg', submitted: 'ip', awarded: 'fin' }
};
const vendor = (id: string, name: string, group: number): InvitedVendor => ({ id, name, email: `${id}@x.test`, ndaExecuted: true, fpt: { type: 'Group', id: group } });

const BD_REQUEST = request({
	id: 'req1',
	shots: [
		shot('sh010', { fpt: { type: 'Shot', id: 101 } }),
		shot('shot-bd-1', { code: 'zzsgbids_SH900', source: 'breakdown', description: 'Dragon lands', frames: 120, sequence: 'SQ010', difficulty: 'Hero', type: 'CG', episode: 'EP1' }),
		shot('shot-bd-2', { code: 'zzsgbids_SH910', source: 'breakdown', sequence: 'sq_new' })
	],
	assets: [asset('asset-bd-1', { name: 'zzsgbids_Banner', source: 'breakdown', type: 'Prop' })],
	vendors: [vendor('va', 'Vendor A', 38), vendor('vb', 'Vendor B', 39)]
});
const A = bid({
	id: 'bidA',
	vendorId: 'va',
	currency: 'USD',
	number: '1',
	lines: [line('a1', onShot('sh010'), money(1000, 'USD')), line('a2', onShot('shot-bd-1'), money(2000, 'USD')), line('a3', onAsset('asset-bd-1'), money(500, 'USD'))]
});
const B = bid({ id: 'bidB', vendorId: 'vb', currency: 'USD', number: '1', lines: [line('b1', onShot('shot-bd-2'), money(3000, 'USD'))] });
const SC: AwardScenario = {
	id: 'sc1',
	requestId: 'req1',
	name: 'bd',
	picks: [
		{ target: onShot('sh010'), shares: [{ bidId: 'bidA', percent: '100' }] },
		{ target: onShot('shot-bd-1'), shares: [{ bidId: 'bidA', percent: '100' }] },
		{ target: onShot('shot-bd-2'), shares: [{ bidId: 'bidB', percent: '100' }] },
		{ target: onAsset('asset-bd-1'), shares: [{ bidId: 'bidA', percent: '100' }] }
	]
};
const FIELDS: AwardInput['createFields'] = {
	shot: {
		description: { name: 'description', dataType: 'text' },
		frames: { name: 'sg_cut_duration', dataType: 'number' },
		difficulty: { name: 'sg_difficulty', dataType: 'list', validValues: ['Simple', 'Hero'] },
		type: { name: 'sg_shot_type', dataType: 'list', validValues: ['VFX'] },
		sequence: 'sg_sequence'
	},
	asset: { type: { name: 'sg_asset_type', dataType: 'list', validValues: ['Prop'] } }
};
const EXISTING: Existing = { bids: [], lines: [], groups: {}, sequences: [{ id: 301, code: 'SQ010' }], codes: { Shot: [], Asset: [] } };
const PROJECT = { type: 'Project', id: 1180 };
const KEY_A = bidKey('req1', 'va', 1);

function bdInput(extra: Partial<AwardInput> = {}, missing: AwardInput['options']['missing'] = { shot: 'create', asset: 'create' }): AwardInput {
	return {
		request: BD_REQUEST,
		bids: [A, B],
		scenario: SC,
		options: { date: '2026-11-20', requestCode: 'RQ-1', missing },
		site: SITE,
		existing: EXISTING,
		createFields: FIELDS,
		...extra
	};
}
const P = (key: string) => ({ pendingRow: key });
const creates = (plan: ReturnType<typeof planAward>) =>
	plan.steps
		.flatMap((s) => s.writes)
		.filter((w): w is Extract<Write, { kind: 'createItem' }> => w.kind === 'createItem')
		.map((w) => w.key);

describe('planAward, rows with no Flow PT row', () => {
	it('creates the missing Shots and Assets first, from the rows, under a Sequence the project has', () => {
		const plan = planAward(bdInput());
		expect(plan.steps.map((s) => s.label)).toEqual(['Shots and Assets', 'Bids', 'Bid Lines and vendor Groups']);
		expect(plan.steps[0].writes).toEqual([
			{
				kind: 'createItem',
				itemType: 'Shot',
				key: 'shot:shot-bd-1',
				data: { project: PROJECT, code: 'zzsgbids_SH900', description: 'Dragon lands', sg_cut_duration: 120, sg_difficulty: 'Hero', sg_sequence: { type: 'Sequence', id: 301 } }
			},
			{ kind: 'createItem', itemType: 'Shot', key: 'shot:shot-bd-2', data: { project: PROJECT, code: 'zzsgbids_SH910' } },
			{ kind: 'createItem', itemType: 'Asset', key: 'asset:asset-bd-1', data: { project: PROJECT, code: 'zzsgbids_Banner', sg_asset_type: 'Prop' } }
		]);
		expect(plan.warnings).toEqual(
			expect.arrayContaining([
				"zzsgbids_SH900: Type 'CG' is not a value of sg_shot_type. It is left empty on the new Shot.",
				'zzsgbids_SH910: the Sequence sq_new is not in the project. The new Shot has no Sequence.',
				'Episode is not written on a new Shot. Set it in Flow PT.'
			])
		);
		expect(plan.preview.created.map((c) => [c.item, c.type, c.sequence])).toEqual([
			['zzsgbids_SH900', 'Shot', 'SQ010'],
			['zzsgbids_SH910', 'Shot', null],
			['zzsgbids_Banner', 'Asset', null]
		]);
		expect(plan.collisions).toEqual([]);
	});

	it('links the Bid Lines and the vendor Groups to the rows it creates', () => {
		const plan = planAward(bdInput());
		const writes = plan.steps[2].writes;
		const l = writes.find((w) => w.kind === 'create' && w.key === lineKey(KEY_A, onShot('shot-bd-1'))) as Extract<Write, { kind: 'create' }>;
		expect(l.data.sg_item).toEqual(P('shot:shot-bd-1'));
		expect(writes.filter((w) => w.kind === 'addGroups')).toEqual([
			{ kind: 'addGroups', itemType: 'Shot', id: 101, field: 'sg_vendor_groups', groups: [38] },
			{ kind: 'addGroups', itemType: 'Shot', id: P('shot:shot-bd-1'), field: 'sg_vendor_groups', groups: [38] },
			{ kind: 'addGroups', itemType: 'Shot', id: P('shot:shot-bd-2'), field: 'sg_vendor_groups', groups: [39] },
			{ kind: 'addGroups', itemType: 'Asset', id: P('asset:asset-bd-1'), field: 'sg_vendor_groups', groups: [38] }
		]);
	});

	it('creates a missing Sequence only when asked, in its own step before the Shots', () => {
		const plan = planAward(bdInput({}, { shot: 'create', asset: 'create', sequences: true }));
		expect(plan.steps.map((s) => s.label)).toEqual(['Sequences', 'Shots and Assets', 'Bids', 'Bid Lines and vendor Groups']);
		expect(plan.steps[0].writes).toEqual([{ kind: 'createItem', itemType: 'Sequence', key: 'sequence:sq_new', data: { project: PROJECT, code: 'sq_new' } }]);
		const second = plan.steps[1].writes[1] as Extract<Write, { kind: 'createItem' }>;
		expect(second.data.sg_sequence).toEqual(P('sequence:sq_new'));
		expect(plan.preview.sequences).toEqual([{ key: 'sequence:sq_new', code: 'sq_new' }]);
	});

	it('publishes without them when told: their Bid Lines carry no item and no Group is added, said plainly', () => {
		const plan = planAward(bdInput({}, { shot: 'without', asset: 'without' }));
		expect(plan.steps.map((s) => s.label)).toEqual(['Bids', 'Bid Lines and vendor Groups']);
		const lines = plan.steps[1].writes.filter((w) => w.kind === 'create') as Extract<Write, { kind: 'create' }>[];
		expect(lines.map((l) => l.data.sg_item)).toEqual([{ type: 'Shot', id: 101 }, null, null, null]);
		expect(plan.steps[1].writes.filter((w) => w.kind === 'addGroups')).toHaveLength(1);
		expect(plan.preview.unlinked).toEqual([
			{ item: 'zzsgbids_SH900', kind: 'shot' },
			{ item: 'zzsgbids_SH910', kind: 'shot' },
			{ item: 'zzsgbids_Banner', kind: 'asset' }
		]);
		expect(plan.warnings).toContain('3 Bid Lines are written with no Shot or Asset: zzsgbids_SH900, zzsgbids_SH910 and zzsgbids_Banner. No Group is added for them.');
	});

	it('refuses to guess when no choice is made for a kind', () => {
		expect(() => planAward(bdInput({}, { asset: 'create' }))).toThrow('The shot zzsgbids_SH900 has no Flow PT Shot. Create it, publish without it, or match it first.');
	});

	it('catches a code Flow PT already holds, in any case, and two rows with one code, and creates neither', () => {
		const existing: Existing = { ...EXISTING, codes: { Shot: [{ id: 999, code: 'ZZSGBIDS_sh900' }], Asset: [] } };
		const twin = { ...BD_REQUEST, assets: [...BD_REQUEST.assets, asset('asset-bd-2', { name: 'ZZSGBIDS_banner', source: 'breakdown' })] };
		const twinA = { ...A, lines: [...A.lines, line('a4', onAsset('asset-bd-2'), money(10, 'USD'))] };
		const sc = { ...SC, picks: [...SC.picks, { target: onAsset('asset-bd-2'), shares: [{ bidId: 'bidA', percent: '100' }] }] };
		const plan = planAward(bdInput({ existing, request: twin, bids: [twinA, B], scenario: sc }));
		expect(plan.collisions).toEqual([
			{ item: 'zzsgbids_SH900', kind: 'shot', code: 'zzsgbids_SH900', found: [{ type: 'Shot', id: 999, code: 'ZZSGBIDS_sh900' }], twice: false },
			{ item: 'zzsgbids_Banner', kind: 'asset', code: 'zzsgbids_Banner', found: [], twice: true },
			{ item: 'ZZSGBIDS_banner', kind: 'asset', code: 'ZZSGBIDS_banner', found: [], twice: true }
		]);
		expect(creates(plan)).toEqual(['shot:shot-bd-2']);
	});

	it('uses what an earlier run created instead of creating it again', () => {
		const previous: Written = { ...NOTHING_WRITTEN, items: [{ key: 'shot:shot-bd-1', type: 'Shot', id: 777 }] };
		const existing: Existing = { ...EXISTING, codes: { Shot: [{ id: 777, code: 'zzsgbids_SH900' }], Asset: [] } };
		const plan = planAward(bdInput({ previous, existing }));
		expect(creates(plan)).toEqual(['shot:shot-bd-2', 'asset:asset-bd-1']);
		expect(plan.collisions).toEqual([]);
		const l = plan.steps.flatMap((s) => s.writes).find((w) => w.kind === 'create' && w.key.endsWith('shot:shot-bd-1')) as Extract<Write, { kind: 'create' }>;
		expect(l.data.sg_item).toEqual({ type: 'Shot', id: 777 });
	});

	it('takes back a row an earlier run created that no pick needs now, unless it gained links', () => {
		const previous: Written = {
			...NOTHING_WRITTEN,
			items: [
				{ key: 'shot:shot-gone', type: 'Shot', id: 800 },
				{ key: 'shot:shot-used', type: 'Shot', id: 801 }
			]
		};
		const plan = planAward(bdInput({ previous, existing: { ...EXISTING, itemLinks: new Map([['Shot:801', 'it has 2 Tasks']]) } }));
		expect(plan.steps[0]).toEqual({ label: 'Take back what the scenario dropped', mode: 'batch', writes: [{ kind: 'delete', entity: 'item', itemType: 'Shot', key: 'shot:shot-gone', id: 800 }] });
		expect(plan.preview.removed.items).toEqual([{ key: 'shot:shot-gone', type: 'Shot', id: 800 }]);
		expect(plan.warnings).toContain('Shot 801, created by an earlier publish, is no longer awarded and stays in Flow PT: it has 2 Tasks.');
	});

	it('sends a create and puts the new rows in what comes after', () => {
		const plan = planAward(bdInput());
		const rows = new Map([
			['shot:shot-bd-1', { type: 'Shot', id: 9001 }],
			['shot:shot-bd-2', { type: 'Shot', id: 9002 }],
			['asset:asset-bd-1', { type: 'Asset', id: 9003 }]
		]);
		expect(toBatchRequest(plan.steps[0].writes[0], SITE, new Map(), rows)).toEqual({
			request_type: 'create',
			entity: 'Shot',
			data: { project: PROJECT, code: 'zzsgbids_SH900', description: 'Dragon lands', sg_cut_duration: 120, sg_difficulty: 'Hero', sg_sequence: { type: 'Sequence', id: 301 } }
		});
		const bidIds = new Map([
			[KEY_A, 5001],
			[bidKey('req1', 'vb', 1), 5002]
		]);
		const group = plan.steps[2].writes.find((w) => w.kind === 'addGroups' && typeof w.id !== 'number')!;
		expect(toBatchRequest(group, SITE, bidIds, rows)).toMatchObject({ request_type: 'update', entity: 'Shot', record_id: 9001 });
		const l = plan.steps[2].writes.find((w) => w.kind === 'create' && w.key.endsWith('shot:shot-bd-1'))!;
		expect((toBatchRequest(l, SITE, bidIds, rows) as { data: Record<string, unknown> }).data.sg_item).toEqual({ type: 'Shot', id: 9001 });
		expect(() => toBatchRequest(l, SITE, bidIds, new Map())).toThrow('The new row shot:shot-bd-1 has no id yet.');
	});

	it('checks each created row on the read-back', () => {
		const plan = planAward(bdInput({ scenario: { ...SC, picks: [SC.picks[1]] }, bids: [{ ...A, lines: [A.lines[1]] }] }));
		const rows = new Map([['shot:shot-bd-1', { type: 'Shot', id: 9001 }]]);
		const bidIds = new Map([[KEY_A, 5001]]);
		const item: ReadRow = {
			id: 9001,
			attributes: { code: 'zzsgbids_SH900', description: 'Dragon lands', sg_cut_duration: 120, sg_difficulty: 'Hero' },
			relationships: { project: { data: PROJECT }, sg_sequence: { data: { type: 'Sequence', id: 301, name: 'SQ010' } } }
		};
		const back = { bids: new Map(), lines: new Map(), groups: { 'Shot:9001': [38] }, items: new Map([['shot:shot-bd-1', item]]) };
		const problems = verify(plan, back, SITE, bidIds, rows);
		expect(problems.filter((p) => p.startsWith('shot:'))).toEqual([]);
		expect(problems).not.toContain('Shot 9001: Group 38 is not in sg_vendor_groups.');
		const wrong = { ...back, items: new Map([['shot:shot-bd-1', { ...item, attributes: { ...item.attributes, sg_cut_duration: 12 } }]]) };
		expect(verify(plan, wrong, SITE, bidIds, rows)).toContain('shot:shot-bd-1: sg_cut_duration reads back 12.');
		expect(verify(plan, { ...back, items: new Map() }, SITE, bidIds, rows)).toContain('shot:shot-bd-1: no row reads back.');
	});
});

describe('toLookUp', () => {
	it('asks the codes of the rows to create and the Sequences they name, nothing an earlier run made', () => {
		const { existing, ...rest } = bdInput();
		void existing;
		expect(toLookUp(rest)).toEqual({ Shot: ['zzsgbids_SH900', 'zzsgbids_SH910'], Asset: ['zzsgbids_Banner'], sequences: ['SQ010', 'sq_new'] });
		const previous: Written = { ...NOTHING_WRITTEN, items: [{ key: 'shot:shot-bd-1', type: 'Shot', id: 1 }] };
		expect(toLookUp({ ...rest, previous }).Shot).toEqual(['zzsgbids_SH910']);
		expect(toLookUp({ ...rest, options: { ...rest.options, missing: { shot: 'without', asset: 'create' } } })).toEqual({ Shot: [], Asset: ['zzsgbids_Banner'], sequences: [] });
	});
});

describe('created rows in the record and the undo', () => {
	it('keeps the created rows across runs, drops those taken back, and is not clean while one is left', () => {
		const a: Written = { ...NOTHING_WRITTEN, items: [{ key: 'shot:a', type: 'Shot', id: 1 }] };
		const b: Written = { ...NOTHING_WRITTEN, items: [{ key: 'shot:b', type: 'Shot', id: 2 }] };
		expect(mergeWritten(a, b).items).toEqual([
			{ key: 'shot:a', type: 'Shot', id: 1 },
			{ key: 'shot:b', type: 'Shot', id: 2 }
		]);
		expect(mergeWritten(a, b, { bids: [], lines: [], attachments: [], groups: [], items: [1] }).items).toEqual([{ key: 'shot:b', type: 'Shot', id: 2 }]);
		expect(isClean(a)).toBe(false);
		expect(isClean(NOTHING_WRITTEN)).toBe(true);
	});

	it('retires the created Shots and Assets after the Bids, the Sequences last, and leaves one that gained links', () => {
		const written: Written = {
			bids: [{ key: KEY_A, id: 5001, created: true }],
			lines: [{ key: 'l1', id: 6001, created: true }],
			groups: [{ itemType: 'Shot', id: 9001, field: 'sg_vendor_groups', groups: [38] }],
			attachments: [],
			items: [
				{ key: 'sequence:sq_new', type: 'Sequence', id: 300 },
				{ key: 'shot:a', type: 'Shot', id: 9001 },
				{ key: 'shot:b', type: 'Shot', id: 9002 },
				{ key: 'asset:c', type: 'Asset', id: 9003 }
			]
		};
		const undo = planUndo(written, SITE, new Set(), new Map([['Shot:9002', 'it has 1 Task']]));
		expect(undo.writes).toEqual([
			{ kind: 'removeGroups', itemType: 'Shot', id: 9001, field: 'sg_vendor_groups', groups: [38] },
			{ kind: 'delete', entityType: 'CustomEntity15', id: 6001 },
			{ kind: 'delete', entityType: 'CustomEntity14', id: 5001 },
			{ kind: 'delete', entityType: 'Shot', id: 9001 },
			{ kind: 'delete', entityType: 'Asset', id: 9003 },
			{ kind: 'delete', entityType: 'Sequence', id: 300 }
		]);
		expect(undo.left).toEqual([{ key: 'shot:b', type: 'Shot', id: 9002, why: 'it has 1 Task' }]);
	});
});
