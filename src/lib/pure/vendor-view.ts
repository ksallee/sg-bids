/**
 * What a vendor's link answers, and nothing more. The vendor bids on the request as production
 * froze it and sees its own bids. It never sees another vendor: no name, no id, no count. So the
 * request goes out with no vendors list, and neither request nor bid carries an id that is not
 * the vendor's own business: no request id, no Flow PT entity, no stored item key (it holds the
 * Flow PT id): items go out by their row id (`vendor-keys.ts`). Its own invitation id and name go
 * out: the form shows the name, so a browser switched to another vendor's link shows it, and every
 * write sends the id back to be checked against the cookie.
 *
 * The form's grouping and search over the request live here too.
 */

import type { BidRequest, BidStatus, InvitedVendor, RequestAsset, RequestHeader, RequestShot, Target, VendorBid } from './model';
import type { VendorKeys } from './vendor-keys';

export interface VendorRequestView {
	/** The vendor's own invitation. The page sends it back with every write (`vendor-api.ts`). */
	readonly invitationId: string;
	/** The vendor's name as production invited it. The form shows it at all times. */
	readonly vendorName: string;
	readonly code: string;
	readonly status: 'issued' | 'closed';
	readonly issuedAt: string | null;
	/** When the link stops working. */
	readonly expiresAt: string;
	readonly header: Omit<RequestHeader, 'projectRef'>;
	readonly shots: readonly Omit<RequestShot, 'fpt' | 'source'>[];
	readonly assets: readonly Omit<RequestAsset, 'fpt' | 'source'>[];
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
	invitation: Pick<InvitedVendor, 'id' | 'name'>;
	request: BidRequest;
	code: string;
	status: 'issued' | 'closed';
	issuedAt: string | null;
	expiresAt: string;
	/** The vendor's ids for the items (`vendor-keys.ts`): no stored key, so no Flow PT id, goes out. */
	keys: VendorKeys;
}): VendorRequestView {
	const { projectRef, ...header } = input.request.header;
	const id = (kind: 'shot' | 'asset', key: string) => input.keys.toVendor({ kind, id: key } as Target)?.id ?? null;
	return {
		invitationId: input.invitation.id,
		vendorName: input.invitation.name,
		code: input.code,
		status: input.status,
		issuedAt: input.issuedAt,
		expiresAt: input.expiresAt,
		header,
		// Where a row came from is production's: a vendor sees no difference.
		shots: input.request.shots.flatMap(({ fpt, source, ...rest }) => {
			const own = id('shot', rest.id);
			if (own === null) return [];
			return [{ ...rest, id: own, assetIds: rest.assetIds.map((a) => id('asset', a)).filter((a): a is string => a !== null) }];
		}),
		assets: input.request.assets.flatMap(({ fpt, source, ...rest }) => {
			const own = id('asset', rest.id);
			return own === null ? [] : [{ ...rest, id: own }];
		})
	};
}

export function vendorBidView(records: readonly VendorBidRecord[], keys: VendorKeys): VendorBidView {
	const sorted = [...records].sort((a, b) => a.version - b.version);
	const latest = sorted.at(-1);
	let bid: OwnBid | null = null;
	if (latest) {
		const { vendorId, requestId, ...own } = latest.bid;
		const lines = own.lines.flatMap((line) => {
			const target = keys.toVendor(line.target);
			return target === null ? [] : [{ ...line, target }];
		});
		bid = { ...own, lines, version: latest.version, submittedAt: latest.submittedAt, withdrawnAt: latest.withdrawnAt };
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
