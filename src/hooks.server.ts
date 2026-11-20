// Every answer: nosniff, a referrer policy, no framing, HSTS over https, and a Content-Security-
// Policy (`$lib/pure/security-headers`). SvelteKit writes a page's policy with its script nonces
// (`vite.config.ts`); this adds the Flow PT site the browser calls, known only at run time. An
// answer that is not a page gets a policy that loads nothing.
//
// The vendor's pages and endpoints, on top: no referrer leaves them, nothing of them is cached,
// and no search engine lists them (`$lib/server/vendor-http`).
import type { Handle } from '@sveltejs/kit';
import { cspSources, NON_PAGE_CSP, securityHeaders, withSources } from '$lib/pure/security-headers';
import { isVendorPath } from '$lib/pure/vendor-path';
import { browserSiteHosts } from '$lib/server/env';
import { VENDOR_HEADERS } from '$lib/server/vendor-http';

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	for (const [name, value] of Object.entries(securityHeaders({ https: event.url.protocol === 'https:' }))) response.headers.set(name, value);
	const csp = response.headers.get('content-security-policy');
	response.headers.set('content-security-policy', csp ? withSources(csp, cspSources(browserSiteHosts())) : NON_PAGE_CSP);
	if (isVendorPath(event.url.pathname)) {
		for (const [name, value] of Object.entries(VENDOR_HEADERS)) response.headers.set(name, value);
		// The link question page posts a form. Under no-referrer the browser sends `Origin: null`,
		// which SvelteKit's origin check refuses. Its address holds no token (the token is in a
		// cookie by then), and same-origin sends no referrer to any other site.
		if (event.url.pathname === '/v/open') response.headers.set('Referrer-Policy', 'same-origin');
	}
	return response;
};
