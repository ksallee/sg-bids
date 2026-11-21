import { describe, expect, it } from 'vitest';
import { asset, bid, line, onAsset, onShot, request, shot } from './fixtures';
import { money, rate } from './money';
import {
	addPackage,
	ALL_PACKAGE,
	allocate,
	deletePackage,
	duplicatePackage,
	invitedPackages,
	lineAmounts,
	moveRows,
	nameProblem,
	packageProblems,
	packageStats,
	partialPackagePicks,
	renamePackage,
	resolvePackages,
	visibleRows,
	withDefaults
} from './packages';

const usd = (minor: number) => money(minor, 'USD');

describe('withDefaults', () => {
	it('puts each shot in its sequence, shots with none in one package, assets in their own', () => {
		const rows = withDefaults({
			shots: [shot('a', { sequence: 'SEQ010' }), shot('b', { sequence: ' SEQ020 ' }), shot('c'), shot('d', { sequence: 'SEQ010' })],
			assets: [asset('x')],
			packages: []
		});
		expect(rows.packages).toEqual([
			{ id: 'seq:SEQ010', name: 'SEQ010' },
			{ id: 'seq:SEQ020', name: 'SEQ020' },
			{ id: 'shots', name: 'Other shots' },
			{ id: 'assets', name: 'Assets' }
		]);
		expect(rows.shots.map((s) => s.package)).toEqual(['seq:SEQ010', 'seq:SEQ020', 'shots', 'seq:SEQ010']);
		expect(rows.assets[0].package).toBe('assets');
	});

	it('keeps a row in the package it names and adds only the defaults still needed', () => {
		const rows = withDefaults({
			shots: [shot('a', { sequence: 'SEQ010', package: 'pkg:creature' }), shot('b', { sequence: 'SEQ010' })],
			assets: [],
			packages: [{ id: 'pkg:creature', name: 'Creature' }]
		});
		expect(rows.packages.map((p) => p.id)).toEqual(['pkg:creature', 'seq:SEQ010']);
		expect(rows.shots.map((s) => s.package)).toEqual(['pkg:creature', 'seq:SEQ010']);
	});

	it('sends a row naming a package no longer in the list to its default', () => {
		const rows = withDefaults({ shots: [shot('a', { package: 'pkg:gone' })], assets: [], packages: [] });
		expect(rows.shots[0].package).toBe('shots');
	});

	it('gives a default a free name when its own is taken', () => {
		const rows = withDefaults({ shots: [shot('a', { sequence: 'Creature' })], assets: [], packages: [{ id: 'pkg:1', name: 'creature' }] });
		expect(rows.packages.at(-1)).toEqual({ id: 'seq:Creature', name: 'Creature 2' });
	});

	it('gives the same packages for the same rows', () => {
		const input = { shots: [shot('a', { sequence: 'S1' }), shot('b')], assets: [asset('x')], packages: [] };
		expect(withDefaults(input)).toEqual(withDefaults(input));
	});
});

describe('resolvePackages', () => {
	it('reads a request from before packages as one package with every row', () => {
		const r = resolvePackages(request({ shots: [shot('a'), shot('b', { omitted: true })], assets: [asset('x')] }));
		expect(r.implicit).toBe(true);
		expect(r.packages).toEqual([ALL_PACKAGE]);
		expect(r.rows.get('all')).toEqual([onShot('a'), onShot('b'), onAsset('x')]);
		expect(r.live.get('all')).toEqual([onShot('a'), onAsset('x')]);
		expect(r.of.get('shot:b')).toBe('all');
	});

	it('maps each row to its package, in the request order', () => {
		const r = resolvePackages(
			request({
				packages: [
					{ id: 'p1', name: 'One' },
					{ id: 'p2', name: 'Two' }
				],
				shots: [shot('a', { package: 'p2' }), shot('b', { package: 'p1' })],
				assets: [asset('x', { package: 'p2', omitted: true })]
			})
		);
		expect(r.implicit).toBe(false);
		expect(r.rows.get('p2')).toEqual([onShot('a'), onAsset('x')]);
		expect(r.live.get('p2')).toEqual([onShot('a')]);
		expect(r.rows.get('p1')).toEqual([onShot('b')]);
	});

	it('refuses a row with no package, or one not in the list, once the request has packages', () => {
		expect(() => resolvePackages(request({ packages: [{ id: 'p1', name: 'One' }], shots: [shot('a')] }))).toThrow(/A has no package/);
		expect(() => resolvePackages(request({ packages: [{ id: 'p1', name: 'One' }], shots: [shot('a', { package: 'p9' })] }))).toThrow(/not in the request/);
	});
});

