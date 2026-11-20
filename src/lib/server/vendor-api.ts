/**
 * What each vendor endpoint does, given the store and the link token. The routes under
 * `src/routes/v/api/` are thin wrappers over these. Every answer goes through `vendor-view.ts`, so
 * no answer carries another vendor, a vendors list, or an id that is not the vendor's own.
 */

import type { VendorBid } from '$lib/pure/model';
import type { BidDraft } from '$lib/pure/rows';
import { readDraft } from '$lib/pure/draft-input';
import { vendorBidView, vendorRequestView, type VendorBidView, type VendorRequestView } from '$lib/pure/vendor-view';
import { StoreError } from './errors';
import type { Store } from './store';

export async function loadRequest(store: Store, token: unknown): Promise<VendorRequestView> {
	const view = await store.openInvitation(token);
	return vendorRequestView(view);
}

export async function loadBid(store: Store, token: unknown): Promise<VendorBidView> {
	return vendorBidView(await store.vendorBidRecords(token));
}

export async function saveDraft(store: Store, token: unknown, body: unknown): Promise<VendorBidView> {
	const input = readDraft((body as { draft?: unknown } | null)?.draft);
	if (!input.ok) throw new StoreError(400, input.message);
	await store.saveDraftBid(token, input.draft);
	return loadBid(store, token);
}

function bidId(body: unknown): string {
	const id = (body as { bidId?: unknown } | null)?.bidId;
	if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new StoreError(400, 'Name the bid.');
	return id;
}

export async function submit(store: Store, token: unknown, body: unknown): Promise<VendorBidView> {
	await store.submitBid(token, bidId(body));
	return loadBid(store, token);
}

export async function withdraw(store: Store, token: unknown, body: unknown): Promise<VendorBidView> {
	await store.withdrawBid(token, bidId(body));
	return loadBid(store, token);
}

/** The bid as a draft to start the next version from. */
export function asDraft(bid: VendorBid): BidDraft {
	const { id, requestId, vendorId, round, status, lines, ...rest } = bid;
	return { ...rest, rate: null, lines: lines.map(({ id: lineId, ...line }) => line) };
}

/** Opens the next version as a draft, a copy of the latest submitted or withdrawn one, dated today. */
export async function revise(store: Store, token: unknown, today: string): Promise<VendorBidView> {
	const records = await store.vendorBidRecords(token);
	const latest = records.at(-1);
	if (!latest) throw new StoreError(409, 'There is no bid to revise yet.');
	if (latest.bid.status === 'draft') throw new StoreError(409, 'You already have a draft open.');
	await store.saveDraftBid(token, { ...asDraft(latest.bid), date: today });
	return loadBid(store, token);
}
