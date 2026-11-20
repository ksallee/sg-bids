/**
 * What a search engine, a link preview and an AI reader get from the public pages: the title, the
 * description, the canonical URL and the Open Graph set per page, `robots.txt` and `sitemap.xml`.
 * Pure. The site's origin comes in as an argument: `$lib/site-url` reads it from `PUBLIC_SITE_URL`.
 *
 * Every page under `src/routes/(public)` is in `PUBLIC_PAGES`, and only those. A test holds the two
 * together. Every other path is the app or the vendor's side: robots.txt keeps crawlers out of the
 * private ones, and `hooks.server.ts` sends `noindex` on all of them (`indexable`).
 */

export const DEFAULT_SITE = 'https://sg-bids.vercel.app';
export const NAME = 'SG Bids';
export const REPO = 'https://github.com/ksallee/sg-bids';
export const AUTHOR = { name: 'Kevin Sallee', url: 'https://github.com/ksallee' } as const;

export interface PublicPage {
	readonly path: string;
	/** Under 60 characters: the page's own subject first, the name last. */
	readonly title: string;
	/** 140 to 160 characters: what it does and for whom, in plain words. */
	readonly description: string;
	/** The page's name in a breadcrumb. */
	readonly label: string;
	/** When its content last changed, `YYYY-MM-DD`, for the sitemap. */
	readonly lastmod: string;
}

export const PUBLIC_PAGES: readonly PublicPage[] = [
	{
		path: '/',
		title: `VFX bidding for Flow Production Tracking · ${NAME}`,
		description:
			'Free, open source VFX bidding for Flow Production Tracking (ShotGrid). Vendors bid through a link with no account. Production compares and awards to Flow PT.',
		label: 'Home',
		lastmod: '2026-11-20'
	},
	{
		path: '/how',
		title: `How it works: vendor bids, awards, Flow PT setup · ${NAME}`,
		description:
			'How a VFX bid round runs in SG Bids: what it reads from and writes to Flow PT, what vendors can see, and the site setup a Flow PT admin does once.',
		label: 'How it works',
		lastmod: '2026-11-20'
	}
];

/** The paths crawlers are kept out of: the vendor's side, the app, its endpoints. */
export const PRIVATE_PREFIXES = ['/v/', '/bids/', '/api/', '/live/', '/dev/'] as const;

/** The AI crawlers named in robots.txt, so it is plain they are welcome on the public pages. */
export const AI_CRAWLERS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'] as const;

/** The share image: `pnpm og` writes it from the page `/dev/og`. */
export const SHARE_IMAGE = {
	path: '/og.png',
	width: 1200,
	height: 630,
	alt: 'SG Bids: VFX bidding for Flow Production Tracking. A comparison grid of three vendor bids, shot by shot, in one currency.'
} as const;

/** The origin from a configured value: http or https, no path, no trailing slash. Anything else is the default. */
export function siteOrigin(value: string | undefined | null): string {
	if (!value) return DEFAULT_SITE;
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_SITE;
		return url.origin;
	} catch {
		return DEFAULT_SITE;
	}
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-11-20` as `20 November 2026`, the same on the server and in any browser. */
export function longDay(day: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
	const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
	return match && month ? `${Number(match[3])} ${month} ${match[1]}` : day;
}

export function publicPage(path: string): PublicPage | undefined {
	return PUBLIC_PAGES.find((page) => page.path === path);
}

/** The files at the root for crawlers and AI readers. */
export const CRAWLER_FILES: readonly string[] = ['/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt'];

/** Whether a search engine may list the path: the public pages and the crawler files only. */
export function indexable(path: string): boolean {
	return publicPage(path) !== undefined || CRAWLER_FILES.includes(path);
}

export interface HeadTag {
	readonly kind: 'meta' | 'link';
	/** `name`, `property`, or `rel` for a link. */
	readonly key: 'name' | 'property' | 'rel';
	readonly id: string;
	/** `content`, or `href` for a link. */
	readonly value: string;
	/** A link's `type`. */
	readonly type?: string;
}

export interface PageHead {
	readonly title: string;
	readonly description: string;
	readonly canonical: string;
	readonly tags: readonly HeadTag[];
}

export function canonicalUrl(origin: string, path: string): string {
	return `${origin}${path}`;
}

/** The head of a public page. A path that is not one throws: a typo should fail the build. */
export function pageHead(path: string, origin: string): PageHead {
	const page = publicPage(path);
	if (!page) throw new Error(`Not a public page: ${path}`);
	const canonical = canonicalUrl(origin, page.path);
	const image = `${origin}${SHARE_IMAGE.path}`;
	const meta = (key: 'name' | 'property', id: string, value: string): HeadTag => ({ kind: 'meta', key, id, value });
	return {
		title: page.title,
		description: page.description,
		canonical,
		tags: [
			meta('name', 'description', page.description),
			{ kind: 'link', key: 'rel', id: 'canonical', value: canonical },
			{ kind: 'link', key: 'rel', id: 'alternate', value: `${origin}/llms.txt`, type: 'text/plain' },
			meta('property', 'og:type', 'website'),
			meta('property', 'og:site_name', NAME),
			meta('property', 'og:locale', 'en_US'),
			meta('property', 'og:title', page.title),
			meta('property', 'og:description', page.description),
			meta('property', 'og:url', canonical),
			meta('property', 'og:image', image),
			meta('property', 'og:image:type', 'image/png'),
			meta('property', 'og:image:width', String(SHARE_IMAGE.width)),
			meta('property', 'og:image:height', String(SHARE_IMAGE.height)),
			meta('property', 'og:image:alt', SHARE_IMAGE.alt),
			meta('name', 'twitter:card', 'summary_large_image'),
			meta('name', 'twitter:title', page.title),
			meta('name', 'twitter:description', page.description),
			meta('name', 'twitter:image', image),
			meta('name', 'twitter:image:alt', SHARE_IMAGE.alt)
		]
	};
}

export function robotsTxt(origin: string): string {
	const rules = (agent: string) => [`User-agent: ${agent}`, 'Allow: /', ...PRIVATE_PREFIXES.map((prefix) => `Disallow: ${prefix}`)].join('\n');
	return [
		'# The public pages are open to every crawler, AI crawlers included.',
		'# The vendor links, the app and its endpoints are private.',
		'',
		rules('*'),
		'',
		...AI_CRAWLERS.flatMap((agent) => [rules(agent), '']),
		`Sitemap: ${origin}/sitemap.xml`,
		''
	].join('\n');
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function sitemapXml(origin: string): string {
	const urls = PUBLIC_PAGES.map((page) => `\t<url>\n\t\t<loc>${xml(canonicalUrl(origin, page.path))}</loc>\n\t\t<lastmod>${page.lastmod}</lastmod>\n\t</url>`);
	return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
}
