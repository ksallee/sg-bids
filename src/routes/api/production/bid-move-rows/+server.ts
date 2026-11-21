// Production: rows of one bid to another. The action and its checks are in $lib/server/production-actions.
import type { RequestHandler } from '@sveltejs/kit';
import { moveBidRows } from '$lib/server/production-actions';
import { productionRoute } from '$lib/server/production-route';

export const POST: RequestHandler = (event) => productionRoute(event, moveBidRows);
