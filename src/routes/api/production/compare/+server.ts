// Production: compare. The action and its checks are in $lib/server/compare-actions.
import type { RequestHandler } from '@sveltejs/kit';
import { compare } from '$lib/server/compare-actions';
import { productionRoute } from '$lib/server/production-route';

export const POST: RequestHandler = (event) => productionRoute(event, compare);
