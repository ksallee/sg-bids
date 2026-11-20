// Discards the vendor's open draft (`{invitationId, bidId}`): back to empty, or to the last submitted version.
import { discard } from '$lib/server/vendor-api';
import { vendorEndpoint } from '$lib/server/vendor-http';

export const POST = vendorEndpoint((store, token, body) => discard(store, token, body));
