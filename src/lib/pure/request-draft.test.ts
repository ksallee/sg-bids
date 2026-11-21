import { describe, expect, it } from 'vitest';
import type { BidRequest, RequestAsset, RequestShot } from './model';
import {
	addBid,
	bidStats,
	copyRequest,
	deleteBid,
	draftFrom,
	inBid,
	moveRows,
	defaultBidName,
	followRequestName,
	MAX_BID_NAME,
	nextBidName,
	renameBid,
	savableBids,
	type DraftBid,
	type DraftRows
} from './request-draft';

const shot = (id: string, pkg: string | undefined, extra: Partial<RequestShot> = {}): RequestShot => ({
	id,
	code: id.toUpperCase(),
	omitted: false,
	assetIds: [],
	...(pkg ? { package: pkg } : {}),
	...extra
});
const asset = (id: string, pkg: string | undefined, extra: Partial<RequestAsset> = {}): RequestAsset => ({ id, name: id, ...(pkg ? { package: pkg } : {}), ...extra });

const two: DraftBid[] = [
	{ key: 'bid:a', name: 'Bid 1' },
	{ key: 'bid:b', name: 'Hero' }
];

const rows: DraftRows = {
	shots: [shot('sh010', 'bid:a', { frames: 48 }), shot('sh020', 'bid:a', { frames: 24, omitted: true }), shot('sh030', 'bid:b', { frames: 100 })],
	assets: [asset('tree', 'bid:b')]
};

describe('a new bid', () => {
	it('is named after the request, with the first two digit number no bid holds, in any case', () => {
		expect(nextBidName([], 'Spring pitch')).toBe('Spring pitch 01');
		expect(nextBidName([{ key: 'k', name: 'Spring pitch 01' }], 'Spring pitch')).toBe('Spring pitch 02');
		expect(nextBidName([{ key: 'k', name: 'spring PITCH 02' }], ' Spring pitch ')).toBe('Spring pitch 01');
		expect(defaultBidName('Spring pitch', 12)).toBe('Spring pitch 12');
		expect(defaultBidName('Spring pitch', 100)).toBe('Spring pitch 100');
	});

	it('is Bid and the number while the request has no name', () => {
		expect(nextBidName([])).toBe('Bid 01');
		expect(nextBidName(two, '  ')).toBe('Bid 01');
		expect(nextBidName([{ key: 'k', name: 'bid 01' }])).toBe('Bid 02');
	});

	it('keeps to the longest bid name', () => {
		const name = defaultBidName('x'.repeat(200), 3);
		expect(name).toHaveLength(MAX_BID_NAME);
		expect(name.endsWith(' 03')).toBe(true);
	});

	it('goes last, with its key', () => {
		expect(addBid(two, 'bid:c', 'Pitch')).toEqual([...two, { key: 'bid:c', name: 'Pitch 01' }]);
	});
});

describe('renaming the request', () => {
	const bids: DraftBid[] = [
		{ key: 'a', name: 'Pitch 01' },
		{ key: 'b', name: 'Hero' },
		{ key: 'c', name: 'Pitch 03' }
	];

	it('renames the bids still on their default name, keeping their numbers', () => {
		expect(followRequestName(bids, 'Pitch', 'Spring pitch')).toEqual([
			{ key: 'a', name: 'Spring pitch 01' },
			{ key: 'b', name: 'Hero' },
			{ key: 'c', name: 'Spring pitch 03' }
		]);
	});

	it('follows from no name and back to none', () => {
		expect(followRequestName([{ key: 'a', name: 'Bid 01' }], '', 'Pitch')).toEqual([{ key: 'a', name: 'Pitch 01' }]);
		expect(followRequestName([{ key: 'a', name: 'Pitch 01' }], 'Pitch', '')).toEqual([{ key: 'a', name: 'Bid 01' }]);
	});

	it('leaves a bid whose new name another bid holds', () => {
		const taken: DraftBid[] = [
			{ key: 'a', name: 'Pitch 01' },
			{ key: 'b', name: 'Hero 01' }
		];
		expect(followRequestName(taken, 'Pitch', 'Hero')).toEqual(taken);
	});

	it('typed letter by letter ends as typed at once', () => {
		let step: DraftBid[] = [{ key: 'a', name: 'Bid 01' }];
		let was = '';
		for (const now of ['P', 'Pi', 'Pit', 'Pitc', 'Pitch']) {
			step = followRequestName(step, was, now);
			was = now;
		}
		expect(step).toEqual([{ key: 'a', name: 'Pitch 01' }]);
	});
});

