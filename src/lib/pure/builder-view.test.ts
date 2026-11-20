import { describe, expect, it } from 'vitest';
import { builderHref, parseView } from './builder-view';

const params = (query: string) => new URLSearchParams(query);

describe('parseView', () => {
	it('opens the working page by default', () => {
		expect(parseView(params(''), false)).toBe('edit');
		expect(parseView(params('id=r1'), false)).toBe('edit');
	});

	it('opens the review when the URL asks, an old step=review link included', () => {
		expect(parseView(params('id=r1&view=review'), false)).toBe('review');
		expect(parseView(params('id=r1&step=review'), false)).toBe('review');
		expect(parseView(params('id=r1&step=details'), false)).toBe('edit');
	});

	it('opens an issued request on its review, whatever the URL says', () => {
		expect(parseView(params('id=r1'), true)).toBe('review');
	});
});

describe('builderHref', () => {
	it('keeps the stored id and the view, and leaves out a local id', () => {
		expect(builderHref('r1', 'edit')).toBe('/bids/new?id=r1');
		expect(builderHref('r1', 'review')).toBe('/bids/new?id=r1&view=review');
		expect(builderHref('local-abc', 'review')).toBe('/bids/new?view=review');
		expect(builderHref('local-abc', 'edit')).toBe('/bids/new');
	});
});
