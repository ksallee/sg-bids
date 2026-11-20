/**
 * The public site's origin: `PUBLIC_SITE_URL` at build (`vite.config.ts`, `define`), else the
 * hosted demo. The one place it is read; pages and endpoints take it from here.
 */
import { siteOrigin } from '$lib/pure/seo';

export const SITE_URL: string = siteOrigin(__SITE_URL__);
