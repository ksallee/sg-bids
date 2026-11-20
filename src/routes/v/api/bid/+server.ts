// The vendor's own latest bid (GET), and its draft saved (PUT `{invitationId, bidId, draft}`).
import { loadBid, saveDraft } from '$lib/server/vendor-api';
import { vendorEndpoint } from '$lib/server/vendor-http';

export const GET = vendorEndpoint((store, token) => loadBid(store, token));
export const PUT = vendorEndpoint((store, token, body) => saveDraft(store, token, body));
