/**
 * The vendor page's calls to its endpoints (`src/routes/v/api/`). The link cookie travels with
 * each call; the page never sees the token. Every refusal comes back as `{error}` and is thrown
 * here as a `VendorError` with that message.
 */

import type { BidDraft } from '$lib/pure/rows';
import type { VendorBidView, VendorRequestView } from '$lib/pure/vendor-view';

export class VendorError extends Error {
	constructor(
		readonly status: number,
		message: string,
		/** `session`: the browser now holds another vendor's link. `bid`: another tab moved the bid on. */
		readonly reason?: string
	) {
		super(message);
	}
}

/** What every write names: the invitation and the bid the page loaded (`$lib/server/vendor-api`). */
export interface Loaded {
	readonly invitationId: string;
	readonly bidId: string | null;
}

async function call<T>(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown, keepalive = false): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, {
			method,
			credentials: 'same-origin',
			keepalive,
			headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	} catch {
		throw new VendorError(0, 'No connection. Your changes stay on this page until it comes back.');
	}
	const answer = (await res.json().catch(() => null)) as (T & { error?: string; reason?: string }) | null;
	if (!res.ok) throw new VendorError(res.status, answer?.error ?? 'Something failed. Try again.', answer?.reason);
	return answer as T;
}

export const vendorApi = {
	request: () => call<VendorRequestView>('GET', '/v/api/request'),
	bid: () => call<VendorBidView>('GET', '/v/api/bid'),
	save: (loaded: Loaded, draft: BidDraft, keepalive = false) => call<VendorBidView>('PUT', '/v/api/bid', { ...loaded, draft }, keepalive),
	submit: (loaded: Loaded) => call<VendorBidView>('POST', '/v/api/bid/submit', loaded),
	withdraw: (loaded: Loaded) => call<VendorBidView>('POST', '/v/api/bid/withdraw', loaded),
	revise: (loaded: Loaded) => call<VendorBidView>('POST', '/v/api/bid/revise', loaded)
};
