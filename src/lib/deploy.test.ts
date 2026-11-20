/**
 * The deploy is two files, so it is read as two files.
 *
 * Vercel builds this repo from `main` alone. `git.deploymentEnabled` names the one
 * branch it will build, and `ignoreCommand` exits 0, "skip this build", for every
 * other ref, which is what stops a preview on a feature branch. The adapter has to be
 * the Vercel one: `framework: "sveltekit"` makes Vercel read the build output the
 * adapter writes, and the node adapter writes something else.
 */
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import vercel from '../../vercel.json';
import { NON_PAGE_CSP, PRERENDERED_PAGE_CSP, securityHeaders } from './pure/security-headers';
import { CRAWLER_FILES, PUBLIC_PAGES } from './pure/seo';

const config: {
	framework?: string;
	git?: { deploymentEnabled?: Record<string, boolean> };
	ignoreCommand?: string;
	outputDirectory?: string;
	headers?: { source: string; headers: { key: string; value: string }[] }[];
} = vercel;

describe('vercel.json', () => {
	it('builds as SvelteKit and leaves the output directory to the adapter', () => {
		expect(config.framework).toBe('sveltekit');
		expect(config.outputDirectory).toBeUndefined();
	});

	it('enables main and nothing else', () => {
		expect(config.git?.deploymentEnabled).toEqual({ main: true });
	});

	it('skips the build on any ref that is not main', () => {
		expect(config.ignoreCommand).toContain('VERCEL_GIT_COMMIT_REF');
		expect(config.ignoreCommand).toContain('main');
	});
});

// The prerendered files are served as static files: the hook never sees them, so vercel.json sends
// what the hook sends everywhere else.
describe('vercel.json headers on the prerendered files', () => {
	const rules = config.headers ?? [];
	const headersFor = (path: string) => {
		const rule = rules.find((r) => new RegExp(`^${r.source}$`).test(path));
		return rule ? Object.fromEntries(rule.headers.map((h) => [h.key, h.value])) : undefined;
	};

	it.each(PUBLIC_PAGES.map((page) => [page.path]))('%s: the security headers, and the policy a meta tag cannot carry', (path) => {
		expect(headersFor(path)).toEqual({ ...securityHeaders({ https: true }), 'Content-Security-Policy': PRERENDERED_PAGE_CSP });
	});

	it.each(CRAWLER_FILES.map((path) => [path]))('%s: the security headers, and a policy that loads nothing', (path) => {
		expect(headersFor(path)).toEqual({ ...securityHeaders({ https: true }), 'Content-Security-Policy': NON_PAGE_CSP });
	});

	it('touches no app or vendor path, where the hook writes the headers', () => {
		for (const path of ['/bids', '/bids/new', '/v', '/v/open', '/api/production/list', '/connect', '/live/session-poll']) expect(headersFor(path)).toBeUndefined();
	});

	it('frames nowhere and runs no plugin, and never names a script source', () => {
		expect(PRERENDERED_PAGE_CSP).toContain("frame-ancestors 'none'");
		expect(PRERENDERED_PAGE_CSP).toContain("object-src 'none'");
		expect(PRERENDERED_PAGE_CSP).not.toContain('script-src');
	});
});

describe('package.json', () => {
	const devDependencies: Record<string, string> = pkg.devDependencies;

	it('carries the Vercel adapter and no longer the node one', () => {
		expect(devDependencies['@sveltejs/adapter-vercel']).toMatch(/^\^\d/);
		expect(devDependencies['@sveltejs/adapter-node']).toBeUndefined();
	});
});
