// The vendor's pages and endpoints, `/v` and below: no referrer leaves them, nothing of them is
// cached, and no search engine lists them (`$lib/server/vendor-http`).
import type { Handle } from '@sveltejs/kit';
import { isVendorPath } from '$lib/pure/vendor-path';
import { VENDOR_HEADERS } from '$lib/server/vendor-http';

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	if (isVendorPath(event.url.pathname)) {
		for (const [name, value] of Object.entries(VENDOR_HEADERS)) response.headers.set(name, value);
	}
	return response;
};
