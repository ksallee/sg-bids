/**
 * THE STORAGE SEAM for what production builds: a draft request, its bids with their rows, and its
 * vendors.
 *
 * The request's page hands its state to `drafts.save(projectId, draft)` and reads it back with
 * `drafts.load(id, projectId)`. Both go to this app's server (`src/routes/api/production/`), which
 * verifies the Flow PT session and writes through `src/lib/server/`, in one write per save.
 */

import { api, type LoadedRequest } from '$lib/api';
import type { HeaderForm, ProjectPick } from '$lib/pure/header';
import type { Id } from '$lib/pure/model';
import { savableHeader } from '$lib/pure/persist';
import { savableBids, type DraftBid, type DraftRows } from '$lib/pure/request-draft';
import { savedVendors, type VendorRow } from '$lib/pure/vendor-rows';

/** A draft as its page holds it. */
export interface EditedDraft {
	readonly id: Id;
	readonly project: ProjectPick;
	readonly form: HeaderForm;
	readonly bids: readonly DraftBid[];
	readonly rows: DraftRows;
	readonly vendors: readonly VendorRow[];
}

export interface DraftStore {
	/** Writes the draft's page. Throws with the reason when it cannot. */
	save(draft: EditedDraft): Promise<void>;
	load(id: string, projectId: number): Promise<LoadedRequest>;
}

/** What the draft store calls. `$lib/api` in the app; a fake in the tests. */
export type DraftApi = Pick<typeof api, 'saveDraft' | 'get'>;

export function serverDraftStore(remote: DraftApi): DraftStore {
	return {
		async save(draft) {
			const bids = savableBids(draft.bids, draft.rows);
			if (!bids.ok) throw new Error(bids.message);
			await remote.saveDraft(draft.project.id, {
				id: draft.id,
				header: savableHeader(draft.form, draft.project),
				bids: bids.bids.map((b) => ({ key: b.key, name: b.name, items: { shots: b.shots, assets: b.assets } })),
				vendors: savedVendors(draft.vendors).map((v) => ({ id: v.id, name: v.name, email: v.email, group: v.group, bids: v.bids }))
			});
		},
		load(id, projectId) {
			return remote.get(projectId, id);
		}
	};
}

/** Storage plugs in here. */
export const drafts: DraftStore = serverDraftStore(api);
