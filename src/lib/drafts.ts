/**
 * THE STORAGE SEAM for bid request drafts.
 *
 * The request builder hands its draft to `saveDraft(request)` and reads it back with
 * `loadDraft()`. Nothing else in the app knows where a draft lives. Today the only implementation
 * keeps one draft in this tab's `sessionStorage`, so a reload does not lose work and closing the
 * tab does. When the backend lands, write a `DraftStore` that talks to it and assign it to
 * `drafts` below: the builder does not change.
 */

import type { BidRequest } from '$lib/pure/model';

export interface DraftStore {
	saveDraft(request: BidRequest): Promise<void>;
	/** The draft in progress, or null when there is none. */
	loadDraft(): Promise<BidRequest | null>;
	clearDraft(): Promise<void>;
}

/** The part of `Storage` a store uses. */
export type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY = 'sg-bids:draft';

/** One draft in a key-value store. Blocked or missing storage holds nothing and never throws. */
export function keyValueDraftStore(storage: KeyValue | null): DraftStore {
	return {
		async saveDraft(request) {
			try {
				storage?.setItem(KEY, JSON.stringify(request));
			} catch {
				/* Full or blocked: the draft stays in the page. */
			}
		},
		async loadDraft() {
			try {
				const raw = storage?.getItem(KEY);
				if (!raw) return null;
				const parsed = JSON.parse(raw) as BidRequest;
				return parsed && typeof parsed.id === 'string' && parsed.header && Array.isArray(parsed.shots) && Array.isArray(parsed.assets) ? parsed : null;
			} catch {
				return null;
			}
		},
		async clearDraft() {
			try {
				storage?.removeItem(KEY);
			} catch {
				/* Nothing to clear. */
			}
		}
	};
}

function tabStorage(): KeyValue | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		return null;
	}
}

/** Storage plugs in here. */
export const drafts: DraftStore = keyValueDraftStore(tabStorage());

export function saveDraft(request: BidRequest): Promise<void> {
	return drafts.saveDraft(request);
}
