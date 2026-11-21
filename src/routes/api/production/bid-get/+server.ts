// Production: a bid with its rows. The action and its checks are in $lib/server/production-actions.
import type { RequestHandler } from '@sveltejs/kit';
import { getBid } from '$lib/server/production-actions';
import { productionRoute } from '$lib/server/production-route';

export const POST: RequestHandler = (event) => productionRoute(event, getBid);
