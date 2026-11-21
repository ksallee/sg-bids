/**
 * What a vendor's link answers, and nothing more. The vendor bids on the request as production
 * froze it and sees its own bids. It never sees another vendor: no name, no id, no count. So the
 * request goes out with no vendors list, and neither request nor bid carries an id that is not
 * the vendor's own business: no request id, no Flow PT entity, no stored item key (it holds the
 * Flow PT id): items go out by their row id (`vendor-keys.ts`). Its own invitation id and name go
 * out: the form shows the name, so a browser switched to another vendor's link shows it, and every
 * write sends the id back to be checked against the cookie.
 *
 * A vendor invited to some packages gets the rows and packages of those alone: the store reads no
 * other (`access.ts`), and nothing here adds one. Each row goes out with its package, and the
 * packages with their names. A request from before packages goes out as one package.
 *
 * The form's grouping and search over the request live here too.
 */

import type { BidRequest, BidStatus, Id, InvitedVendor, RequestAsset, RequestHeader, RequestPackage, RequestShot, Target, VendorBid } from './model';
import { targetKey } from './model';
import { resolvePackages } from './packages';
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
	/** The packages the vendor is invited to, in the request's order. Each row names one. */
	readonly packages: readonly RequestPackage[];
	readonly shots: readonly (Omit<RequestShot, 'fpt' | 'source' | 'package'> & { readonly package: Id })[];
	readonly assets: readonly (Omit<RequestAsset, 'fpt' | 'source' | 'package'> & { readonly package: Id })[];
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
	const resolved = resolvePackages(input.request);
	const packageOf = (target: Target) => resolved.of.get(targetKey(target))!;
	return {
		invitationId: input.invitation.id,
		vendorName: input.invitation.name,
		code: input.code,
		status: input.status,
		issuedAt: input.issuedAt,
		expiresAt: input.expiresAt,
		header,
		// A bid's id and name: the production bid it came from is production's.
		packages: resolved.packages.filter((p) => (resolved.rows.get(p.id) ?? []).length > 0).map((p) => ({ id: p.id, name: p.name })),
		// Where a row came from is production's: a vendor sees no difference.
		shots: input.request.shots.flatMap(({ fpt, source, package: _, ...rest }) => {
			const own = id('shot', rest.id);
			if (own === null) return [];
			return [{ ...rest, id: own, assetIds: rest.assetIds.map((a) => id('asset', a)).filter((a): a is string => a !== null), package: packageOf({ kind: 'shot', id: rest.id }) }];
		}),
		assets: input.request.assets.flatMap(({ fpt, source, package: _, ...rest }) => {
			const own = id('asset', rest.id);
			return own === null ? [] : [{ ...rest, id: own, package: packageOf({ kind: 'asset', id: rest.id }) }];
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

/** The form's sections by package: each package's name and its row keys, shots then assets, `shot:<id>`. */
export function packageSections(request: Pick<VendorRequestView, 'packages' | 'shots' | 'assets'>): { id: Id; label: string; keys: string[] }[] {
	return request.packages.map((p) => ({
		id: p.id,
		label: p.name,
		keys: [
			...request.shots.filter((s) => s.package === p.id).map((s) => targetKey({ kind: 'shot', id: s.id })),
			...request.assets.filter((a) => a.package === p.id).map((a) => targetKey({ kind: 'asset', id: a.id }))
		]
	}));
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

/**
 * What the vendor's "The request" box lists, label and value, each one set: the bids it answers
 * with their rows, then who and when. The request's name is the page's title. It always has the bids, so the box is never empty.
 * `day` writes a `YYYY-MM-DD` day for the reader.
 */
export function requestFacts(request: Pick<VendorRequestView, 'header' | 'packages' | 'shots' | 'assets'>, day: (text: string) => string): [string, string][] {
	const h = request.header;
	const rows = (id: Id) => request.shots.filter((s) => s.package === id && !s.omitted).length + request.assets.filter((a) => a.package === id && !a.omitted).length;
	const bids = request.packages.map((p) => `${p.name} (${rows(p.id)} ${rows(p.id) === 1 ? 'row' : 'rows'})`).join(', ');
	const facts: [string, string | undefined][] = [
		[request.packages.length === 1 ? 'Bid' : 'Bids', bids || undefined],
		['Studio', h.studio],
		['Director', h.director],
		['Client supervisor', h.clientSupervisor],
		['Client producer', h.clientProducer],
		['Cut', h.cutVersion],
		['Turnover', h.turnoverDate ? day(h.turnoverDate) : h.turnoverWeek],
		['Delivery', h.deliveryDate ? day(h.deliveryDate) : undefined],
		['Format', h.deliveryFormat]
	];
	return facts.filter((f): f is [string, string] => typeof f[1] === 'string' && f[1].trim() !== '');
}
