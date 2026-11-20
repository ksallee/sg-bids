// Withdraws the vendor's submitted bid (`{invitationId, bidId}`).
import { withdraw } from '$lib/server/vendor-api';
import { vendorEndpoint } from '$lib/server/vendor-http';

export const POST = vendorEndpoint((store, token, body) => withdraw(store, token, body));
