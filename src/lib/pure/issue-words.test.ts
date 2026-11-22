import { describe, expect, it } from 'vitest';
import { allLinks, copyName, issueLine, mailtoHref } from './issue-words';

describe('the email a vendor is sent', () => {
	it('is a mailto with the subject and the link in the body: the app sends nothing', () => {
		const href = mailtoHref({ email: 'bids@a.com', vendor: 'Studio A', request: 'Rooftop & rain', project: 'Demo Show', due: '15 Dec 2026', link: 'https://bids.test/v/abc' });
		expect(href.startsWith('mailto:bids%40a.com?subject=')).toBe(true);
		const url = new URL(href);
		expect(url.searchParams.get('subject')).toBe('Bid request: Rooftop & rain');
		expect(url.searchParams.get('body')).toBe(
			[
				'Hello Studio A,',
				'',
				'Demo Show asks you to bid on Rooftop & rain. Answers are due 15 Dec 2026.',
				'',
				'Your link: https://bids.test/v/abc',
				'',
				'It opens your answer form. You need no account. The link is for Studio A alone: keep it private.'
			].join('\r\n')
		);
	});

	it('leaves out the due day when there is none', () => {
		const url = new URL(mailtoHref({ email: 'b@b.com', vendor: 'B', request: 'R', project: 'P', due: null, link: 'https://x/v/1' }));
		expect(url.searchParams.get('body')).toContain('P asks you to bid on R.\r\n');
	});
});

describe('copy all', () => {
	it('puts one vendor per line, its name then its link', () => {
		expect(
			allLinks([
				{ name: 'Studio A', link: 'https://x/v/1' },
				{ name: 'Studio B', link: 'https://x/v/2' }
			])
		).toBe('Studio A: https://x/v/1\nStudio B: https://x/v/2');
	});
});

describe('the words around the issue', () => {
	it('says what goes out to whom', () => {
		expect(issueLine(2, 3)).toBe('2 bids go out to 3 vendors. Each vendor gets one link.');
		expect(issueLine(1, 1)).toBe('1 bid goes out to 1 vendor. The vendor gets one link.');
	});

	it('names a copy after the request, cut to fit', () => {
		expect(copyName('Rooftop')).toBe('Rooftop copy');
		expect(copyName(' Rooftop ')).toBe('Rooftop copy');
		expect(copyName('x'.repeat(200))).toBe(`${'x'.repeat(195)} copy`);
	});
});
