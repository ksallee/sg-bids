/**
 * schema.org JSON-LD for the public pages. Pure. Only what is true of the app today.
 *
 * - Home: the app as a `SoftwareApplication`, free, MIT, built from its source on GitHub.
 * - How it works: its questions as a `FAQPage`, and a `BreadcrumbList` back to Home.
 *
 * `ldJson` writes a value for a `<script type="application/ld+json">` with every `<` escaped, so no
 * string in the data can close the script.
 */

import { HOME, HOW_QUESTIONS, type Question } from './public-content';
import { AUTHOR, canonicalUrl, NAME, publicPage, REPO, SHARE_IMAGE } from './seo';

export type Ld = Record<string, unknown>;

const CONTEXT = 'https://schema.org';
export const LICENSE = 'https://spdx.org/licenses/MIT.html';

function author(): Ld {
	return { '@type': 'Person', name: AUTHOR.name, url: AUTHOR.url };
}

export function softwareApplication(origin: string): Ld {
	const home = publicPage('/')!;
	return {
		'@context': CONTEXT,
		'@type': 'SoftwareApplication',
		name: NAME,
		alternateName: 'sg-bids',
		description: home.description,
		abstract: HOME.lead,
		url: canonicalUrl(origin, '/'),
		applicationCategory: 'BusinessApplication',
		applicationSubCategory: 'VFX bidding',
		operatingSystem: 'Web',
		browserRequirements: 'A current web browser.',
		isAccessibleForFree: true,
		offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
		license: LICENSE,
		image: `${origin}${SHARE_IMAGE.path}`,
		screenshot: `${origin}${SHARE_IMAGE.path}`,
		featureList: HOME.questions.find((q) => q.id === 'what')?.list ?? [],
		author: author(),
		isBasedOn: {
			'@type': 'SoftwareSourceCode',
			name: 'sg-bids',
			codeRepository: REPO,
			programmingLanguage: ['TypeScript', 'Svelte'],
			license: LICENSE,
			author: author()
		}
	};
}

/** The text of an answer: the two sentences, then the list and the note. */
export function answerText(question: Question): string {
	return [question.a, ...(question.list ?? []), question.note ?? ''].filter(Boolean).join(' ');
}

export function faqPage(origin: string, path: string, questions: readonly Question[]): Ld {
	return {
		'@context': CONTEXT,
		'@type': 'FAQPage',
		url: canonicalUrl(origin, path),
		mainEntity: questions.map((question) => ({
			'@type': 'Question',
			name: question.q,
			acceptedAnswer: { '@type': 'Answer', text: answerText(question) }
		}))
	};
}

/** Home, then the page. */
export function breadcrumbs(origin: string, path: string): Ld {
	const trail = path === '/' ? ['/'] : ['/', path];
	return {
		'@context': CONTEXT,
		'@type': 'BreadcrumbList',
		itemListElement: trail.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: publicPage(p)!.label, item: canonicalUrl(origin, p) }))
	};
}

/** The JSON-LD blocks of a public page. */
export function pageLd(path: string, origin: string): Ld[] {
	if (path === '/') return [softwareApplication(origin)];
	if (path === '/how') return [faqPage(origin, path, HOW_QUESTIONS), breadcrumbs(origin, path)];
	return [breadcrumbs(origin, path)];
}

export function ldJson(value: Ld): string {
	return JSON.stringify(value).replace(/</g, '\\u003c');
}
