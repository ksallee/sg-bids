import { describe, expect, it } from 'vitest';
import { asset, bid, line, onShot, request, shot } from './fixtures';
import { money } from './money';
import { vendorKeys } from './vendor-keys';
import { groupItems, groupings, itemMatches, packageSections, requestFacts, vendorBidView, vendorRequestView } from './vendor-view';

const SHOT = '11111111-1111-4111-8111-111111111111';
const HERO = '22222222-2222-4222-8222-222222222222';
const keys = vendorKeys([
	{ kind: 'shot', key: 'shot-918273645', id: SHOT },
	{ kind: 'asset', key: 'asset-564738291', id: HERO }
]);

describe('vendorRequestView', () => {
	const req = request({
		id: 'req-uuid',
		header: { project: 'Show', projectRef: { type: 'Project', id: 70 }, round: 1, baseCurrency: 'USD', assumptions: ['4K'] },
		shots: [shot('shot-918273645', { code: 'SH010', fpt: { type: 'Shot', id: 918273645 }, sequence: 'SQ1', frames: 96, assetIds: ['asset-564738291', 'asset-1'] })],
		assets: [asset('asset-564738291', { name: 'hero', fpt: { type: 'Asset', id: 564738291 } })],
		vendors: [{ id: 'inv-a', name: 'Vendor A', email: 'a@example.com', ndaExecuted: true, fpt: { type: 'Group', id: 7 } }]
	});

	it('keeps what the vendor bids on and its own name and invitation, and drops the vendors list, other ids and Flow PT refs', () => {
		const view = vendorRequestView({
			invitation: { id: 'inv-own', name: 'Own Vendor' },
			request: req,
			code: 'BR-1',
			status: 'issued',
			issuedAt: '2026-11-20T10:00:00Z',
			expiresAt: '2027-01-19T10:00:00Z',
			keys
		});
		expect(view).toEqual({
			invitationId: 'inv-own',
			vendorName: 'Own Vendor',
			code: 'BR-1',
			status: 'issued',
			issuedAt: '2026-11-20T10:00:00Z',
			expiresAt: '2027-01-19T10:00:00Z',
			header: { project: 'Show', round: 1, baseCurrency: 'USD', assumptions: ['4K'] },
			packages: [{ id: 'all', name: 'All shots and assets' }],
			shots: [{ id: SHOT, code: 'SH010', omitted: false, assetIds: [HERO], sequence: 'SQ1', frames: 96, package: 'all' }],
			assets: [{ id: HERO, name: 'hero', package: 'all' }]
		});
		const text = JSON.stringify(view);
		for (const secret of ['inv-a', 'Vendor A', 'a@example.com', 'own@example.com', 'req-uuid', '918273645', '564738291', 'asset-1', '"vendors"']) {
			expect(text).not.toContain(secret);
		}
	});
});

describe('vendorRequestView of a breakdown row', () => {
	it('shows it as any other row: no source, no Flow PT row', () => {
		const req = request({
			id: 'req-uuid',
			header: { project: 'Show', round: 1, baseCurrency: 'USD', assumptions: [] },
			shots: [shot('shot-bd-1', { code: 'SH900', source: 'breakdown', fpt: { type: 'Shot', id: 4242 }, frames: 48 })],
			assets: [asset('asset-bd-2', { name: 'prop', source: 'breakdown' })],
			vendors: []
		});
		const own = vendorKeys([
			{ kind: 'shot', key: 'shot-bd-1', id: SHOT },
			{ kind: 'asset', key: 'asset-bd-2', id: HERO }
		]);
		const view = vendorRequestView({ invitation: { id: 'inv-own', name: 'Own' }, request: req, code: 'BR-1', status: 'issued', issuedAt: null, expiresAt: '2027-01-19T10:00:00Z', keys: own });
		expect(view.shots).toEqual([{ id: SHOT, code: 'SH900', omitted: false, assetIds: [], frames: 48, package: 'all' }]);
		expect(view.assets).toEqual([{ id: HERO, name: 'prop', package: 'all' }]);
		const text = JSON.stringify(view);
		for (const secret of ['breakdown', 'source', '4242', 'shot-bd-1']) expect(text).not.toContain(secret);
	});
});

describe('vendorRequestView with packages', () => {
	it('sends each row with its package, and the packages that have a row, in order', () => {
		const req = request({
			packages: [
				{ id: 'p1', name: 'Creature' },
				{ id: 'p2', name: 'Empty' },
				{ id: 'p3', name: 'Comp' }
			],
			shots: [shot('shot-918273645', { code: 'SH010', package: 'p3' })],
			assets: [asset('asset-564738291', { name: 'hero', package: 'p1' })]
		});
		const view = vendorRequestView({ invitation: { id: 'i', name: 'V' }, request: req, code: 'C', status: 'issued', issuedAt: null, expiresAt: '2027-01-01T00:00:00Z', keys });
		expect(view.packages).toEqual([
			{ id: 'p1', name: 'Creature' },
			{ id: 'p3', name: 'Comp' }
		]);
		expect(view.shots[0].package).toBe('p3');
		expect(packageSections(view)).toEqual([
			{ id: 'p1', label: 'Creature', keys: [`asset:${HERO}`] },
			{ id: 'p3', label: 'Comp', keys: [`shot:${SHOT}`] }
		]);
	});
});