describe('package edits', () => {
	const base = withDefaults({
		shots: [shot('a', { sequence: 'S1', frames: 10 }), shot('b', { sequence: 'S1', frames: 20 }), shot('c', { sequence: 'S2' })],
		assets: [asset('x')],
		packages: []
	});

	it('adds a package by a name not taken', () => {
		const added = addPackage(base, ' Creature ', 'pkg:1');
		expect(added.ok && added.rows.packages.at(-1)).toEqual({ id: 'pkg:1', name: 'Creature' });
		expect(addPackage(base, 's1', 'pkg:2')).toEqual({ ok: false, message: 'Another package is named S1.' });
		expect(addPackage(base, '  ', 'pkg:3')).toEqual({ ok: false, message: 'Name the package.' });
	});

	it('duplicates a package: a copy right after it, no rows', () => {
		const copied = duplicatePackage(base, 'seq:S1', 'pkg:9');
		expect(copied.ok && copied.rows.packages.slice(0, 2)).toEqual([
			{ id: 'seq:S1', name: 'S1' },
			{ id: 'pkg:9', name: 'S1 copy' }
		]);
		expect(copied.ok && copied.rows.shots.every((s) => s.package !== 'pkg:9')).toBe(true);
		if (!copied.ok) throw new Error(copied.message);
		const again = duplicatePackage(copied.rows, 'seq:S1', 'pkg:10');
		expect(again.ok && again.rows.packages[1].name).toBe('S1 copy 2');
	});

	it('renames, refusing a name another package has', () => {
		const renamed = renamePackage(base, 'seq:S1', 'Opening');
		expect(renamed.ok && renamed.rows.packages[0]).toEqual({ id: 'seq:S1', name: 'Opening' });
		expect(renamePackage(base, 'seq:S1', 'S2').ok).toBe(false);
		expect(renamePackage(base, 'seq:S1', 'S1').ok).toBe(true);
	});

	it('moves rows to another package', () => {
		const added = addPackage(base, 'Creature', 'pkg:1');
		if (!added.ok) throw new Error(added.message);
		const moved = moveRows(added.rows, [onShot('a'), onAsset('x')], 'pkg:1');
		expect(moved.ok && moved.rows.shots.map((s) => s.package)).toEqual(['pkg:1', 'seq:S1', 'seq:S2']);
		expect(moved.ok && moved.rows.assets[0].package).toBe('pkg:1');
		expect(moveRows(base, [onShot('a')], 'pkg:none').ok).toBe(false);
	});

	it('deletes a package: its rows go back to their sequence, else to the catch-all of their kind', () => {
		const added = addPackage(base, 'Creature', 'pkg:1');
		if (!added.ok) throw new Error(added.message);
		const moved = moveRows(added.rows, [onShot('a'), onShot('c'), onAsset('x')], 'pkg:1');
		if (!moved.ok) throw new Error(moved.message);
		const dropped = deletePackage(moved.rows, 'pkg:1');
		expect(dropped.ok && dropped.rows.shots.map((s) => s.package)).toEqual(['seq:S1', 'seq:S1', 'seq:S2']);
		expect(dropped.ok && dropped.rows.assets[0].package).toBe('assets');
		expect(dropped.ok && dropped.rows.packages.map((p) => p.id)).toEqual(['seq:S1', 'seq:S2', 'assets']);
	});

	it('deletes a sequence package: its rows go to the catch-all, made when missing', () => {
		const dropped = deletePackage(base, 'seq:S1');
		expect(dropped.ok && dropped.rows.shots.map((s) => s.package)).toEqual(['shots', 'shots', 'seq:S2']);
		expect(dropped.ok && dropped.rows.packages.map((p) => p.id)).toEqual(['seq:S2', 'assets', 'shots']);
	});

	it('refuses to delete a catch-all whose rows have nowhere else to go', () => {
		expect(deletePackage(base, 'assets')).toEqual({ ok: false, message: 'Assets holds rows with nowhere else to go. Move them to another package first.' });
		const emptyAssets = moveRows(base, [onAsset('x')], 'seq:S1');
		if (!emptyAssets.ok) throw new Error(emptyAssets.message);
		expect(deletePackage(emptyAssets.rows, 'assets').ok).toBe(true);
	});

	it('names a problem with a name', () => {
		expect(nameProblem('x'.repeat(121), base.packages)).toBe('A package name is 120 characters at most.');
		expect(nameProblem('Assets', base.packages, 'assets')).toBeNull();
	});

	it('counts each package: live rows, omitted, frames', () => {
		const stats = packageStats(request({ ...base, shots: base.shots.map((s) => (s.id === 'b' ? { ...s, omitted: true } : s)) }));
		expect(stats.get('seq:S1')).toEqual({ rows: 1, omitted: 1, shots: 1, assets: 0, frames: 10, withoutFrames: 0 });
		expect(stats.get('seq:S2')).toEqual({ rows: 1, omitted: 0, shots: 1, assets: 0, frames: 0, withoutFrames: 1 });
	});
});

