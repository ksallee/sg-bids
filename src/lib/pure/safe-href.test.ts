import { describe, expect, it } from 'vitest';
import { isWebLink, safeHref } from './safe-href';

describe('safeHref', () => {
	it('answers an http or https link as the browser reads it', () => {
		expect(safeHref('https://example.com/cut')).toBe('https://example.com/cut');
		expect(safeHref('  HTTP://Example.com/a b ')).toBe('http://example.com/a%20b');
		expect(safeHref('http://intra/cut')).toBe('http://intra/cut');
	});

	it('answers nothing for any other scheme, a relative path, or what is not a string', () => {
		for (const value of [
			'javascript:alert(1)',
			'JavaScript:alert(1)',
			' javascript:alert(1)',
			'java\tscript:alert(1)',
			'\u0000javascript:alert(1)',
			'data:text/html,<script>alert(1)</script>',
			'vbscript:msgbox(1)',
			'file:///etc/passwd',
			'ftp://x.example.com',
			'mailto:a@example.com',
			'//evil.example.com',
			'/v/api/bid',
			'not a link',
			'',
			undefined,
			null,
			42
		]) {
			expect(safeHref(value), String(value)).toBeUndefined();
		}
	});
});

describe('isWebLink', () => {
	it('is the check the header form and the server share', () => {
		expect(isWebLink('https://example.com/cut')).toBe(true);
		expect(isWebLink('http://intra/cut')).toBe(true);
		expect(isWebLink('javascript:alert(1)')).toBe(false);
		expect(isWebLink('https://')).toBe(false);
		expect(isWebLink('https://exa mple.com')).toBe(false);
		expect(isWebLink('ftp://x')).toBe(false);
	});
});
