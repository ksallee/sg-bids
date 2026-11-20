import { describe, expect, it } from 'vitest';
import { isVendorPath } from './vendor-path';

describe('isVendorPath', () => {
	it('is /v and everything under it', () => {
		expect(isVendorPath('/v')).toBe(true);
		expect(isVendorPath('/v/')).toBe(true);
		expect(isVendorPath('/v/api/bid')).toBe(true);
		expect(isVendorPath('/v/abc')).toBe(true);
	});

	it('is nothing else', () => {
		expect(isVendorPath('/')).toBe(false);
		expect(isVendorPath('/vendors')).toBe(false);
		expect(isVendorPath('/bids')).toBe(false);
	});
});
