/**
 * The public pages render every word of `$lib/pure/public-content`, and `/llms-full.txt` carries
 * the same words: the two cannot drift. Each page has one h1, its title, its tags and its JSON-LD in
 * the HTML a crawler gets.
 */
import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { DOC_FILES, llmsFull } from '$lib/pure/llms';
import { FIELD_TABLES, HOME, HOW } from '$lib/pure/public-content';
import { pageHead, PUBLIC_PAGES } from '$lib/pure/seo';
import { SITE_URL } from '$lib/site-url';
import Home from './+page.svelte';
import How from './how/+page.svelte';

const decode = (html: string): string =>
	html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&');

/** Every string a page shows: all the values in its content, less ids and kinds. */
function words(value: unknown, key = ''): string[] {
	if (typeof value === 'string') return key === 'id' || key === 'kind' ? [] : [value];
	if (Array.isArray(value)) return value.flatMap((item) => words(item));
	if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => words(v, k));
	return [];
}

const pages = [
	{ path: '/', component: Home, content: HOME },
	{ path: '/how', component: How, content: HOW }
] as const;

const full = llmsFull(
	SITE_URL,
	DOC_FILES.map((doc) => ({ ...doc, body: '' }))
);

describe.each(pages)('$path', ({ path, component, content }) => {
	const { head, body } = render(component);
	const text = decode(body);

	it('renders every word of its content', () => {
		const missing = words(content).filter((word) => !text.includes(word));
		expect(missing).toEqual([]);
	});

	it('and llms-full.txt carries each of them too', () => {
		const missing = words(content).filter((word) => !full.includes(word));
		expect(missing).toEqual([]);
	});

	it('has one h1, then h2 and h3 in order', () => {
		expect(body.match(/<h1[\s>]/g)).toHaveLength(1);
		const levels = [...body.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
		levels.forEach((level, i) => {
			if (i > 0) expect(level - levels[i - 1]).toBeLessThanOrEqual(1);
		});
	});

	it('dates its words with a <time>, the day the sitemap gives', () => {
		const day = PUBLIC_PAGES.find((p) => p.path === path)!.lastmod;
		expect(body).toContain(`<time datetime="${day}">`);
	});

	it('names both products near the top, once each in the lead', () => {
		expect(content.lead).toContain('Flow Production Tracking');
		expect(content.lead).toContain('ShotGrid');
		expect(content.lead.split('ShotGrid')).toHaveLength(2);
	});

	it('writes its title, tags and JSON-LD into the head', () => {
		const meta = pageHead(path, SITE_URL);
		expect(decode(head)).toContain(`<title>${meta.title}</title>`);
		for (const tag of meta.tags) expect(decode(head)).toContain(tag.value);
		const blocks = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
		expect(blocks.length).toBeGreaterThan(0);
		for (const block of blocks) expect(block['@context']).toBe('https://schema.org');
	});
});

describe('the copy', () => {
	const all = [...words(HOME), ...words(HOW)].filter((w) => !w.startsWith('http'));

	it('has no dashes', () => {
		expect(all.filter((w) => /[–—]| - /.test(w))).toEqual([]);
	});

	it('opens Home with what sg-bids is', () => {
		expect(HOME.lead.startsWith('sg-bids is a free, open source ')).toBe(true);
	});

	it('answers each question in two sentences', () => {
		const questions = [...HOME.questions, HOW.steps, HOW.vendors, HOW.written, HOW.stays, HOW.see, HOW.money, HOW.admin];
		for (const q of questions) {
			expect(q.q.endsWith('?')).toBe(true);
			expect(q.a.match(/[.?!](\s|$)/g), q.a).toHaveLength(2);
		}
	});

	it('lists the fields the app creates on the How page', () => {
		const { body } = render(How);
		for (const table of FIELD_TABLES) for (const field of table.fields) expect(body).toContain(field.name);
	});
});

describe('the crawler file routes', () => {
	const read = async (route: string) => {
		const mod = (await import(`../${route}/+server.ts`)) as { GET: () => Response; prerender: boolean };
		expect(mod.prerender).toBe(true);
		const response = mod.GET();
		return { type: response.headers.get('content-type'), body: await response.text() };
	};

	it('serve the crawler files with their types, prerendered', async () => {
		expect((await read('robots.txt')).type).toBe('text/plain; charset=utf-8');
		expect((await read('sitemap.xml')).type).toBe('application/xml; charset=utf-8');
		expect((await read('llms.txt')).type).toBe('text/plain; charset=utf-8');
		expect((await read('llms-full.txt')).type).toBe('text/plain; charset=utf-8');
	});

	it('put every doc in llms-full.txt as it is in the repo', async () => {
		const { body } = await read('llms-full.txt');
		for (const doc of DOC_FILES) expect(body).toContain(readFileSync(doc.path, 'utf8').trim());
	});
});
