// Submits the vendor's draft (`{invitationId, bidId}`). It is final from here: a change is a new version.
import { submit } from '$lib/server/vendor-api';
import { vendorEndpoint } from '$lib/server/vendor-http';

export const POST = vendorEndpoint((store, token, body) => submit(store, token, body));
