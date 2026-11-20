import { describe, expect, it } from 'vitest';
import { HOW_QUESTIONS } from './public-content';
import { AUTHOR, PUBLIC_PAGES, REPO } from './seo';
import { answerText, breadcrumbs, faqPage, ldJson, LICENSE, pageLd, softwareApplication } from './structured-data';

const ORIGIN = 'https://bids.example.com';

/** The shape schema.org asks of a node: a context on the top one, a type on each. */
function typed(node: unknown, top = true): void {
	if (Array.isArray(node)) return node.forEach((item) => typed(item, false));
	if (!node || typeof node !== 'object') return;
	const record = node as Record<string, unknown>;
	if (top) expect(record['@context']).toBe('https://schema.org');
	const nested = Object.entries(record).filter(([key, value]) => !key.startsWith('@') && value && typeof value === 'object');
	if (!top && !Array.isArray(node) && Object.keys(record).some((k) => !k.startsWith('@'))) expect(typeof record['@type']).toBe('string');
	for (const [, value] of nested) typed(value, false);
}

describe('softwareApplication', () => {
	const app = softwareApplication(ORIGIN);

	it('is a free web app under the MIT license', () => {
		expect(app['@type']).toBe('SoftwareApplication');
		expect(app.name).toBe('SG Bids');
		expect(app.operatingSystem).toBe('Web');
		expect(app.applicationCategory).toBe('BusinessApplication');
		expect(app.offers).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
		expect(app.license).toBe(LICENSE);
		expect(app.url).toBe(`${ORIGIN}/`);
		expect(app.description).toBe(PUBLIC_PAGES[0].description);
		expect(typeof app.image).toBe('string');
	});

	it('names its author by name and GitHub profile, no email', () => {
		expect(app.author).toEqual({ '@type': 'Person', name: 'Kevin Sallee', url: 'https://github.com/ksallee' });
		expect(AUTHOR.url).toBe('https://github.com/ksallee');
		expect(JSON.stringify(app)).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}|mailto:|"email"/i);
	});

	it('points to its source code on GitHub', () => {
		expect(app.isBasedOn).toMatchObject({ '@type': 'SoftwareSourceCode', codeRepository: REPO, license: LICENSE });
	});

	it('lists features as plain strings', () => {
		const features = app.featureList as string[];
		expect(features.length).toBeGreaterThan(3);
		for (const feature of features) expect(typeof feature).toBe('string');
	});

	it('has the shape schema.org asks for', () => typed(app));
});

describe('faqPage', () => {
	const faq = faqPage(ORIGIN, '/how', HOW_QUESTIONS);

	it('has a Question with an accepted Answer per question of the page', () => {
		expect(faq['@type']).toBe('FAQPage');
		const entities = faq.mainEntity as { '@type': string; name: string; acceptedAnswer: { '@type': string; text: string } }[];
		expect(entities).toHaveLength(HOW_QUESTIONS.length);
		entities.forEach((entity, i) => {
			expect(entity['@type']).toBe('Question');
			expect(entity.name).toBe(HOW_QUESTIONS[i].q);
			expect(entity.acceptedAnswer['@type']).toBe('Answer');
			expect(entity.acceptedAnswer.text.startsWith(HOW_QUESTIONS[i].a)).toBe(true);
		});
	});

	it('answers with the two sentences, then the list and the note', () => {
		const q = { id: 'x', q: 'Q?', a: 'One. Two.', list: ['A.', 'B.'], note: 'N.' };
		expect(answerText(q)).toBe('One. Two. A. B. N.');
		expect(answerText({ id: 'y', q: 'Q?', a: 'One. Two.' })).toBe('One. Two.');
	});

	it('has the shape schema.org asks for', () => typed(faq));
});

describe('breadcrumbs', () => {
	it('goes Home, then the page', () => {
		expect(breadcrumbs(ORIGIN, '/how')).toEqual({
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			itemListElement: [
				{ '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
				{ '@type': 'ListItem', position: 2, name: 'How it works', item: `${ORIGIN}/how` }
			]
		});
	});
});

describe('pageLd', () => {
	it('gives every public page at least one block, each with a context and a type', () => {
		for (const page of PUBLIC_PAGES) {
			const blocks = pageLd(page.path, ORIGIN);
			expect(blocks.length).toBeGreaterThan(0);
			for (const block of blocks) typed(block);
		}
	});

	it('puts the app on Home, and the FAQ and breadcrumbs on How it works', () => {
		expect(pageLd('/', ORIGIN).map((b) => b['@type'])).toEqual(['SoftwareApplication']);
		expect(pageLd('/how', ORIGIN).map((b) => b['@type'])).toEqual(['FAQPage', 'BreadcrumbList']);
	});
});

describe('ldJson', () => {
	it('is JSON that parses back, with no < left to close the script', () => {
		const value = { '@context': 'https://schema.org', '@type': 'Thing', name: '</script><script>alert(1)</script>' };
		const text = ldJson(value);
		expect(text).not.toContain('<');
		expect(JSON.parse(text)).toEqual(value);
	});
});
