/**
 * THE STORAGE SEAM for what production builds: its bids, and its draft requests.
 *
 * The bid editor hands a bid to `bidStore.save(projectId, bid)` and reads one back with
 * `bidStore.load(id, projectId)`. The send flow hands a draft request's header and bids to
 * `drafts.save`. Both go to this app's server (`src/routes/api/production/`), which verifies the
 * Flow PT session and writes through `src/lib/server/`.
 *
 * `cushion` keeps the last bid in this tab's sessionStorage too: a bid not stored yet (no project, or
 * nothing in it yet) or a save that failed (offline) survives a reload. The server's copy wins once
 * there is one.
 */

import { api, bidsApi, type LoadedBid, type LoadedRequest } from '$lib/api';
import type { BidRequest, Id, RequestAsset, RequestHeader, RequestShot } from '$lib/pure/model';
import { isLocalId } from '$lib/pure/persist';

/** A bid as the editor hands it over: a local id until it is stored. */
export interface EditedBid {
	readonly id: Id;
	readonly name: string;
	readonly shots: readonly RequestShot[];
	readonly assets: readonly RequestAsset[];
}

export interface BidStore {
	/** Stores the bid: a new one when its id is local, else the stored one. Answers it as stored. */
	save(projectId: number, bid: EditedBid): Promise<LoadedBid>;
	load(id: string, projectId: number): Promise<LoadedBid>;
}

/** What the bid store calls. `$lib/api` in the app; a fake in the tests. */
export type BidApi = Pick<typeof bidsApi, 'save' | 'get'>;

export function serverBidStore(remote: BidApi): BidStore {
	return {
		async save(projectId, bid) {
			if (!bid.name.trim()) throw new Error('Name the bid to save it.');
			return remote.save(projectId, { id: isLocalId(bid.id) ? null : bid.id, name: bid.name.trim(), items: { shots: bid.shots, assets: bid.assets } });
		},
		load(id, projectId) {
			return remote.get(projectId, id);
		}
	};
}

/** A draft request as the send flow hands it over: its header, and its bids when they change. */
export interface EditedDraft {
	readonly id: Id | null;
	readonly code: string;
	readonly header: RequestHeader;
	readonly bids?: readonly Id[];
}

export interface DraftStore {
	save(projectId: number, draft: EditedDraft): Promise<BidRequest>;
	load(id: string, projectId: number): Promise<LoadedRequest>;
}

/** What the draft store calls. */
export type DraftApi = Pick<typeof api, 'save' | 'get'>;

export function serverDraftStore(remote: DraftApi): DraftStore {
	return {
		async save(projectId, draft) {
			const code = draft.code.trim();
			if (!code) throw new Error('Give the request a code to save it.');
			const { request } = await remote.save(projectId, { id: draft.id, code, header: draft.header, ...(draft.bids ? { bids: [...draft.bids] } : {}) });
			return request;
		},
		load(id, projectId) {
			return remote.get(projectId, id);
		}
	};
}

/** The part of `Storage` the cushion uses. */
export type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A bid kept in the tab, with the project it is in. */
export interface KeptBid extends EditedBid {
	readonly project: { readonly id: number; readonly name: string } | null;
}

export interface Cushion {
	keep(bid: KeptBid): Promise<void>;
	read(): Promise<KeptBid | null>;
	clear(): Promise<void>;
}

const KEY = 'sg-bids:bid';

/** One bid in a key-value store. Blocked or missing storage holds nothing and never throws. */
export function keyValueCushion(storage: KeyValue | null): Cushion {
	return {
		async keep(bid) {
			try {
				storage?.setItem(KEY, JSON.stringify(bid));
			} catch {
				/* Full or blocked: the bid stays in the page. */
			}
		},
		async read() {
			try {
				const raw = storage?.getItem(KEY);
				if (!raw) return null;
				const parsed = JSON.parse(raw) as KeptBid;
				return parsed && typeof parsed.id === 'string' && typeof parsed.name === 'string' && Array.isArray(parsed.shots) && Array.isArray(parsed.assets) ? parsed : null;
			} catch {
				return null;
			}
		},
		async clear() {
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
export const bidStore: BidStore = serverBidStore(bidsApi);
export const drafts: DraftStore = serverDraftStore(api);
export const cushion: Cushion = keyValueCushion(tabStorage());