describe('vendorBidView', () => {
	const v1 = bid({ id: 'b1', vendorId: 'inv-a', requestId: 'req-uuid', currency: 'USD', status: 'submitted', lines: [line('l1', onShot('shot-918273645'), money(100, 'USD'))] });
	const v2 = bid({ id: 'b2', vendorId: 'inv-a', requestId: 'req-uuid', currency: 'USD', status: 'draft' });

	it('answers the latest version, with every version listed, and no vendor or request id', () => {
		const view = vendorBidView(
			[
				{ bid: v1, version: 1, submittedAt: '2026-11-21T10:00:00Z', withdrawnAt: null },
				{ bid: v2, version: 2, submittedAt: null, withdrawnAt: null }
			],
			keys
		);
		expect(view.bid?.id).toBe('b2');
		expect(view.bid?.version).toBe(2);
		expect(view.versions).toEqual([
			{ id: 'b1', version: 1, status: 'submitted', submittedAt: '2026-11-21T10:00:00Z', withdrawnAt: null },
			{ id: 'b2', version: 2, status: 'draft', submittedAt: null, withdrawnAt: null }
		]);
		const text = JSON.stringify(view);
		expect(text).not.toContain('inv-a');
		expect(text).not.toContain('req-uuid');
	});

	it('names each line by the item’s vendor id, never the stored key', () => {
		const view = vendorBidView([{ bid: v1, version: 1, submittedAt: '2026-11-21T10:00:00Z', withdrawnAt: null }], keys);
		expect(view.bid?.lines.map((l) => l.target)).toEqual([{ kind: 'shot', id: SHOT }]);
		expect(JSON.stringify(view)).not.toContain('918273645');
	});

	it('answers no bid before the first save', () => {
		expect(vendorBidView([], keys)).toEqual({ bid: null, versions: [] });
	});
});

describe('groupings', () => {
	it('offers episode and sequence when shots carry them', () => {
		expect(groupings([shot('a', { sequence: 'SQ1' }), shot('b')])).toEqual(['sequence']);
		expect(groupings([shot('a', { sequence: 'SQ1', episode: 'E1' })])).toEqual(['episode', 'sequence']);
		expect(groupings([shot('a')])).toEqual([]);
	});
});

describe('groupItems', () => {
	const shots = [shot('a', { sequence: 'SQ2' }), shot('b', { sequence: 'SQ1' }), shot('c'), shot('d', { sequence: 'SQ2' })];

	it('groups in the order groups first appear, the shots without one last', () => {
		expect(groupItems(shots, 'sequence')).toEqual([
			{ label: 'SQ2', ids: ['a', 'd'] },
			{ label: 'SQ1', ids: ['b'] },
			{ label: 'No sequence', ids: ['c'] }
		]);
	});

	it('is one group of everything with no grouping', () => {
		expect(groupItems(shots, null)).toEqual([{ label: null, ids: ['a', 'b', 'c', 'd'] }]);
	});
});

describe('itemMatches', () => {
	it('finds the words in code, name, description, sequence, episode or type, any case', () => {
		const s = shot('sh010', { description: 'Hero jumps the gap', sequence: 'Rooftop', type: 'CG' });
		expect(itemMatches(s, '')).toBe(true);
		expect(itemMatches(s, 'sh01')).toBe(true);
		expect(itemMatches(s, 'roof jump')).toBe(true);
		expect(itemMatches(s, 'cg')).toBe(true);
		expect(itemMatches(s, 'water')).toBe(false);
		expect(itemMatches(asset('hero', { name: 'Hero Suit' }), 'suit')).toBe(true);
	});
});

describe('requestFacts', () => {
	const day = (text: string) => `day ${text}`;
	const base = {
		header: { project: 'Show', round: 1, baseCurrency: 'USD', assumptions: [] },
		packages: [
			{ id: 'p1', name: 'SEQ010' },
			{ id: 'p2', name: 'Creature' }
		],
		shots: [
			{ id: 's1', code: 'SH010', omitted: false, assetIds: [], package: 'p1' },
			{ id: 's2', code: 'SH020', omitted: true, assetIds: [], package: 'p1' }
		],
		assets: [{ id: 'a1', name: 'Hero', package: 'p2' }]
	};

	it('always lists the bids the vendor answers, with their rows in, so the box is never empty', () => {
		expect(requestFacts(base, day)).toEqual([['Bids', 'SEQ010 (1 row), Creature (1 row)']]);
	});

	it('says shots in rows where a row stands for several', () => {
		const counted = { ...base, shots: [...base.shots, { id: 's3', code: 'SIMPLE', omitted: false, assetIds: [], package: 'p1', count: 120 }], assets: [{ id: 'a1', name: 'Hero', package: 'p2', count: 3 }] };
		expect(requestFacts(counted, day)).toEqual([['Bids', 'SEQ010 (121 shots in 2 rows), Creature (3 assets in 1 row)']]);
	});

	it('lists what production set, and leaves out what it did not; the name is the page’s title', () => {
		const facts = requestFacts({ ...base, packages: [base.packages[0]], header: { ...base.header, title: 'Main', director: 'Ada', deliveryDate: '2027-02-01', studio: ' ' } }, day);
		expect(facts).toEqual([
			['Bid', 'SEQ010 (1 row)'],
			['Director', 'Ada'],
			['Delivery', 'day 2027-02-01']
		]);
	});
});
