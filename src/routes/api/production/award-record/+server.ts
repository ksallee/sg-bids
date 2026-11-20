// Production: award-record, after a run of the award in Flow PT. The checks are in $lib/server/award-actions.
import type { RequestHandler } from '@sveltejs/kit';
import { recordAward } from '$lib/server/award-actions';
import { productionRoute } from '$lib/server/production-route';

export const POST: RequestHandler = (event) => productionRoute(event, recordAward);
