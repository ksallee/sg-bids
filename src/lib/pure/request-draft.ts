/**
 * A draft request's bids and rows, as its one page edits them. Pure, no I/O.
 *
 * A request holds one bid at least. Each bid has a key that never changes and a name, unique in the
 * request in any case, 120 characters at most; a new one is the request's name and a number, `Spring pitch 01`,
 * `Spring pitch 02` (`Bid 01` while the request has no name): the first number no bid holds. Every row sits in exactly one bid, named by its `package`: the key is the request's
 * package for that bid. Deleting a bid takes its rows with it or moves them to another bid.
 */

import { countOf, framesOf } from './count';
import type { BidRequest, Id, RequestAsset, RequestShot, Target } from './model';

export const MAX_BID_NAME = 120;

/** A bid of the request: the key its rows name, and its name. */
export interface DraftBid {
	readonly key: Id;
	readonly name: string;
}

/** The request's rows. Each names its bid in `package`. */
export interface DraftRows {
	readonly shots: readonly RequestShot[];
	readonly assets: readonly RequestAsset[];
}

/** The key of a new bid: `bid:` and a random id. */
export function bidKey(seed: string): Id {
	return `bid:${seed}`;
}

/** A bid's name by default: the request's name, or `Bid` while it has none, and the number on two digits. */
export function defaultBidName(requestName: string, n: number): string {
	const suffix = ` ${String(n).padStart(2, '0')}`;
	const base = requestName.trim() || 'Bid';
	return base.slice(0, MAX_BID_NAME - suffix.length).trimEnd() + suffix;
}

/** The default name with the first number from 1 no bid of the request holds, in any case. */
export function nextBidName(bids: readonly DraftBid[], requestName = ''): string {
	const taken = new Set(bids.map((b) => b.name.trim().toLowerCase()));
	for (let n = 1; ; n++) {
		const name = defaultBidName(requestName, n);
		if (!taken.has(name.toLowerCase())) return name;
	}
}

/** One more bid, last, named `nextBidName`. */
export function addBid(bids: readonly DraftBid[], key: Id, requestName = ''): DraftBid[] {
	return [...bids, { key, name: nextBidName(bids, requestName) }];
}

/**
 * The bids after the request is renamed: a bid still holding its default name takes the new one,
 * with its number. A bid named by hand stays, and so does one whose new name another bid holds.
 */
export function followRequestName(bids: readonly DraftBid[], was: string, now: string): DraftBid[] {
	if (was.trim() === now.trim()) return [...bids];
	const out = [...bids];
	for (let i = 0; i < out.length; i++) {
		for (let n = 1; n <= 99; n++) {
			if (out[i].name !== defaultBidName(was, n)) continue;
			const name = defaultBidName(now, n);
			if (!out.some((b, j) => j !== i && b.name.trim().toLowerCase() === name.toLowerCase())) out[i] = { ...out[i], name };
			break;
		}
	}
	return out;
}

/** Why a name does not fit a bid of the request, or null. `key`: the bid it is for. */
export function bidNameProblem(bids: readonly DraftBid[], key: Id, typed: string): string | null {
	const name = typed.trim();
	if (name === '') return 'Give the bid a name.';
	if (name.length > MAX_BID_NAME) return `A bid name is ${MAX_BID_NAME} characters at most.`;
	const other = bids.find((b) => b.key !== key && b.name.trim().toLowerCase() === name.toLowerCase());
	return other ? `Another bid is named ${other.name}. Give this one its own name.` : null;
}

export function renameBid(bids: readonly DraftBid[], key: Id, typed: string): { ok: true; bids: DraftBid[] } | { ok: false; message: string } {
	const problem = bidNameProblem(bids, key, typed);
	if (problem) return { ok: false, message: problem };
	return { ok: true, bids: bids.map((b) => (b.key === key ? { ...b, name: typed.trim() } : b)) };
}

