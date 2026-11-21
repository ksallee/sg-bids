// Production: the bids list across the site, in every project the person may read. The check is
// $lib/server/production (verifyProductionSite), the frame and action $lib/server/site-route.
import type { RequestHandler } from '@sveltejs/kit';
import { database, verifyProductionSiteClaim } from '$lib/server/env';
import { createProductionBids, type ProductionBids } from '$lib/server/production-bids';
import { listBidsAcross, siteRoute } from '$lib/server/site-route';

let bids: ProductionBids | null = null;

const handler = siteRoute(
	verifyProductionSiteClaim,
	listBidsAcross((principal) => {
		bids ??= createProductionBids(database());
		return bids.listAcross(principal);
	})
);

export const POST: RequestHandler = (event) => handler(event);
