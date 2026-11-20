/**
 * The security headers every answer carries, and the Content-Security-Policy. Pure, no I/O.
 *
 * SvelteKit writes the CSP from `CSP_DIRECTIVES` (`vite.config.ts`, `csp`), with a nonce for each
 * inline script it renders. The Flow PT site is only known at run time (`FPT_SITE_HOSTS`), so
 * `hooks.server.ts` adds the site origins to `connect-src` and `img-src` with `withSources`.
 *
 * - The browser calls the site's REST API itself (062), so the site goes in `connect-src`.
 * - Pictures are presigned media URLs on Amazon S3 buckets, `<bucket>.s3-accelerate.amazonaws.com`
 *   measured (125, 141, field type url), `s3.amazonaws.com` documented (129); status glyphs are
 *   data URLs or site paths. So `img-src` is self, data, blob, the site, and those two.
 * - `style-src` keeps `'unsafe-inline'`: Svelte transitions and the floating parts of the widgets
 *   write inline styles at run time, which a nonce cannot cover. Scripts take no such allowance.
 */

import type { KitConfig } from '@sveltejs/kit';

type Directives = NonNullable<NonNullable<KitConfig['csp']>['directives']>;

/** SvelteKit's `csp.directives`: keywords without quotes, as SvelteKit writes them. */
export const CSP_DIRECTIVES: Directives = {
	'default-src': ['self'],
	'script-src': ['self'],
	'style-src': ['self', 'unsafe-inline'],
	'img-src': ['self', 'data:', 'blob:'],
	'font-src': ['self', 'data:'],
	'connect-src': ['self'],
	'object-src': ['none'],
	'base-uri': ['self'],
	'form-action': ['self'],
	'frame-ancestors': ['none'],
	'manifest-src': ['self'],
	'worker-src': ['self']
};

/** Where Flow PT media lives (see above). */
export const MEDIA_HOSTS = ['https://*.s3-accelerate.amazonaws.com', 'https://*.s3.amazonaws.com'] as const;

/** For an answer that is not a page (JSON, a redirect): nothing loads, nothing frames it. */
export const NON_PAGE_CSP = "default-src 'none'; frame-ancestors 'none'";

export function securityHeaders(options: { https: boolean }): Record<string, string> {
	return {
		'X-Content-Type-Options': 'nosniff',
		'Referrer-Policy': 'same-origin',
		'X-Frame-Options': 'DENY',
		...(options.https ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {})
	};
}

const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** The site allowlist (`fpt-session.allowedHosts`) as CSP sources. Anything that is not a host is dropped. */
export function cspSources(allowed: readonly string[]): { 'connect-src': string[]; 'img-src': string[] } {
	const sites = allowed.filter((host) => HOST.test(host)).map((host) => `https://${host}`);
	return { 'connect-src': sites, 'img-src': [...sites, ...MEDIA_HOSTS] };
}

/** The policy with sources added to the directives named; a directive it lacks is added at the end. */
export function withSources(csp: string, add: Readonly<Record<string, readonly string[]>>): string {
	const parts = csp
		.split(';')
		.map((part) => part.trim())
		.filter(Boolean);
	for (const [directive, sources] of Object.entries(add)) {
		if (sources.length === 0) continue;
		const index = parts.findIndex((part) => part.split(/\s+/)[0] === directive);
		if (index < 0) parts.push(`${directive} ${sources.join(' ')}`);
		else parts[index] = `${parts[index]} ${sources.join(' ')}`;
	}
	return parts.join('; ');
}
