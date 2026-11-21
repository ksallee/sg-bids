import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { answerArb, uuid, worldArb } from './arbitraries';
import type { ProductionBid } from './model';
import { composeDraft } from './request-bids';
import { bidFromRows, bidToRows, itemsFromRows, itemsToRows, packagesFromRows, packagesToRows, scenarioFromRows, scenarioToRows, type BidLineRow, type BidRow } from './rows';

const strip = <T extends { package?: string }>({ package: _, ...rest }: T) => rest;

describe('a request issued from its bids, for any request', () => {
	it('reads back the rows and bids it was issued with', () => {
		const arb = worldArb().filter((w) => (w.request.packages ?? []).length > 0);
		fc.assert(
			fc.property(arb, ({ request }) => {
				// Each package of the request comes from a production bid holding its rows.
				const packages = request.packages!.map((p, i) => ({ ...p, bid: uuid(10, i) }));
				const bids = new Map<string, ProductionBid>(
					packages.map((p) => [
						p.bid,
						{ id: p.bid, name: p.name, shots: request.shots.filter((s) => s.package === p.id).map(strip), assets: request.assets.filter((a) => a.package === p.id).map(strip) }
					])
				);
				const issued = composeDraft(packages, bids);
				const items = itemsToRows(issued.shots, issued.assets);
				const stored = packagesToRows(issued.packages).map((row, position) => ({ ...row, position, bid_id: issued.packages[position].bid }));
				expect(itemsFromRows(items)).toEqual({ shots: issued.shots, assets: issued.assets });
				expect(packagesFromRows(stored)).toEqual(issued.packages);
				// Every row of the request, once, under its package.
				expect(issued.shots.length + issued.assets.length).toBe(request.shots.length + request.assets.length);
			})
		);
	});
});

describe('a vendor’s answer and a scenario, stored and read back, for any of them', () => {
	it('reads back the answer the vendor sent', () => {
		fc.assert(
			fc.property(answerArb(), ({ request, bid }) => {
				const { bid: columns, lines } = bidToRows(bid, request.header.baseCurrency);
				const tenant = { site_host: 'studio.test', project_id: 1180 };
				const row: BidRow = { ...columns, ...tenant, id: bid.id, invitation_id: bid.vendorId, request_id: bid.requestId, version: 1, status: bid.status as BidRow['status'], submitted_at: null, withdrawn_at: null, created_at: '', updated_at: '' };
				const lineRows: BidLineRow[] = lines.map((l, i) => ({ ...l, ...tenant, id: bid.lines[i].id, bid_id: bid.id, invitation_id: bid.vendorId, request_id: bid.requestId }));
				expect(bidFromRows(overTheWire(row), overTheWire(lineRows), { round: request.header.round, baseCurrency: request.header.baseCurrency })).toEqual(bid);
			})
		);
	});

	it('reads back the scenario it saved', () => {
		fc.assert(
			fc.property(worldArb(), ({ scenario }) => {
				const items = scenarioToRows(scenario.picks);
				expect(scenarioFromRows({ id: scenario.id, request_id: scenario.requestId, name: scenario.name, site_host: 'studio.test', project_id: 1180, created_at: '', updated_at: '' }, items)).toEqual(scenario);
			})
		);
	});
});

/** Through jsonb and back. */
function overTheWire<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
