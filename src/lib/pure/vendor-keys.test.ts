import { describe, expect, it } from 'vitest';
import { vendorKeys } from './vendor-keys';

const rows = [
	{ kind: 'shot' as const, key: 'shot-918273645', id: '11111111-1111-4111-8111-111111111111' },
	{ kind: 'asset' as const, key: 'asset-564738291', id: '22222222-2222-4222-8222-222222222222' },
	{ kind: 'shot' as const, key: 'asset-564738291', id: '33333333-3333-4333-8333-333333333333' }
];

describe('vendorKeys', () => {
	const keys = vendorKeys(rows);

	it('gives each item its row id for the vendor, by kind', () => {
		expect(keys.toVendor({ kind: 'shot', id: 'shot-918273645' })).toEqual({ kind: 'shot', id: '11111111-1111-4111-8111-111111111111' });
		expect(keys.toVendor({ kind: 'asset', id: 'asset-564738291' })).toEqual({ kind: 'asset', id: '22222222-2222-4222-8222-222222222222' });
		expect(keys.toVendor({ kind: 'shot', id: 'asset-564738291' })).toEqual({ kind: 'shot', id: '33333333-3333-4333-8333-333333333333' });
	});

	it('reads a vendor id back to the stored key, of the same kind only', () => {
		expect(keys.fromVendor({ kind: 'shot', id: '11111111-1111-4111-8111-111111111111' })).toEqual({ kind: 'shot', id: 'shot-918273645' });
		expect(keys.fromVendor({ kind: 'asset', id: '11111111-1111-4111-8111-111111111111' })).toBeNull();
	});

	it('knows nothing of a key or id that is not in the request: never the stored key itself', () => {
		expect(keys.toVendor({ kind: 'shot', id: 'shot-1' })).toBeNull();
		expect(keys.fromVendor({ kind: 'shot', id: 'shot-918273645' })).toBeNull();
	});
});
