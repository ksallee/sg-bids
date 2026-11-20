// Production: award-undo, after the undo of the award in Flow PT. The checks are in $lib/server/award-actions.
import type { RequestHandler } from '@sveltejs/kit';
import { undoAward } from '$lib/server/award-actions';
import { productionRoute } from '$lib/server/production-route';

export const POST: RequestHandler = (event) => productionRoute(event, undoAward);
