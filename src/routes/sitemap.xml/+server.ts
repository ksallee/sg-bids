// Written at build from the list of public pages in `$lib/pure/seo`.
import { sitemapXml } from '$lib/pure/seo';
import { SITE_URL } from '$lib/site-url';

export const prerender = true;

export const GET = (): Response => new Response(sitemapXml(SITE_URL), { headers: { 'content-type': 'application/xml; charset=utf-8' } });
