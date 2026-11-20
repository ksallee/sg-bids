// Production: list. The action and its checks are in $lib/server/production-actions.
import type { RequestHandler } from '@sveltejs/kit';
import { listRequests } from '$lib/server/production-actions';
import { productionRoute } from '$lib/server/production-route';

export const POST: RequestHandler = (event) => productionRoute(event, listRequests);
