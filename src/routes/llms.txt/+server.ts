// llmstxt.org: what sg-bids is and where to read more. Written at build from `$lib/pure/llms`.
import { llmsTxt } from '$lib/pure/llms';
import { SITE_URL } from '$lib/site-url';

export const prerender = true;

export const GET = (): Response => new Response(llmsTxt(SITE_URL), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
