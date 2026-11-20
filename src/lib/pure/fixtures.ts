/**
 * Builders for the pure modules' tests. A request, a bid, a line, with only what a test sets
 * written out.
 */

import type { BidLine, BidRequest, RequestAsset, RequestShot, Target, VendorBid } from './model';
import type { Money } from './money';

export function shot(id: string, extra: Partial<RequestShot> = {}): RequestShot {
	return { id, code: id.toUpperCase(), omitted: false, assetIds: [], ...extra };
}

export function asset(id: string, extra: Partial<RequestAsset> = {}): RequestAsset {
	return { id, name: id, ...extra };
}

export function request(extra: Partial<BidRequest> & { baseCurrency?: string } = {}): BidRequest {
	const { baseCurrency = 'USD', ...rest } = extra;
	return {
		id: 'req1',
		header: { project: 'Test', round: 1, baseCurrency, assumptions: [] },
		shots: [],
		assets: [],
		vendors: [],
		...rest
	};
}

export function bid(extra: Partial<VendorBid> & { currency: string }): VendorBid {
	return {
		id: 'bid1',
		requestId: 'req1',
		vendorId: 'v1',
		number: '1',
		round: 1,
		date: '2026-11-20',
		status: 'submitted',
		rate: null,
		assumptions: [],
		exclusions: [],
		milestones: [],
		lines: [],
		costs: [],
		discount: null,
		tax: null,
		rebate: [],
		...extra
	};
}

export const onShot = (id: string): Target => ({ kind: 'shot', id });
export const onAsset = (id: string): Target => ({ kind: 'asset', id });

export function line(id: string, target: Target, total: Money, extra: Partial<BidLine> = {}): BidLine {
	return { id, target, total, excluded: false, ...extra };
}
