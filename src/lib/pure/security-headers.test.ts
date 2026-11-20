import { describe, expect, it } from 'vitest';
import { CSP_DIRECTIVES, cspSources, MEDIA_HOSTS, securityHeaders, withSources } from './security-headers';

describe('securityHeaders', () => {
	it('sends nosniff, a referrer policy, no framing, and HSTS over https', () => {
		expect(securityHeaders({ https: true })).toEqual({
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'same-origin',
			'X-Frame-Options': 'DENY',
			'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
		});
	});

	it('sends no HSTS over plain http (local dev): a browser ignores it there', () => {
		expect('Strict-Transport-Security' in securityHeaders({ https: false })).toBe(false);
	});
});

describe('CSP_DIRECTIVES', () => {
	it('frames nowhere, runs no plugin, posts forms home, and allows no inline script by name', () => {
		expect(CSP_DIRECTIVES['frame-ancestors']).toEqual(['none']);
		expect(CSP_DIRECTIVES['object-src']).toEqual(['none']);
		expect(CSP_DIRECTIVES['base-uri']).toEqual(['self']);
		expect(CSP_DIRECTIVES['form-action']).toEqual(['self']);
		expect(CSP_DIRECTIVES['script-src']).toEqual(['self']);
		expect(CSP_DIRECTIVES['default-src']).toEqual(['self']);
	});
});

describe('cspSources', () => {
	it('turns the site allowlist into sources: an exact host, or a suffix as a wildcard', () => {
		expect(cspSources(['studio.example.com', '*.shotgrid.autodesk.com'])).toEqual({
			'connect-src': ['https://studio.example.com', 'https://*.shotgrid.autodesk.com'],
			'img-src': ['https://studio.example.com', 'https://*.shotgrid.autodesk.com', ...MEDIA_HOSTS]
		});
	});

	it('names Flow PT media where the corpus saw it (125, 141, field type url)', () => {
		expect(MEDIA_HOSTS).toEqual(['https://*.s3-accelerate.amazonaws.com', 'https://*.s3.amazonaws.com']);
	});

	it('drops what is not a host, so nothing can be smuggled into the policy', () => {
		expect(cspSources(["x.example.com; script-src 'unsafe-inline'", 'a b', ''])).toEqual({ 'connect-src': [], 'img-src': [...MEDIA_HOSTS] });
	});
});

describe('withSources', () => {
	const csp = "default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self' 'nonce-abc'; frame-ancestors 'none'";

	it('adds sources to the directives named, and keeps the rest as SvelteKit wrote it', () => {
		expect(withSources(csp, { 'connect-src': ['https://studio.example.com'], 'img-src': ['https://*.s3.amazonaws.com'] })).toBe(
			"default-src 'self'; connect-src 'self' https://studio.example.com; img-src 'self' data: https://*.s3.amazonaws.com; script-src 'self' 'nonce-abc'; frame-ancestors 'none'"
		);
	});

	it('adds a directive that is missing', () => {
		expect(withSources("default-src 'self'", { 'connect-src': ['https://a.example.com'] })).toBe("default-src 'self'; connect-src https://a.example.com");
	});

	it('changes nothing with nothing to add', () => {
		expect(withSources(csp, { 'connect-src': [] })).toBe(csp);
	});
});