export interface BidStats {
	/** Shots not omitted: a counted row counts as many as it stands for (`count.ts`). */
	readonly shots: number;
	/** Rows of shots not omitted. */
	readonly shotRows: number;
	/** Assets not omitted, counted rows as many as they stand for. */
	readonly assets: number;
	/** Rows of assets not omitted. */
	readonly assetRows: number;
	readonly omitted: number;
	/** Frames of the shots not omitted: per unit, times the count. */
	readonly frames: number;
	/** Every row, omitted or not. */
	readonly rows: number;
}

/** Each bid's counts, by key. */
export function bidStats(bids: readonly DraftBid[], rows: DraftRows): Map<Id, BidStats> {
	const out = new Map<Id, { shots: number; shotRows: number; assets: number; assetRows: number; omitted: number; frames: number; rows: number }>(
		bids.map((b) => [b.key, { shots: 0, shotRows: 0, assets: 0, assetRows: 0, omitted: 0, frames: 0, rows: 0 }])
	);
	for (const s of rows.shots) {
		const stats = s.package ? out.get(s.package) : undefined;
		if (!stats) continue;
		stats.rows++;
		if (s.omitted) stats.omitted++;
		else {
			stats.shots += countOf(s);
			stats.shotRows++;
			stats.frames += framesOf(s) ?? 0;
		}
	}
	for (const a of rows.assets) {
		const stats = a.package ? out.get(a.package) : undefined;
		if (!stats) continue;
		stats.rows++;
		if (a.omitted) stats.omitted++;
		else {
			stats.assets += countOf(a);
			stats.assetRows++;
		}
	}
	return out;
}

/** Rows just added: each with no bid goes to `key`. A row that has one keeps it. */
export function inBid<T extends { package?: Id }>(rows: readonly T[], key: Id): T[] {
	return rows.map((r) => (r.package ? r : { ...r, package: key }));
}

/** The rows named go to bid `to`. */
export function moveRows(rows: DraftRows, targets: readonly Target[], to: Id): DraftRows {
	const shots = new Set(targets.filter((t) => t.kind === 'shot').map((t) => t.id));
	const assets = new Set(targets.filter((t) => t.kind === 'asset').map((t) => t.id));
	return {
		shots: rows.shots.map((s) => (shots.has(s.id) ? { ...s, package: to } : s)),
		assets: rows.assets.map((a) => (assets.has(a.id) ? { ...a, package: to } : a))
	};
}

/**
 * The bid goes. `rowsTo` null: its rows go with it; else they move to that bid. The last bid of a
 * request stays: nothing changes.
 */
export function deleteBid(bids: readonly DraftBid[], rows: DraftRows, key: Id, rowsTo: Id | null): { bids: readonly DraftBid[]; rows: DraftRows } {
	if (bids.length <= 1 || !bids.some((b) => b.key === key)) return { bids, rows };
	const to = rowsTo !== null && rowsTo !== key && bids.some((b) => b.key === rowsTo) ? rowsTo : null;
	const keep = <T extends { package?: Id }>(list: readonly T[]): T[] =>
		to === null ? list.filter((r) => r.package !== key) : list.map((r) => (r.package === key ? { ...r, package: to } : r));
	return { bids: bids.filter((b) => b.key !== key), rows: { shots: keep(rows.shots), assets: keep(rows.assets) } };
}

/**
 * A stored draft as the page edits it: its packages are its bids, in order. A draft with none starts
 * with one, `Bid 01`, under `fallbackKey`. A row in no known bid goes to the first.
 */
export function draftFrom(request: Pick<BidRequest, 'shots' | 'assets' | 'packages'>, fallbackKey: Id): { bids: DraftBid[]; rows: DraftRows } {
	const bids: DraftBid[] = (request.packages ?? []).map((p) => ({ key: p.id, name: p.name }));
	if (bids.length === 0) bids.push({ key: fallbackKey, name: defaultBidName('', 1) });
	const known = new Set(bids.map((b) => b.key));
	const first = bids[0].key;
	const place = <T extends { package?: Id }>(r: T): T => (r.package && known.has(r.package) ? r : { ...r, package: first });
	return { bids, rows: { shots: request.shots.map(place), assets: request.assets.map(place) } };
}

