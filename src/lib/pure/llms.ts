/**
 * `/llms.txt` and `/llms-full.txt`, in the llmstxt.org format: an H1 with the name, a blockquote
 * that says what it is, then sections of links with a line each. The full file is the public
 * pages as markdown, written from `public-content.ts` as the pages are, then the key docs as they
 * are in the repo. Pure: the docs come in as text (`src/routes/llms-full.txt/+server.ts`).
 */

import { FIELD_TABLES, FIELD_TYPE, HOME, HOW, type Link, type Question } from './public-content';
import { canonicalUrl, NAME, PUBLIC_PAGES, REPO } from './seo';

export interface Doc {
	/** The path in the repo, `docs/deploy.md`. */
	readonly path: string;
	readonly title: string;
	/** What it holds, one line. */
	readonly line: string;
	readonly body: string;
	/** For a reader who builds on it, not one who uses it: llms.txt lists it under Optional. */
	readonly optional?: boolean;
}

/** The docs the full file carries, in order. The route reads each file. */
export const DOC_FILES: readonly Omit<Doc, 'body'>[] = [
	{ path: 'README.md', title: 'README', line: 'What sg-bids is, the five steps, and how to run it.' },
	{ path: 'docs/deploy.md', title: 'Deploy your own', line: 'Fork, Vercel, Supabase, migrations, environment variables, and the Flow PT site setup.' },
	{ path: 'docs/data-model.md', title: 'Data model', line: 'The bid request, the vendor bid, rebates, the award and the award scenario, field by field.' },
	{ path: 'docs/development.md', title: 'Development', line: 'Running the app, the database, the vendor link, the security headers, the tests.', optional: true }
];

const docLink = (d: Omit<Doc, 'body'>): string => `- [${d.title}](${REPO}/blob/main/${d.path}): ${d.line}`;

const link = (l: Link): string => `[${l.text}](${l.href})`;

function question(level: string, q: Question): string[] {
	return [`${level} ${q.q}`, '', q.a, '', ...(q.list?.length ? [...q.list.map((line) => `- ${line}`), ''] : []), ...(q.note ? [q.note, ''] : []), ...(q.link ? [link(q.link), ''] : [])];
}

/** Home as markdown, from the words the page renders. */
export function homeMarkdown(origin: string): string {
	return [
		`# ${HOME.h1}`,
		'',
		`Page: ${canonicalUrl(origin, '/')}`,
		'',
		HOME.lead,
		'',
		...HOME.steps.map((step, i) => `${i + 1}. ${step}`),
		'',
		...HOME.questions.flatMap((q) => question('##', q))
	].join('\n');
}

/** How it works as markdown, from the words the page renders. */
export function howMarkdown(origin: string): string {
	const out = [`# ${HOW.h1}`, '', `Page: ${canonicalUrl(origin, '/how')}`, '', HOW.lead, ''];
	out.push(`## ${HOW.steps.q}`, '', HOW.steps.a, '');
	HOW.steps.items.forEach((step, i) => {
		out.push(`${i + 1}. **${step.title}.** ${step.line} Kept in the app: ${step.app} Flow PT: ${step.fpt.text}`);
	});
	out.push('');
	for (const q of [HOW.vendors, HOW.written, HOW.stays]) out.push(...question('##', q));
	const see = HOW.see;
	out.push(`## ${see.q}`, '', see.a, '', 'They can see:', '', ...see.can.map((l) => `- ${l}`), '', 'They cannot see:', '', ...see.cannot.map((l) => `- ${l}`), '');
	out.push(`**${see.warning.title}** ${see.warning.text}`, '');
	out.push(...question('##', HOW.money));
	const admin = HOW.admin;
	out.push(`## ${admin.q}`, '', admin.a, '', admin.note, '', ...admin.list.map((l, i) => `${i + 1}. ${l}`), '');
	for (const table of FIELD_TABLES) {
		out.push(`### ${table.title}`, '', '| Field | Name | Type |', '|---|---|---|');
		for (const field of table.fields) out.push(`| ${field.display}${field.stock ? ' (stock)' : ''} | \`${field.name}\` | ${FIELD_TYPE[field.dataType]} |`);
		out.push('');
	}
	out.push(admin.fieldsNote, '', `### ${admin.reverseTitle}`, '', admin.reverseLine, '');
	out.push(...admin.reverse.map((r) => `- On ${r.on}: “${r.name}”, ${r.what}.`), '');
	return out.join('\n');
}

export function llmsTxt(origin: string): string {
	const page = (path: string) => PUBLIC_PAGES.find((p) => p.path === path)!;
	return [
		`# ${NAME}`,
		'',
		`> ${HOME.lead}`,
		'',
		'Open source, MIT. Production signs in to its Flow PT site as itself. Vendors bid through a link and need no Flow PT account. Requests and bids live in the app’s own database; only the award is written to Flow PT. The hosted copy is a demo: a studio deploys its own.',
		'',
		'## Pages',
		'',
		...PUBLIC_PAGES.map((p) => `- [${p.label}](${canonicalUrl(origin, p.path)}): ${p.description}`),
		`- [Full text](${origin}/llms-full.txt): every public page and the docs below, as one markdown file.`,
		'',
		'## Docs',
		'',
		...DOC_FILES.filter((d) => d.path.startsWith('docs/') && !d.optional).map(docLink),
		'',
		'## Source',
		'',
		`- [GitHub repository](${REPO}): the code, MIT license. ${page('/').label} and ${page('/how').label} are written from \`src/lib/pure/public-content.ts\`.`,
		`- [README](${REPO}#readme): ${DOC_FILES[0].line}`,
		'',
		'## Optional',
		'',
		...DOC_FILES.filter((d) => d.optional).map(docLink),
		''
	].join('\n');
}

export function llmsFull(origin: string, docs: readonly Doc[]): string {
	return [
		`# ${NAME}: the full text`,
		'',
		`> ${HOME.lead}`,
		'',
		`Site: ${canonicalUrl(origin, '/')}. Code: ${REPO}. Below: each public page, then the docs from the repository.`,
		'',
		homeMarkdown(origin),
		howMarkdown(origin),
		...docs.flatMap((doc) => [`<!-- ${doc.path}: ${REPO}/blob/main/${doc.path} -->`, '', doc.body.trim(), ''])
	].join('\n');
}
