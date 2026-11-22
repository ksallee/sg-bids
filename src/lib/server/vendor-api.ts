/**
 * What each vendor endpoint does, given the store and the link token. The routes under
 * `src/routes/v/api/` are thin wrappers over these. Every answer goes through `vendor-view.ts`, so
 * no answer carries another vendor, a vendors list, or an id that is not the vendor's own.
 *
 * Every write names the invitation and the bid the page loaded (`{invitationId, bidId}`). The
 * cookie decides whose bid a call reaches; the names make sure it is the one on screen. When the
 * browser's cookie now holds another vendor's link, or another tab moved the bid on, the write is
 * refused with 409 and nothing is written.
 */

import type { VendorBid } from '$lib/pure/model';
import type { BidDraft } from '$lib/pure/rows';
import { readDraft } from '$lib/pure/draft-input';
import { vendorKeys, type VendorKeys } from '$lib/pure/vendor-keys';
import { vendorBidView, vendorRequestView, type VendorBidRecord, type VendorBidView, type VendorRequestView } from '$lib/pure/vendor-view';
import { StoreError } from './errors';
import type { Store } from './store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OTHER_SESSION = 'Another bid is open in this browser now. Reload the page to see whose.';
export const MOVED_ON = 'Your bid changed in another tab or window. Reload the page.';

export async function loadRequest(store: Store, token: unknown): Promise<VendorRequestView> {
	const view = await store.openInvitation(token);
	return vendorRequestView({ ...view, keys: vendorKeys(view.itemKeys) });
}

export async function loadBid(store: Store, token: unknown): Promise<VendorBidView> {
	const { records, itemKeys } = await store.vendorState(token);
	return vendorBidView(records, vendorKeys(itemKeys));
}

/** The draft with each line on its stored key. A line naming no item of the request is refused. */
function stored(draft: BidDraft, keys: VendorKeys): BidDraft {
	return {
		...draft,
		lines: draft.lines.map((line) => {
			const target = keys.fromVendor(line.target);
			if (!target) throw new StoreError(422, 'A line names a shot or asset that is not in the request. Reload the page.');
			return { ...line, target };
		})
	};
}

/** The invitation and bid a write names. `bidId` null: the page had no bid yet. */
interface Binding {
	readonly invitationId: string;
	readonly bidId: string | null;
}

function binding(body: unknown, bidRequired: boolean): Binding {
	const o = (typeof body === 'object' && body !== null ? body : {}) as { invitationId?: unknown; bidId?: unknown };
	if (typeof o.invitationId !== 'string' || !UUID.test(o.invitationId)) throw new StoreError(400, 'Reload the page.');
	if (o.bidId === null && !bidRequired) return { invitationId: o.invitationId, bidId: null };
	if (typeof o.bidId !== 'string' || !UUID.test(o.bidId)) throw new StoreError(400, 'Name the bid.');
	return { invitationId: o.invitationId, bidId: o.bidId };
}

/**
 * The cookie's records, once the write's names match them: the same invitation, and as its latest
 * bid the one the page shows (`draftOnly`: and that one is an open draft, or there is none yet).
 */
async function checked(store: Store, token: unknown, want: Binding, draftOnly: boolean): Promise<{ records: VendorBidRecord[]; keys: VendorKeys }> {
	const { invitationId, records, itemKeys } = await store.vendorState(token);
	if (invitationId !== want.invitationId) throw new StoreError(409, OTHER_SESSION, { reason: 'session' });
	const latest = records.at(-1);
	const fits = want.bidId === null ? latest === undefined : latest?.bid.id === want.bidId && (!draftOnly || latest.bid.status === 'draft');
	if (!fits) throw new StoreError(409, MOVED_ON, { reason: 'bid' });
	return { records, keys: vendorKeys(itemKeys) };
}

export async function saveDraft(store: Store, token: unknown, body: unknown): Promise<VendorBidView> {
	const want = binding(body, false);
	const input = readDraft((body as { draft?: unknown } | null)?.draft);
	if (!input.ok) throw new StoreError(400, input.message);
	const { keys } = await checked(store, token, want, true);
	await store.saveDraftBid(token, stored(input.draft, keys));
	return loadBid(store, token);
}

/** The bid a submit or withdraw names, checked against the cookie's invitation. */
async function named(store: Store, token: unknown, body: unknown): Promise<string> {
	const want = binding(body, true);
	const { invitationId } = await store.vendorState(token);
	if (invitationId !== want.invitationId) throw new StoreError(409, OTHER_SESSION, { reason: 'session' });
	return want.bidId!;
}

export async function submit(store: Store, token: unknown, body: unknown): Promise<VendorBidView> {
	await store.submitBid(token, await named(store, token, body));
	return loadBid(store, token);
}

export async function withdraw(store: Store, token: unknown, body: unknown): Promise<VendorBidView> {
	await store.withdrawBid(token, await named(store, token, body));
	return loadBid(store, token);
}

/**
 * Discards the open draft the page shows: a first draft, and the vendor starts from empty; a
 * revision, and the last submitted or withdrawn version is the latest again. A submitted bid is
 * never discarded: withdraw it.
 */
export async function discard(store: Store, token: unknown, body: unknown): Promise<VendorBidView> {
	const want = binding(body, true);
	await checked(store, token, want, true);
	await store.discardDraftBid(token, want.bidId!);
	return loadBid(store, token);
}

/** The bid as a draft to start the next version from. */
export function asDraft(bid: VendorBid): BidDraft {
	const { id, requestId, vendorId, round, status, lines, ...rest } = bid;
	return { ...rest, rate: null, lines: lines.map(({ id: lineId, ...line }) => line) };
}

/** Opens the next version as a draft, a copy of the latest submitted or withdrawn one, dated today. */
export async function revise(store: Store, token: unknown, body: unknown, today: string): Promise<VendorBidView> {
	const { records } = await checked(store, token, binding(body, true), false);
	const latest = records.at(-1)!;
	if (latest.bid.status === 'draft') throw new StoreError(409, 'You already have a draft open.');
	await store.saveDraftBid(token, { ...asDraft(latest.bid), date: today });
	return loadBid(store, token);
}
