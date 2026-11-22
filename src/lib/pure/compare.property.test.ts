import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { worldArb } from './arbitraries';
import { applyScenario, compareBids, type Grid } from './compare';
import { targetKey } from './model';
import { resolvePackages } from './packages';

const worlds = worldArb();

/** Each bid's cells, package cells and totals, by bid id: what a column shows, wherever it sits. */
function byBid(grid: Grid) {
	return Object.fromEntries(
		grid.columns.map((column, i) => [
			column.bidId,
			{
				column,
				cells: grid.rows.map((r) => r.cells[i]),
				packages: grid.packages.map((p) => p.cells[i]),
				totals: grid.totals[i]
			}
		])
	);
}

describe('the comparison, for any request and answers', () => {
	it('marks lowest exactly the row prices that sit on the row’s minimum', () => {
		fc.assert(
			fc.property(worlds, ({ request, bids }) => {
				const grid = compareBids(request, bids);
				for (const row of grid.rows) {
					const known = row.cells.flatMap((c) => (c.kind === 'price' && c.amount.base ? [c.amount.base.minor] : []));
					const min = known.length > 0 ? Math.min(...known) : null;
					expect(row.lowest).toBe(min);
					row.cells.forEach((c, i) => {
						const onMin = c.kind === 'price' && c.amount.base !== null && c.amount.base.minor === min;
						if (c.kind === 'price') expect(c.lowest).toBe(onMin);
						expect(row.lowestColumns.includes(i)).toBe(onMin);
					});
				}
				for (const pkg of grid.packages) {
					const comparable = pkg.cells.map((c) => ((c.kind === 'package' || (c.kind === 'rows' && c.complete)) && c.amount.base ? c.amount.base.minor : null));
					const known = comparable.filter((m): m is number => m !== null);
					expect(pkg.lowest).toBe(known.length > 0 ? Math.min(...known) : null);
					pkg.cells.forEach((c, i) => {
						const onMin = comparable[i] !== null && comparable[i] === pkg.lowest;
						if (c.kind === 'package' || c.kind === 'rows') expect(c.lowest).toBe(onMin);
						expect(pkg.lowestColumns.includes(i)).toBe(onMin);
					});
				}
			})
		);
	});

	it('shows every live row of a bid priced as one figure as in the figure, never as a price, a zero or a gap', () => {
		fc.assert(
			fc.property(worlds, ({ request, bids }) => {
				const grid = compareBids(request, bids);
				const resolved = resolvePackages(request);
				const rowOf = new Map(grid.rows.map((r) => [targetKey(r.target), r]));
				bids.forEach((bid, i) => {
					for (const price of bid.packages ?? []) {
						for (const target of resolved.live.get(price.package) ?? []) expect(rowOf.get(targetKey(target))!.cells[i]).toMatchObject({ kind: 'package', package: price.package });
						expect(grid.packages.find((p) => p.id === price.package)!.cells[i]).toMatchObject({ kind: 'package', amount: { bid: price.total } });
					}
					for (const pkg of bid.declined ?? []) {
						for (const target of resolved.rows.get(pkg) ?? []) expect(rowOf.get(targetKey(target))!.cells[i]).toEqual({ kind: 'declined', package: pkg });
						expect(grid.packages.find((p) => p.id === pkg)!.cells[i]).toEqual({ kind: 'declined' });
					}
				});
			})
		);
	});

	it('shows the same figures for every vendor whatever order the vendors come in', () => {
		const arb = worlds.chain((w) => fc.shuffledSubarray([...w.bids], { minLength: w.bids.length, maxLength: w.bids.length }).map((order) => ({ ...w, order })));
		fc.assert(
			fc.property(arb, ({ request, bids, order, scenario }) => {
				expect(byBid(compareBids(request, order))).toEqual(byBid(compareBids(request, bids)));
				const a = applyScenario(request, bids, scenario);
				const b = applyScenario(request, order, scenario);
				expect(b.total).toEqual(a.total);
				expect(new Map(b.perVendor.map((p) => [p.vendorId, p.amount]))).toEqual(new Map(a.perVendor.map((p) => [p.vendorId, p.amount])));
			})
		);
	});
});
