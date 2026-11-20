// The public pages as markdown, from the words they render, then the key docs as they are in the
// repo. Written at build (`$lib/pure/llms`), so it cannot drift from the pages or the docs.
import { DOC_FILES, llmsFull } from '$lib/pure/llms';
import { SITE_URL } from '$lib/site-url';
import readme from '../../../README.md?raw';
import deploy from '../../../docs/deploy.md?raw';
import dataModel from '../../../docs/data-model.md?raw';
import development from '../../../docs/development.md?raw';

export const prerender = true;

const BODIES: Readonly<Record<string, string>> = {
	'README.md': readme,
	'docs/deploy.md': deploy,
	'docs/data-model.md': dataModel,
	'docs/development.md': development
};

export const GET = (): Response =>
	new Response(llmsFull(SITE_URL, DOC_FILES.map((doc) => ({ ...doc, body: BODIES[doc.path] ?? '' }))), {
		headers: { 'content-type': 'text/plain; charset=utf-8' }
	});