describe('renaming a bid', () => {
	it('takes the name as typed, trimmed', () => {
		expect(renameBid(two, 'bid:a', '  Environments ')).toEqual({ ok: true, bids: [{ key: 'bid:a', name: 'Environments' }, two[1]] });
	});

	it('refuses a blank name, a long one, and one another bid holds, saying which', () => {
		expect(renameBid(two, 'bid:a', '  ')).toEqual({ ok: false, message: 'Give the bid a name.' });
		expect(renameBid(two, 'bid:a', 'x'.repeat(121))).toEqual({ ok: false, message: 'A bid name is 120 characters at most.' });
		expect(renameBid(two, 'bid:a', 'hero')).toEqual({ ok: false, message: 'Another bid is named Hero. Give this one its own name.' });
	});

	it('keeps its own name in another case', () => {
		expect(renameBid(two, 'bid:b', 'HERO')).toEqual({ ok: true, bids: [two[0], { key: 'bid:b', name: 'HERO' }] });
	});
});

describe('the rows of a bid', () => {
	it('counts shots and assets in, frames of the shots in, and the omitted ones', () => {
		const stats = bidStats(two, rows);
		expect(stats.get('bid:a')).toEqual({ shots: 1, shotRows: 1, assets: 0, assetRows: 0, omitted: 1, frames: 48, rows: 2 });
		expect(stats.get('bid:b')).toEqual({ shots: 1, shotRows: 1, assets: 1, assetRows: 1, omitted: 0, frames: 100, rows: 2 });
	});

	it('counts a counted row as many as it stands for, and its frames per unit times its count', () => {
		const counted: DraftRows = {
			shots: [shot('simple', 'bid:a', { source: 'breakdown', frames: 80, count: 120 }), shot('hard', 'bid:a', { source: 'breakdown', count: 10, omitted: true }), shot('sh010', 'bid:a', { frames: 48 })],
			assets: [asset('props', 'bid:a', { source: 'breakdown', count: 12 })]
		};
		expect(bidStats(two, counted).get('bid:a')).toEqual({ shots: 121, shotRows: 2, assets: 12, assetRows: 1, omitted: 1, frames: 9648, rows: 4 });
	});

	it('gives rows with no bid to the one named', () => {
		const added = inBid([shot('sh040', undefined), shot('sh010', 'bid:a')], 'bid:b');
		expect(added.map((s) => s.package)).toEqual(['bid:b', 'bid:a']);
	});

	it('moves the rows named to another bid and leaves the rest', () => {
		const moved = moveRows(rows, [{ kind: 'shot', id: 'sh010' }, { kind: 'asset', id: 'tree' }], 'bid:b');
		expect(moved.shots.map((s) => [s.id, s.package])).toEqual([
			['sh010', 'bid:b'],
			['sh020', 'bid:a'],
			['sh030', 'bid:b']
		]);
		expect(moved.assets[0].package).toBe('bid:b');
	});
});

describe('deleting a bid', () => {
	it('takes its rows with it', () => {
		const next = deleteBid(two, rows, 'bid:a', null);
		expect(next.bids).toEqual([two[1]]);
		expect(next.rows.shots.map((s) => s.id)).toEqual(['sh030']);
	});

	it('or moves them to the bid named', () => {
		const next = deleteBid(two, rows, 'bid:b', 'bid:a');
		expect(next.bids).toEqual([two[0]]);
		expect(next.rows.shots.map((s) => [s.id, s.package])).toEqual([
			['sh010', 'bid:a'],
			['sh020', 'bid:a'],
			['sh030', 'bid:a']
		]);
		expect(next.rows.assets.map((a) => a.package)).toEqual(['bid:a']);
	});

	it('never leaves the request without a bid', () => {
		const one = [two[0]];
		expect(deleteBid(one, rows, 'bid:a', null)).toEqual({ bids: one, rows });
	});
});

describe('a draft as stored', () => {
	const request = (packages: BidRequest['packages'], shots: readonly RequestShot[] = rows.shots): BidRequest => ({
		id: 'r1',
		header: { project: 'Show', round: 1, baseCurrency: 'USD', assumptions: [] },
		shots,
		assets: rows.assets,
		vendors: [],
		...(packages ? { packages } : {})
	});

	it('reads its bids from its packages, in order, each row in its bid', () => {
		const draft = draftFrom(request([{ id: 'bid:a', name: 'Bid 1', bid: 'x' }, { id: 'bid:b', name: 'Hero', bid: 'y' }]), 'bid:new');
		expect(draft.bids).toEqual(two);
		expect(draft.rows.shots.map((s) => s.package)).toEqual(['bid:a', 'bid:a', 'bid:b']);
	});

	it('starts with one bid, Bid 01, holding every row, when it has none', () => {
		const draft = draftFrom(request(undefined, [shot('sh010', undefined)]), 'bid:new');
		expect(draft.bids).toEqual([{ key: 'bid:new', name: 'Bid 01' }]);
		expect(draft.rows.shots.map((s) => s.package)).toEqual(['bid:new']);
	});

	it('gives a row in no known bid to the first', () => {
		const draft = draftFrom(request([{ id: 'bid:a', name: 'Bid 1' }], [shot('sh010', 'gone')]), 'bid:new');
		expect(draft.rows.shots[0].package).toBe('bid:a');
	});
});