describe('allocate', () => {
	it('shares a figure by weight, the remainder on the last part, so the parts sum exactly', () => {
		expect(allocate(usd(1000), [1, 1, 1])).toEqual([usd(333), usd(333), usd(334)]);
		expect(allocate(usd(1001), [10, 20, 70])).toEqual([usd(100), usd(200), usd(701)]);
		expect(allocate(usd(5), [])).toEqual([]);
	});

	it('shares equally when a weight is missing or zero', () => {
		expect(allocate(usd(10), [5, 0])).toEqual([usd(5), usd(5)]);
	});

	it('sums exactly for any figure', () => {
		for (const minor of [0, 1, 7, 99_999, 123_456_789]) {
			const parts = allocate(usd(minor), [3, 7, 11, 13]);
			expect(parts.reduce((n, p) => n + p.minor, 0)).toBe(minor);
		}
	});
});

describe('lineAmounts', () => {
	const req = request({
		packages: [
			{ id: 'p1', name: 'Creature' },
			{ id: 'p2', name: 'Comp' }
		],
		shots: [shot('a', { package: 'p1', frames: 10 }), shot('b', { package: 'p1', frames: 30 }), shot('c', { package: 'p2' }), shot('d', { package: 'p1', omitted: true })]
	});

	it('gives a priced line its own total and an in-package line its share of the figure, by frames', () => {
		const b = bid({
			currency: 'USD',
			lines: [line('l1', onShot('a'), usd(0), { inPackage: true }), line('l2', onShot('b'), usd(0), { inPackage: true }), line('l3', onShot('c'), usd(500))],
			packages: [{ package: 'p1', total: usd(1003) }]
		});
		const amounts = lineAmounts(req, b, 'USD');
		expect(amounts.get('shot:a')).toEqual({ bid: usd(250), base: usd(250) });
		expect(amounts.get('shot:b')).toEqual({ bid: usd(753), base: usd(753) });
		expect(amounts.get('shot:c')).toEqual({ bid: usd(500), base: usd(500) });
	});

	it('converts the package figure once, then shares it, so the base parts sum to it exactly', () => {
		const b = bid({
			currency: 'GBP',
			rate: rate('GBP', 'USD', '1.2712', '2026-11-20'),
			lines: [line('l1', onShot('a'), money(0, 'GBP'), { inPackage: true }), line('l2', onShot('b'), money(0, 'GBP'), { inPackage: true })],
			packages: [{ package: 'p1', total: money(100_001, 'GBP') }]
		});
		const amounts = lineAmounts(req, b, 'USD');
		const a = amounts.get('shot:a')!;
		const bb = amounts.get('shot:b')!;
		expect(a.bid.minor + bb.bid.minor).toBe(100_001);
		// 100,001 pence at 1.2712 is 127,121.27 cents, rounded once to 127,121.
		expect(a.base!.minor + bb.base!.minor).toBe(127_121);
	});

	it('has no base figure while the bid needs a rate', () => {
		const b = bid({ currency: 'GBP', lines: [line('l3', onShot('c'), money(10, 'GBP'))] });
		expect(lineAmounts(req, b, 'USD').get('shot:c')).toEqual({ bid: money(10, 'GBP'), base: null });
	});

	it('leaves an excluded line out', () => {
		const b = bid({ currency: 'USD', lines: [line('l3', onShot('c'), usd(10), { excluded: true })] });
		expect(lineAmounts(req, b, 'USD').has('shot:c')).toBe(false);
	});
});

