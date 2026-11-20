// Production: the requests list across the site, in every project the person may read. The check
// is $lib/server/production (verifyProductionSite), the frame and action $lib/server/site-route.
import type { RequestHandler } from '@sveltejs/kit';
import { database, verifyProductionSiteClaim } from '$lib/server/env';
import { createRequests, type Requests } from '$lib/server/requests';
import { listRequestsAcross, siteRoute } from '$lib/server/site-route';

let requests: Requests | null = null;

const handler = siteRoute(
	verifyProductionSiteClaim,
	listRequestsAcross((principal) => {
		requests ??= createRequests(database());
		return requests.listAcross(principal);
	})
);

export const POST: RequestHandler = (event) => handler(event);
