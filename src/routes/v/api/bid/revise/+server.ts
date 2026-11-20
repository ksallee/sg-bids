// Opens the next version as a draft, a copy of the latest submitted or withdrawn bid.
import { revise } from '$lib/server/vendor-api';
import { vendorEndpoint } from '$lib/server/vendor-http';

export const POST = vendorEndpoint((store, token) => revise(store, token, new Date().toISOString().slice(0, 10)));
