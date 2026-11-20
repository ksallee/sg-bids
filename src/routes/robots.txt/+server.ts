// Written at build from `$lib/pure/seo`, so the sitemap line carries the configured origin.
import { robotsTxt } from '$lib/pure/seo';
import { SITE_URL } from '$lib/site-url';

export const prerender = true;

export const GET = (): Response => new Response(robotsTxt(SITE_URL), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
