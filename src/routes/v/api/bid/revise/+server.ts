// Opens the next version as a draft (`{invitationId, bidId}` of the latest), a copy of the latest
// submitted or withdrawn bid.
import { revise } from '$lib/server/vendor-api';
import { vendorEndpoint } from '$lib/server/vendor-http';

export const POST = vendorEndpoint((store, token, body) => revise(store, token, body, new Date().toISOString().slice(0, 10)));