describe('packageProblems', () => {
	const req = request({
		packages: [
			{ id: 'p1', name: 'Creature' },
			{ id: 'p2', name: 'Comp' }
		],
		shots: [shot('a', { package: 'p1' }), shot('b', { package: 'p1' }), shot('c', { package: 'p2' }), shot('d', { package: 'p1', omitted: true })]
	});
	const resolved = resolvePackages(req);
	const covered = [line('l1', onShot('a'), usd(0), { inPackage: true }), line('l2', onShot('b'), usd(0), { inPackage: true })];

	it('passes a package priced as one figure with every live row covered', () => {
		expect(packageProblems(resolved, req, { lines: [...covered, line('l3', onShot('c'), usd(5))], packages: [{ package: 'p1', total: usd(9) }] })).toEqual([]);
	});

	it('names each break of the rules', () => {
		expect(packageProblems(resolved, req, { lines: [covered[0]], packages: [{ package: 'p1', total: usd(9) }] })).toEqual(['Creature is priced as one figure. B has no line in it.']);
		expect(packageProblems(resolved, req, { lines: [...covered, line('l3', onShot('d'), usd(0), { inPackage: true })], packages: [{ package: 'p1', total: usd(9) }] })).toEqual([
			'D is omitted. It is not in a package price.'
		]);
		expect(packageProblems(resolved, req, { lines: [covered[0], line('l2', onShot('b'), usd(4))], packages: [{ package: 'p1', total: usd(9) }] })).toEqual([
			'B is in Creature, priced as one figure. It takes no price of its own.'
		]);
		expect(packageProblems(resolved, req, { lines: covered, packages: [] })).toEqual(['A is in a package price, but Creature has no one figure.', 'B is in a package price, but Creature has no one figure.']);
		expect(packageProblems(resolved, req, { lines: covered, packages: [{ package: 'p1', total: usd(1) }, { package: 'p1', total: usd(2) }] })).toEqual(['Creature is priced twice.']);
		expect(packageProblems(resolved, req, { lines: [], packages: [{ package: 'p9', total: usd(1) }] })).toEqual(['A package price names a package not in the request.']);
	});

	it('takes a package declined: no line and no figure in it, one package bid on at least', () => {
		expect(packageProblems(resolved, req, { lines: [line('l3', onShot('c'), usd(5))], declined: ['p1'] })).toEqual([]);
		expect(packageProblems(resolved, req, { lines: [line('l1', onShot('a'), usd(5))], declined: ['p1'] })).toEqual(['A is in Creature, which you are not bidding on. It takes no price.']);
		expect(packageProblems(resolved, req, { lines: [], packages: [{ package: 'p1', total: usd(1) }], declined: ['p1'] })).toEqual([
			'You are not bidding on Creature. It takes no price.'
		]);
		expect(packageProblems(resolved, req, { lines: [], declined: ['p1', 'p2'] })).toEqual(['Bid on one package at least.']);
		expect(packageProblems(resolved, req, { lines: [], declined: ['p9'] })).toEqual(['You are not bidding on a package that is not in the request.']);
		// Invited to Comp alone, declining it leaves nothing.
		expect(packageProblems(resolved, req, { lines: [], declined: ['p2'] }, new Set(['p2']))).toEqual(['Bid on one package at least.']);
	});

	it('takes a package figure only within the packages a vendor may see', () => {
		expect(packageProblems(resolved, req, { lines: [], packages: [{ package: 'p1', total: usd(1) }] }, new Set(['p2']))).toEqual(['A package price names a package not in the request.']);
	});
});

describe('partialPackagePicks', () => {
	const req = request({
		packages: [{ id: 'p1', name: 'Creature' }],
		shots: [shot('a', { package: 'p1' }), shot('b', { package: 'p1' }), shot('c', { package: 'p1', omitted: true })]
	});
	const resolved = resolvePackages(req);
	const priced = { id: 'A', packages: [{ package: 'p1', total: usd(1) }] };
	const whole = [{ bidId: 'A', percent: '100' }];

	it('passes a package given whole, or not given', () => {
		expect(partialPackagePicks(resolved, [priced], new Map([['shot:a', whole], ['shot:b', whole]]))).toEqual([]);
		expect(partialPackagePicks(resolved, [priced], new Map())).toEqual([]);
	});

	it('names a package given in part, or split', () => {
		expect(partialPackagePicks(resolved, [priced], new Map([['shot:a', whole]]))).toEqual([{ bidId: 'A', package: 'p1', name: 'Creature' }]);
		const split = [
			{ bidId: 'A', percent: '50' },
			{ bidId: 'B', percent: '50' }
		];
		expect(partialPackagePicks(resolved, [priced], new Map([['shot:a', split], ['shot:b', whole]]))).toHaveLength(1);
	});
});

describe('the vendor sees its packages only', () => {
	const req = request({
		packages: [
			{ id: 'p1', name: 'Creature' },
			{ id: 'p2', name: 'Comp' }
		],
		shots: [shot('a', { package: 'p1' }), shot('b', { package: 'p2' })],
		assets: [asset('x', { package: 'p2' })]
	});
	const resolved = resolvePackages(req);

	it('every package when the invitation names none', () => {
		expect(invitedPackages(resolved, undefined).map((p) => p.id)).toEqual(['p1', 'p2']);
		expect([...visibleRows(resolved, undefined)]).toEqual(['shot:a', 'shot:b', 'asset:x']);
	});

	it('only the packages named, in the request order, ignoring names the request lacks', () => {
		expect(invitedPackages(resolved, ['p2', 'p9']).map((p) => p.id)).toEqual(['p2']);
		expect([...visibleRows(resolved, ['p2'])]).toEqual(['shot:b', 'asset:x']);
		expect([...visibleRows(resolved, [])]).toEqual([]);
	});
});
