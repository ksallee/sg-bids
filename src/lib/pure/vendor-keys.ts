/**
 * The ids a vendor sees for the request's shots and assets. A stored item key is the builder's
 * (`shot-<Flow PT id>`, `freeze.ts`), and a vendor sees no Flow PT id. So a vendor gets each
 * item's row id instead, and every line it sends is read back to the stored key here. The bids,
 * scenarios and awards keep the stored keys, so production's side and the award step are as they
 * were. An issued request's items are frozen, so a row id holds for the life of the request.
 * Pure, no I/O.
 */

import type { Target } from './model';

export interface ItemKey {
	readonly kind: 'shot' | 'asset';
	/** The stored key: the model's item id. */
	readonly key: string;
	/** The item's row id: the vendor's id for it. */
	readonly id: string;
}

export interface VendorKeys {
	/** The vendor's target for a stored target. Null when the request has no such item. */
	toVendor(target: Target): Target | null;
	/** The stored target for one a vendor sent. Null when it names no item of the request. */
	fromVendor(target: Target): Target | null;
}

export function vendorKeys(items: readonly ItemKey[]): VendorKeys {
	const out = new Map(items.map((item) => [`${item.kind}:${item.key}`, item.id]));
	const back = new Map(items.map((item) => [`${item.kind}:${item.id}`, item.key]));
	return {
		toVendor(target) {
			const id = out.get(`${target.kind}:${target.id}`);
			return id === undefined ? null : ({ kind: target.kind, id } as Target);
		},
		fromVendor(target) {
			const key = back.get(`${target.kind}:${target.id}`);
			return key === undefined ? null : ({ kind: target.kind, id: key } as Target);
		}
	};
}
