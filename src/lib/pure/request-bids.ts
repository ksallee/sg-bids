/**
 * A request made from bids. Pure, no I/O.
 *
 * A draft request references its bids: one package per bid, keyed `bid:<id>` (a draft from before
 * bids keeps its keys), and no rows of its own. What it holds now is composed from the bids as they
 * are (`composeDraft`): each bid's rows under its package, the package named as the bid, made unique
 * in the request. The issue writes exactly that and freezes it (`sg_issue_request`). A row in two bids
 * of one request is named and refused at the issue: a request takes each row once.
 */

import type { Id, ProductionBid, RequestAsset, RequestPackage, RequestShot } from './model';

const MAX_NAME = 120;

/** The package a bid takes in a request it is added to. */
export function bidPackageId(bid: Id): Id {
	return `bid:${bid}`;
}

/** Each name, or `<name> 2`, `<name> 3`: the first no earlier one holds, in any case. As the issue names packages. */
export function freeNames(names: readonly string[], taken: readonly string[] = []): string[] {
	const used = new Set(taken.map((n) => n.toLowerCase()));
	return names.map((name) => {
		let label = name;
		for (let n = 2; used.has(label.toLowerCase()); n++) label = `${name.slice(0, MAX_NAME - String(n).length - 1).trim()} ${n}`;
		used.add(label.toLowerCase());
		return label;
	});
}

/** A row in two bids of the request. */
export interface Overlap {
	readonly kind: 'shot' | 'asset';
	readonly key: Id;
	readonly code: string;
	/** The bid it stays in, then the one it is left out of. */
	readonly bids: readonly [string, string];
}

export interface Composed {
	readonly packages: RequestPackage[];
	readonly shots: RequestShot[];
	readonly assets: RequestAsset[];
	readonly overlaps: Overlap[];
}

/**
 * A draft request as its bids make it now. `packages`: the draft's, in order, each naming its bid;
 * `bids`: those bids by id. A package whose bid is not given is left out. A row already in an earlier
 * bid is left out of the later one and named in `overlaps`.
 */
export function composeDraft(packages: readonly RequestPackage[], bids: ReadonlyMap<Id, ProductionBid>): Composed {
	const kept = packages.flatMap((p) => {
		const bid = p.bid ? bids.get(p.bid) : undefined;
		return bid ? [{ pkg: p, bid }] : [];
	});
	const names = freeNames(kept.map((k) => k.bid.name));
	const seen = new Map<string, string>();
	const overlaps: Overlap[] = [];
	const shots: RequestShot[] = [];
	const assets: RequestAsset[] = [];
	kept.forEach(({ pkg, bid }, i) => {
		const take = (kind: 'shot' | 'asset', id: Id, code: string): boolean => {
			const key = `${kind}:${id}`;
			const first = seen.get(key);
			if (first !== undefined) {
				overlaps.push({ kind, key: id, code, bids: [first, names[i]] });
				return false;
			}
			seen.set(key, names[i]);
			return true;
		};
		for (const s of bid.shots) if (take('shot', s.id, s.code)) shots.push({ ...s, package: pkg.id });
		for (const a of bid.assets) if (take('asset', a.id, a.name)) assets.push({ ...a, package: pkg.id });
	});
	return { packages: kept.map(({ pkg, bid }, i) => ({ id: pkg.id, name: names[i], bid: bid.id })), shots, assets, overlaps };
}

/** A request a bid is in, as the bid's page lists it. */
export interface RequestOfBid {
	readonly id: Id;
	readonly code: string;
	readonly round: number;
	readonly status: 'draft' | 'issued' | 'awarded' | 'closed';
	readonly title?: string | null;
	readonly createdAt: string;
}

/** The requests a bid is in, those that went out first, newest first, each with its label: the code, and the round after the first. */
export function wentOutIn(requests: readonly RequestOfBid[]): (RequestOfBid & { label: string })[] {
	return [...requests]
		.sort((a, b) => Number(a.status === 'draft') - Number(b.status === 'draft') || b.createdAt.localeCompare(a.createdAt))
		.map((r) => ({ ...r, label: r.round > 1 ? `${r.code} round ${r.round}` : r.code }));
}
