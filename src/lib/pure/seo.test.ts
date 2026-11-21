import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	AI_CRAWLERS,
	DEFAULT_SITE,
	indexable,
	longDay,
	NAME,
	pageHead,
	PRIVATE_PREFIXES,
	PUBLIC_PAGES,
	robotsTxt,
	SHARE_IMAGE,
	siteOrigin,
	sitemapXml
} from './seo';

const ORIGIN = 'https://bids.example.com';

/** The routes under `src/routes/(public)`, as paths: every `+page.svelte` there. */
function publicRoutes(): string[] {
	const root = join(process.cwd(), 'src/routes/(public)');
	const found: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (name === '+page.svelte') found.push(`/${relative(root, dir)}`.replace(/\/$/, '') || '/');
		}
	};
	walk(root);
	return found.sort();
}

describe('PUBLIC_PAGES', () => {
	it('lists every page under (public), and only those', () => {
		expect(PUBLIC_PAGES.map((page) => page.path).sort()).toEqual(publicRoutes());
	});

	it.each(PUBLIC_PAGES.map((page) => [page.path, page] as const))('%s: a title under 60 characters, the name last', (_, page) => {
		expect(page.title.length).toBeLessThan(60);
		expect(page.title.endsWith(` · ${NAME}`)).toBe(true);
		expect(page.title.startsWith(NAME)).toBe(false);
	});

	it.each(PUBLIC_PAGES.map((page) => [page.path, page] as const))('%s: a description of 140 to 160 characters, no dashes', (_, page) => {
		expect(page.description.length).toBeGreaterThanOrEqual(140);
		expect(page.description.length).toBeLessThanOrEqual(160);
		expect(page.description).not.toMatch(/[–—]| - /);
	});

	it('gives each page its own title and description', () => {
		expect(new Set(PUBLIC_PAGES.map((page) => page.title)).size).toBe(PUBLIC_PAGES.length);
		expect(new Set(PUBLIC_PAGES.map((page) => page.description)).size).toBe(PUBLIC_PAGES.length);
	});

	it('dates each page as a real day', () => {
		for (const page of PUBLIC_PAGES) {
			expect(page.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(new Date(`${page.lastmod}T00:00:00Z`).toISOString().slice(0, 10)).toBe(page.lastmod);
		}
	});
});

describe('longDay', () => {
	it('writes a day in words, with no locale or time zone in play', () => {
		expect(longDay('2026-11-20')).toBe('20 November 2026');
		expect(longDay('2027-01-05')).toBe('5 January 2027');
	});

	it('leaves anything that is not a day as it is', () => {
		expect(longDay('2026-13-01')).toBe('2026-13-01');
		expect(longDay('soon')).toBe('soon');
	});
});

describe('siteOrigin', () => {
	it('is the hosted demo when nothing is set', () => {
		expect(siteOrigin(undefined)).toBe(DEFAULT_SITE);
		expect(siteOrigin('')).toBe(DEFAULT_SITE);
		expect(DEFAULT_SITE).toBe('https://sg-bids.vercel.app');
	});

	it('keeps the origin of a set value, without a path or a trailing slash', () => {
		expect(siteOrigin('https://bids.example.com/')).toBe(ORIGIN);
		expect(siteOrigin(' https://bids.example.com/some/path ')).toBe(ORIGIN);
		expect(siteOrigin('http://localhost:5181')).toBe('http://localhost:5181');
	});

	it('falls back to the default on anything that is not an http URL', () => {
		expect(siteOrigin('bids.example.com')).toBe(DEFAULT_SITE);
		expect(siteOrigin('javascript:alert(1)')).toBe(DEFAULT_SITE);
		expect(siteOrigin('ftp://bids.example.com')).toBe(DEFAULT_SITE);
	});
});

describe('pageHead', () => {
	const value = (head: ReturnType<typeof pageHead>, id: string) => head.tags.find((tag) => tag.id === id)?.value;

	it.each(PUBLIC_PAGES.map((page) => [page.path] as const))('%s: every tag a search result and a link preview read', (path) => {
		const head = pageHead(path, ORIGIN);
		const page = PUBLIC_PAGES.find((p) => p.path === path)!;
		const url = `${ORIGIN}${path}`;
		expect(head.title).toBe(page.title);
		expect(head.canonical).toBe(url);
		expect(value(head, 'description')).toBe(page.description);
		expect(value(head, 'canonical')).toBe(url);
		expect(value(head, 'og:title')).toBe(page.title);
		expect(value(head, 'og:description')).toBe(page.description);
		expect(value(head, 'og:type')).toBe('website');
		expect(value(head, 'og:url')).toBe(url);
		expect(value(head, 'og:site_name')).toBe(NAME);
		expect(value(head, 'og:image')).toBe(`${ORIGIN}/og.png`);
		expect(value(head, 'og:image:width')).toBe('1200');
		expect(value(head, 'og:image:height')).toBe('630');
		expect(value(head, 'og:image:alt')).toBe(SHARE_IMAGE.alt);
		expect(value(head, 'twitter:card')).toBe('summary_large_image');
		expect(value(head, 'twitter:title')).toBe(page.title);
		expect(value(head, 'twitter:description')).toBe(page.description);
		expect(value(head, 'twitter:image')).toBe(`${ORIGIN}/og.png`);
	});

	it('takes every URL from the origin it is given', () => {
		const head = pageHead('/how', ORIGIN);
		for (const tag of head.tags) {
			if (/^https?:/.test(tag.value)) expect(tag.value.startsWith(ORIGIN)).toBe(true);
		}
		expect(JSON.stringify(head)).not.toContain(DEFAULT_SITE);
	});

	it('names each tag once', () => {
		const head = pageHead('/', ORIGIN);
		const ids = head.tags.map((tag) => `${tag.kind}:${tag.id}`);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('refuses a path that is not a public page', () => {
		expect(() => pageHead('/bids/new', ORIGIN)).toThrow();
	});

	it('describes the share image in under 420 characters, as the alt limit of a preview card', () => {
		expect(SHARE_IMAGE.alt.length).toBeLessThan(420);
	});
});

describe('indexable', () => {
	it('lists the public pages and the crawler files', () => {
		for (const page of PUBLIC_PAGES) expect(indexable(page.path)).toBe(true);
		for (const file of ['/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt']) expect(indexable(file)).toBe(true);
	});

	it('keeps every app and vendor path out', () => {
		for (const path of ['/connect', '/bids', '/bids/new', '/bids/abc/compare', '/requests', '/requests/new', '/requests/abc/compare', '/v', '/v/open', '/v/token', '/api/production/list', '/live/session-poll', '/dev/fpt', '/dev/og']) {
			expect(indexable(path)).toBe(false);
		}
	});
});

describe('robotsTxt', () => {
	const robots = robotsTxt(ORIGIN);

	it('allows the site and keeps crawlers out of the private paths', () => {
		expect(robots).toContain('User-agent: *\nAllow: /');
		for (const prefix of ['/v/', '/bids/', '/requests/', '/api/', '/live/', '/dev/']) expect(robots).toContain(`Disallow: ${prefix}`);
		expect(PRIVATE_PREFIXES).toHaveLength(6);
	});

	it('names the AI crawlers as allowed, each with the same private paths, since a named group replaces *', () => {
		for (const agent of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
			const group = robots.split('\n\n').find((block) => block.startsWith(`User-agent: ${agent}\n`));
			expect(group).toBeDefined();
			expect(group).toContain('Allow: /');
			for (const prefix of PRIVATE_PREFIXES) expect(group).toContain(`Disallow: ${prefix}`);
		}
		expect(AI_CRAWLERS).toHaveLength(4);
	});

	it('disallows no public page', () => {
		for (const line of robots.split('\n').filter((l) => l.startsWith('Disallow:'))) {
			const prefix = line.slice('Disallow: '.length);
			for (const page of PUBLIC_PAGES) expect(page.path.startsWith(prefix)).toBe(false);
		}
	});

	it('points to the sitemap on the origin', () => {
		expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
	});
});

describe('sitemapXml', () => {
	const sitemap = sitemapXml(ORIGIN);

	it('lists each public page with its date, and nothing else', () => {
		for (const page of PUBLIC_PAGES) expect(sitemap).toContain(`<loc>${ORIGIN}${page.path}</loc>\n\t\t<lastmod>${page.lastmod}</lastmod>`);
		expect(sitemap.match(/<url>/g)).toHaveLength(PUBLIC_PAGES.length);
	});

	it('is a urlset in the sitemap namespace', () => {
		expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
		expect(sitemap.trimEnd().endsWith('</urlset>')).toBe(true);
	});
});
