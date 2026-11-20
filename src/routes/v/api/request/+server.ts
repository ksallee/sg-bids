// The request as production froze it, for the vendor holding the link.
import { loadRequest } from '$lib/server/vendor-api';
import { vendorEndpoint } from '$lib/server/vendor-http';

export const GET = vendorEndpoint((store, token) => loadRequest(store, token));