/** A bid as a save sends it: its key, name and rows, none of them carrying what is never stored. */
export interface SavedBid {
	readonly key: Id;
	readonly name: string;
	readonly shots: readonly RequestShot[];
	readonly assets: readonly RequestAsset[];
}

function storedShot({ thumbnail, package: pkg, ...rest }: RequestShot): RequestShot {
	void thumbnail;
	void pkg;
	return rest;
}

function storedAsset({ timesUsed, package: pkg, ...rest }: RequestAsset): RequestAsset {
	void timesUsed;
	void pkg;
	return rest;
}

/** A vendor copied into a new draft: as typed on the request copied, its link made at the issue. */
export interface CopiedVendor {
	readonly id: Id;
	readonly name: string;
	readonly email: string;
	readonly group: { readonly id: number; readonly name: string } | null;
	readonly bids: readonly Id[] | null;
}

/**
 * A new draft made from a request, draft or issued: its bids by name, under new keys, with their rows
 * when `rows`, and its vendors under new ids, each invited to the same bids. A request from before
 * bids makes one bid, Bid 01.
 */
export function copyRequest(
	request: Pick<BidRequest, 'shots' | 'assets' | 'packages' | 'vendors'>,
	options: { readonly rows: boolean; readonly key: () => string; readonly id: () => Id }
): { bids: SavedBid[]; vendors: CopiedVendor[] } {
	const packages = request.packages && request.packages.length > 0 ? request.packages : [{ id: '', name: defaultBidName('', 1) }];
	const keys = new Map(packages.map((p) => [p.id, bidKey(options.key())]));
	const first = packages[0].id;
	const of = (pkg: Id | undefined) => (pkg !== undefined && keys.has(pkg) ? pkg : first);
	const bids = packages.map((p) => ({
		key: keys.get(p.id)!,
		name: p.name,
		shots: options.rows ? request.shots.filter((s) => of(s.package) === p.id).map(storedShot) : [],
		assets: options.rows ? request.assets.filter((a) => of(a.package) === p.id).map(storedAsset) : []
	}));
	const vendors = request.vendors.map((v) => {
		const mapped = v.packages?.flatMap((k) => (keys.has(k) ? [keys.get(k)!] : [])) ?? null;
		return {
			id: options.id(),
			name: v.name,
			email: v.email,
			group: v.fpt ? { id: v.fpt.id, name: v.groupName?.trim() || `Group ${v.fpt.id}` } : null,
			bids: mapped && mapped.length > 0 && mapped.length < bids.length ? mapped : null
		};
	});
	return { bids, vendors };
}

/**
 * Each bid with its rows, in order, as the save sends them. No thumbnail is stored: Flow PT's image
 * URLs are presigned and expire (081). A row in no known bid goes with the first.
 */
export function savableBids(bids: readonly DraftBid[], rows: DraftRows): { ok: true; bids: SavedBid[] } | { ok: false; message: string } {
	if (bids.length === 0) return { ok: false, message: 'A request holds one bid at least.' };
	const seen = new Map<string, string>();
	for (const b of bids) {
		const name = b.name.trim();
		if (name === '') return { ok: false, message: 'A bid has no name. Give it one.' };
		if (name.length > MAX_BID_NAME) return { ok: false, message: `A bid name is ${MAX_BID_NAME} characters at most.` };
		const first = seen.get(name.toLowerCase());
		if (first !== undefined) return { ok: false, message: `Two bids are named ${first}. Give each its own name.` };
		seen.set(name.toLowerCase(), name);
	}
	const known = new Set(bids.map((b) => b.key));
	const of = (pkg: Id | undefined) => (pkg && known.has(pkg) ? pkg : bids[0].key);
	return {
		ok: true,
		bids: bids.map((b) => ({
			key: b.key,
			name: b.name.trim(),
			shots: rows.shots.filter((s) => of(s.package) === b.key).map(storedShot),
			assets: rows.assets.filter((a) => of(a.package) === b.key).map(storedAsset)
		}))
	};
}
