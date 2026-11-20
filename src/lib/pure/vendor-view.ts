/**
 * What a vendor's link answers, and nothing more. The vendor bids on the request as production
 * froze it and sees its own bids. It never sees another vendor: no name, no id, no count. So the
 * request goes out with no vendors list, and neither request nor bid carries an id that is not
 * the vendor's own business: no request id, no invitation id, no Flow PT entity.
 *
 * The form's grouping and search over the request live here too.
 */

import type { BidRequest, BidStatus, RequestAsset, RequestHeader, RequestShot, VendorBid } from './model';

export interface VendorRequestView {
	readonly code: string;
	readonly status: 'issued' | 'closed';
	readonly issuedAt: string | null;
	/** When the link stops working. */
	readonly expiresAt: string;
	readonly header: Omit<RequestHeader, 'projectRef'>;
	readonly shots: readonly Omit<RequestShot, 'fpt'>[];
	readonly assets: readonly Omit<RequestAsset, 'fpt'>[];
}

export interface VendorBidRecord {
	readonly bid: VendorBid;
	readonly version: number;
	readonly submittedAt: string | null;
	readonly withdrawnAt: string | null;
}

export type OwnBid = Omit<VendorBid, 'vendorId' | 'requestId'> & {
	readonly version: number;
	readonly submittedAt: string | null;
	readonly withdrawnAt: string | null;
};

export interface VersionSummary {
	readonly id: string;
	readonly version: number;
	readonly status: BidStatus;
	readonly submittedAt: string | null;
	readonly withdrawnAt: string | null;
}

export interface VendorBidView {
	/** The latest version: the draft when there is one. Null before the first save. */
	readonly bid: OwnBid | null;
	readonly versions: readonly VersionSummary[];
}

export function vendorRequestView(input: {
	request: BidRequest;
	code: string;
	status: 'issued' | 'closed';
	issuedAt: string | null;
	expiresAt: string;
}): VendorRequestView {
	const { projectRef, ...header } = input.request.header;
	return {
		code: input.code,
		status: input.status,
		issuedAt: input.issuedAt,
		expiresAt: input.expiresAt,
		header,
		shots: input.request.shots.map(({ fpt, ...rest }) => rest),
		assets: input.request.assets.map(({ fpt, ...rest }) => rest)
	};
}

export function vendorBidView(records: readonly VendorBidRecord[]): VendorBidView {
	const sorted = [...records].sort((a, b) => a.version - b.version);
	const latest = sorted.at(-1);
	let bid: OwnBid | null = null;
	if (latest) {
		const { vendorId, requestId, ...own } = latest.bid;
		bid = { ...own, version: latest.version, submittedAt: latest.submittedAt, withdrawnAt: latest.withdrawnAt };
	}
	return {
		bid,
		versions: sorted.map((r) => ({ id: r.bid.id, version: r.version, status: r.bid.status, submittedAt: r.submittedAt, withdrawnAt: r.withdrawnAt }))
	};
}

export type Grouping = 'episode' | 'sequence';

/** The groupings the shots carry: episode, then sequence. */
export function groupings(shots: readonly Pick<RequestShot, 'episode' | 'sequence'>[]): Grouping[] {
	return (['episode', 'sequence'] as const).filter((field) => shots.some((s) => (s[field] ?? '').trim() !== ''));
}

/** Shot ids by group, in the order each group first appears; the shots without one last. */
export function groupItems(
	shots: readonly Pick<RequestShot, 'id' | 'episode' | 'sequence'>[],
	by: Grouping | null
): { label: string | null; ids: string[] }[] {
	if (by === null) return [{ label: null, ids: shots.map((s) => s.id) }];
	const groups = new Map<string, string[]>();
	const none: string[] = [];
	for (const s of shots) {
		const label = (s[by] ?? '').trim();
		if (!label) none.push(s.id);
		else groups.set(label, [...(groups.get(label) ?? []), s.id]);
	}
	const out = [...groups].map(([label, ids]) => ({ label, ids }));
	if (none.length > 0) out.push({ label: by === 'episode' ? 'No episode' : 'No sequence', ids: none });
	return out;
}

/** Whether every word of the query is in the item's code, name, description, place or type. */
export function itemMatches(item: Partial<RequestShot> | Partial<RequestAsset>, query: string): boolean {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const fields = item as Record<string, unknown>;
	const hay = ['code', 'name', 'description', 'sequence', 'episode', 'scene', 'type', 'difficulty']
		.map((k) => fields[k])
		.filter((v): v is string => typeof v === 'string')
		.join(' ')
		.toLowerCase();
	return words.every((word) => hay.includes(word));
}