describe('the bids a save sends', () => {
	it('are each bid with its rows, in order, without what is never stored', () => {
		const withThumb: DraftRows = { shots: [shot('sh010', 'bid:a', { thumbnail: 'https://x' })], assets: [asset('tree', 'bid:b', { timesUsed: 3 })] };
		const saved = savableBids(two, withThumb);
		expect(saved).toEqual({
			ok: true,
			bids: [
				{ key: 'bid:a', name: 'Bid 1', shots: [{ id: 'sh010', code: 'SH010', omitted: false, assetIds: [] }], assets: [] },
				{ key: 'bid:b', name: 'Hero', shots: [], assets: [{ id: 'tree', name: 'tree' }] }
			]
		});
	});

	it('refuse two bids of one name, naming it', () => {
		expect(savableBids([two[0], { key: 'bid:c', name: 'bid 1' }], rows)).toEqual({ ok: false, message: 'Two bids are named Bid 1. Give each its own name.' });
	});

	it('refuse a blank name', () => {
		expect(savableBids([{ key: 'bid:a', name: ' ' }], rows)).toEqual({ ok: false, message: 'A bid has no name. Give it one.' });
	});
});

describe('copying a request', () => {
	const request: BidRequest = {
		id: 'r1',
		header: { project: 'Show', round: 1, baseCurrency: 'USD', assumptions: [] },
		shots: [shot('sh010', 'bid:a', { thumbnail: 'https://x' }), shot('sh030', 'bid:b')],
		assets: [asset('tree', 'bid:b', { timesUsed: 2 })],
		vendors: [
			{ id: 'v1', name: 'Studio A', email: 'a@a.com', ndaExecuted: false, fpt: { type: 'Group', id: 4 }, groupName: 'Studio A', packages: ['bid:b'] },
			{ id: 'v2', name: 'Studio B', email: 'b@b.com', ndaExecuted: false }
		],
		packages: [
			{ id: 'bid:a', name: 'Bid 1' },
			{ id: 'bid:b', name: 'Hero' }
		]
	};
	let n = 0;
	const fresh = () => `new${++n}`;

	it('keeps the bid names and, with the rows, every row in its bid, under new keys', () => {
		n = 0;
		const copy = copyRequest(request, { rows: true, key: fresh, id: fresh });
		expect(copy.bids).toEqual([
			{ key: 'bid:new1', name: 'Bid 1', shots: [{ id: 'sh010', code: 'SH010', omitted: false, assetIds: [] }], assets: [] },
			{ key: 'bid:new2', name: 'Hero', shots: [{ id: 'sh030', code: 'SH030', omitted: false, assetIds: [] }], assets: [{ id: 'tree', name: 'tree' }] }
		]);
	});

	it('without the rows, keeps the bid names alone', () => {
		n = 0;
		const copy = copyRequest(request, { rows: false, key: fresh, id: fresh });
		expect(copy.bids.map((b) => [b.name, b.shots.length + b.assets.length])).toEqual([
			['Bid 1', 0],
			['Hero', 0]
		]);
	});

	it('copies the vendors under new ids, each invited to the same bids', () => {
		n = 0;
		const copy = copyRequest(request, { rows: true, key: fresh, id: fresh });
		expect(copy.vendors).toEqual([
			{ id: 'new3', name: 'Studio A', email: 'a@a.com', group: { id: 4, name: 'Studio A' }, bids: ['bid:new2'] },
			{ id: 'new4', name: 'Studio B', email: 'b@b.com', group: null, bids: null }
		]);
	});

	it('makes one bid, Bid 01, of a request from before bids', () => {
		n = 0;
		const copy = copyRequest({ ...request, packages: undefined, vendors: [] }, { rows: true, key: fresh, id: fresh });
		expect(copy.bids.map((b) => [b.key, b.name, b.shots.length, b.assets.length])).toEqual([['bid:new1', 'Bid 01', 2, 1]]);
	});
});
