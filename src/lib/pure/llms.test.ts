import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOC_FILES, howMarkdown, homeMarkdown, llmsFull, llmsTxt } from './llms';
import { HOME, HOW } from './public-content';
import { PUBLIC_PAGES, REPO } from './seo';

const ORIGIN = 'https://bids.example.com';

describe('llmsTxt', () => {
	const text = llmsTxt(ORIGIN);
	const lines = text.split('\n');

	it('opens with the name as H1 and what it is as a blockquote', () => {
		expect(lines[0]).toBe('# SG Bids');
		expect(lines[1]).toBe('');
		expect(lines[2]).toBe(`> ${HOME.lead}`);
	});

	it('has H2 sections of links, each with a line', () => {
		const sections = lines.filter((l) => l.startsWith('## '));
		expect(sections).toEqual(['## Pages', '## Docs', '## Source', '## Optional']);
		for (const line of lines.filter((l) => l.startsWith('- '))) expect(line).toMatch(/^- \[[^\]]+\]\((https?:\/\/[^)\s]+)\): \S/);
	});

	it('links every public page on the origin, the full text, the repository and the docs', () => {
		for (const page of PUBLIC_PAGES) expect(text).toContain(`](${ORIGIN}${page.path}): ${page.description}`);
		expect(text).toContain(`](${ORIGIN}/llms-full.txt)`);
		expect(text).toContain(`](${REPO})`);
		for (const doc of DOC_FILES.filter((d) => d.path.startsWith('docs/'))) expect(text).toContain(`](${REPO}/blob/main/${doc.path})`);
	});

	it('has no dashes in its prose', () => {
		expect(text).not.toMatch(/[–—]/);
	});
});

describe('llmsFull', () => {
	it('has each page as markdown, then each doc whole', () => {
		const docs = DOC_FILES.map((d) => ({ ...d, body: `body of ${d.path}` }));
		const text = llmsFull(ORIGIN, docs);
		expect(text.startsWith('# SG Bids: the full text\n')).toBe(true);
		expect(text).toContain(homeMarkdown(ORIGIN));
		expect(text).toContain(howMarkdown(ORIGIN));
		for (const doc of docs) expect(text).toContain(`<!-- ${doc.path}: ${REPO}/blob/main/${doc.path} -->\n\nbody of ${doc.path}`);
	});

	it('writes each question as a heading with its answer under it', () => {
		const how = howMarkdown(ORIGIN);
		for (const q of [HOW.vendors, HOW.written, HOW.money]) expect(how).toContain(`## ${q.q}\n\n${q.a}\n`);
		expect(homeMarkdown(ORIGIN)).toContain(`# ${HOME.h1}\n\nPage: ${ORIGIN}/\n\n${HOME.lead}`);
	});

	it('names files that are in the repo', () => {
		for (const doc of DOC_FILES) expect(existsSync(doc.path), doc.path).toBe(true);
	});
});
