/**
 * A draft request as its bids make it. Pure, no I/O.
 *
 * A draft owns its bids: one package of the request per bid, its rows in the bid
 * (`production_bid_items`). What the draft holds is composed from them (`composeDraft`): each bid's
 * rows under its package, the package named as the bid. The issue writes exactly that and freezes it
 * (`sg_issue_request`). A row sits in one bid of a request: the database holds it.
 */

import type { Id, ProductionBid, RequestAsset, RequestPackage, RequestShot } from './model';

export interface Composed {
	readonly packages: RequestPackage[];
	readonly shots: RequestShot[];
	readonly assets: RequestAsset[];
}

/**
 * A draft request as its bids make it. `packages`: the draft's, in order, each naming its bid;
 * `bids`: those bids by id. A package whose bid is not given is left out.
 */
export function composeDraft(packages: readonly RequestPackage[], bids: ReadonlyMap<Id, ProductionBid>): Composed {
	const kept = packages.flatMap((p) => {
		const bid = p.bid ? bids.get(p.bid) : undefined;
		return bid ? [{ pkg: p, bid }] : [];
	});
	return {
		packages: kept.map(({ pkg, bid }) => ({ id: pkg.id, name: pkg.name, bid: bid.id })),
		shots: kept.flatMap(({ pkg, bid }) => bid.shots.map((s) => ({ ...s, package: pkg.id }))),
		assets: kept.flatMap(({ pkg, bid }) => bid.assets.map((a) => ({ ...a, package: pkg.id })))
	};
}
