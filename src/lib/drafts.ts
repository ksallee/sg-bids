/**
 * THE STORAGE SEAM for bid request drafts.
 *
 * The builder hands its draft to `drafts.saveDraft(request)` and reads one back with
 * `drafts.loadDraft(id, projectId)`. Both go to this app's server (`src/routes/api/production/`),
 * which verifies the Flow PT session and writes through `src/lib/server/store.ts`.
 *
 * `cushion` keeps the last draft in this tab's sessionStorage too: a draft not yet stored (no code
 * yet) or a save that failed (offline) survives a reload. The server's copy wins once there is one.
 */

import { api, type LoadedRequest } from '$lib/api';
import type { BidRequest } from '$lib/pure/model';
import { isLocalId } from '$lib/pure/persist';

export interface DraftStore {
	/** Stores the draft: a new one when its id is local, else the stored one. Answers it as stored. */
	saveDraft(request: BidRequest): Promise<BidRequest>;
	loadDraft(id: string, projectId: number): Promise<LoadedRequest>;
}

/** What the server store calls. `$lib/api` in the app; a fake in the tests. */
export type DraftApi = Pick<typeof api, 'save' | 'get'>;

export function serverDraftStore(remote: DraftApi): DraftStore {
	return {
		async saveDraft(request) {
			const projectId = request.header.projectRef?.id;
			const code = request.header.code?.trim();
			if (!projectId) throw new Error('Pick a project to save the draft.');
			if (!code) throw new Error('Give the request a code to save it.');
			const { request: stored } = await remote.save(projectId, {
				id: isLocalId(request.id) ? null : request.id,
				code,
				header: request.header,
				items: { shots: request.shots, assets: request.assets }
			});
			return stored;
		},
		loadDraft(id, projectId) {
			return remote.get(projectId, id);
		}
	};
}

/** The part of `Storage` the cushion uses. */
export type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface Cushion {
	keep(request: BidRequest): Promise<void>;
	read(): Promise<BidRequest | null>;
	clear(): Promise<void>;
}

const KEY = 'sg-bids:draft';

/** One draft in a key-value store. Blocked or missing storage holds nothing and never throws. */
export function keyValueCushion(storage: KeyValue | null): Cushion {
	return {
		async keep(request) {
			try {
				storage?.setItem(KEY, JSON.stringify(request));
			} catch {
				/* Full or blocked: the draft stays in the page. */
			}
		},
		async read() {
			try {
				const raw = storage?.getItem(KEY);
				if (!raw) return null;
				const parsed = JSON.parse(raw) as BidRequest;
				return parsed && typeof parsed.id === 'string' && parsed.header && Array.isArray(parsed.shots) && Array.isArray(parsed.assets) ? parsed : null;
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
export const drafts: DraftStore = serverDraftStore(api);
export const cushion: Cushion = keyValueCushion(tabStorage());
