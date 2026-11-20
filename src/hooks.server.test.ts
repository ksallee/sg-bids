/**
 * The hook puts the security headers on every answer, adds the Flow PT site to the policy
 * SvelteKit wrote for a page, and keeps the vendor routes' own headers.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/env', () => ({ browserSiteHosts: () => ['studio.example.com'], serverStore: () => null }));
vi.mock('$app/environment', () => ({ dev: false }));

const { handle } = await import('./hooks.server');

async function answer(url: string, response: Response): Promise<Response> {
	const event = { url: new URL(url) } as RequestEvent;
	return handle({ event, resolve: async () => response });
}

const page = () =>
	new Response('<html></html>', {
		headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; script-src 'self' 'nonce-x'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'" }
	});

describe('handle', () => {
	it('puts the security headers on a page and adds the site to its policy', async () => {
		const res = await answer('https://bids.example.com/bids', page());
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('referrer-policy')).toBe('same-origin');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
		const csp = res.headers.get('content-security-policy')!;
		expect(csp).toContain("connect-src 'self' https://studio.example.com");
		expect(csp).toContain("img-src 'self' data: https://studio.example.com https://*.s3-accelerate.amazonaws.com https://*.s3.amazonaws.com");
		expect(csp).toContain("script-src 'self' 'nonce-x'");
		expect(csp).toContain("frame-ancestors 'none'");
	});

	it('gives an answer that is not a page a policy that loads nothing and frames nowhere', async () => {
		const res = await answer('https://bids.example.com/api/production/list', Response.json({ ok: true }));
		expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'");
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('keeps no-referrer, no-store and noindex on the vendor routes', async () => {
		const res = await answer('https://bids.example.com/v', page());
		expect(res.headers.get('referrer-policy')).toBe('no-referrer');
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
		expect(res.headers.get('content-security-policy')).toContain('https://studio.example.com');
	});

	it('lets the link question page send its own origin, so its post passes the origin checks', async () => {
		// Under no-referrer a browser sends `Origin: null` on a form post, which SvelteKit refuses.
		// The page's address holds no token: the token is in a cookie by then.
		const res = await answer('https://bids.example.com/v/open', page());
		expect(res.headers.get('referrer-policy')).toBe('same-origin');
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	it('sends no HSTS over plain http', async () => {
		const res = await answer('http://localhost:5181/', page());
		expect(res.headers.get('strict-transport-security')).toBeNull();
	});
});
