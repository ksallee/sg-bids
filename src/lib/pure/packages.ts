/**
 * Packages: named groups of a request's rows. Every row sits in exactly one. A vendor is invited to
 * every package or to some, and prices each package row by row or as one figure. Pure, no I/O.
 *
 * - Defaults come from sequences: a shot goes to its sequence's package (`seq:<sequence>`), a shot
 *   with none to Other shots (`shots`), an asset to Assets (`assets`). Production renames, adds,
 *   deletes and moves rows between packages.
 * - Deleting a package sends each of its rows back to its sequence's package when there is one,
 *   else to the catch-all of its kind (Other shots, Assets), made when missing. A row with neither
 *   left keeps the package from going.
 * - A request stored before packages has none: it reads as one package, All shots and assets.
 * - A package priced as one figure covers its rows not omitted. Each of them carries a line marked
 *   `inPackage` with a zero total, so an award, a scenario and a Flow PT Bid Line still name the row.
 *   What such a line is worth is its part of the figure, pro rata by frames when every row has a
 *   frame count, else equal parts, with the remainder on the last row: the parts sum to the figure
 *   exactly, in minor units. The base currency figure is converted once, then shared the same way.
 * - A vendor may decline a package it was invited to: it bids on none of its rows and gives no
 *   figure for it (`VendorBid.declined`). It bids on one package at least.
 */

import type { BidLine, BidRequest, Id, PackagePrice, RequestAsset, RequestPackage, RequestShot, Target, VendorBid } from './model';
import { targetKey } from './model';
import { money, type Money } from './money';
import { toBase } from './totals';

/** The one package of a request from before packages. */
export const ALL_PACKAGE: RequestPackage = { id: 'all', name: 'All shots and assets' };
/** Where a shot with no sequence goes, and a shot whose package goes. */
export const OTHER_SHOTS: RequestPackage = { id: 'shots', name: 'Other shots' };
/** Where an asset goes, and an asset whose package goes. */
export const ASSETS: RequestPackage = { id: 'assets', name: 'Assets' };

export const MAX_PACKAGE_NAME = 120;
const MAX_KEY = 200;

export function sequencePackageId(sequence: string): Id {
	return `seq:${sequence.trim()}`.slice(0, MAX_KEY);
}

type Kind = Target['kind'];

/** The package a row goes to by default. */
export function defaultPackage(kind: Kind, sequence?: string): RequestPackage {
	if (kind === 'asset') return ASSETS;
	const name = sequence?.trim();
	return name ? { id: sequencePackageId(name), name } : OTHER_SHOTS;
}

/** The rows and packages the builder holds. */
export interface PackageRows<S extends RequestShot = RequestShot, A extends RequestAsset = RequestAsset> {
	readonly shots: readonly S[];
	readonly assets: readonly A[];
	readonly packages: readonly RequestPackage[];
}

const fold = (name: string) => name.trim().toLowerCase();

/** The name, or `name 2`, `name 3`: the first no package holds, in any case. */
function freeName(name: string, packages: readonly RequestPackage[]): string {
	const taken = new Set(packages.map((p) => fold(p.name)));
	if (!taken.has(fold(name))) return name;
	for (let n = 2; ; n++) if (!taken.has(fold(`${name} ${n}`))) return `${name} ${n}`;
}

/** Every row in a package of the list. A row with none, or one naming a package not in the list, goes to its default, made when missing. */
export function withDefaults<S extends RequestShot, A extends RequestAsset>(rows: { readonly shots: readonly S[]; readonly assets: readonly A[]; readonly packages?: readonly RequestPackage[] }): PackageRows<S, A> {
	const packages: RequestPackage[] = [...(rows.packages ?? [])];
	const known = new Set(packages.map((p) => p.id));
	const place = (kind: Kind, current: Id | undefined, sequence: string | undefined): Id => {
		if (current !== undefined && known.has(current)) return current;
		const fallback = defaultPackage(kind, sequence);
		if (!known.has(fallback.id)) {
			packages.push({ id: fallback.id, name: freeName(fallback.name, packages) });
			known.add(fallback.id);
		}
		return fallback.id;
	};
	const shots = rows.shots.map((s) => {
		const id = place('shot', s.package, s.sequence);
		return s.package === id ? s : { ...s, package: id };
	});
	const assets = rows.assets.map((a) => {
		const id = place('asset', a.package, undefined);
		return a.package === id ? a : { ...a, package: id };
	});
	return { shots, assets, packages };
}

/** A request's packages, each row's package, and each package's rows. */
export interface Resolved {
	readonly packages: readonly RequestPackage[];
	/** The request is from before packages: one package, every row. */
	readonly implicit: boolean;
	/** Package id by target key, `shot:sh010`. */
	readonly of: ReadonlyMap<string, Id>;
	/** Each package's rows, in the request's order. */
	readonly rows: ReadonlyMap<Id, readonly Target[]>;
	/** Each package's rows not omitted. */
	readonly live: ReadonlyMap<Id, readonly Target[]>;
}

type Rows = Pick<BidRequest, 'shots' | 'assets' | 'packages'>;

function entries(request: Rows): { target: Target; label: string; package?: Id; omitted: boolean; frames?: number }[] {
	return [
		...request.shots.map((s) => ({ target: { kind: 'shot', id: s.id } as Target, label: s.code, package: s.package, omitted: s.omitted, frames: s.frames })),
		...request.assets.map((a) => ({ target: { kind: 'asset', id: a.id } as Target, label: a.name, package: a.package, omitted: a.omitted === true }))
	];
}

export function resolvePackages(request: Rows): Resolved {
	const implicit = !request.packages || request.packages.length === 0;
	const packages = implicit ? [ALL_PACKAGE] : [...request.packages!];
	const known = new Set(packages.map((p) => p.id));
	const of = new Map<string, Id>();
	const rows = new Map<Id, Target[]>(packages.map((p) => [p.id, []]));
	const live = new Map<Id, Target[]>(packages.map((p) => [p.id, []]));
	for (const entry of entries(request)) {
		let id: Id;
		if (implicit) id = ALL_PACKAGE.id;
		else if (entry.package === undefined) throw new Error(`${entry.label} has no package.`);
		else if (!known.has(entry.package)) throw new Error(`${entry.label} names a package not in the request.`);
		else id = entry.package;
		of.set(targetKey(entry.target), id);
		rows.get(id)!.push(entry.target);
		if (!entry.omitted) live.get(id)!.push(entry.target);
	}
	return { packages, implicit, of, rows, live };
}

// Production's edits.

export type Edit<S extends RequestShot, A extends RequestAsset> = { readonly ok: true; readonly rows: PackageRows<S, A> } | { readonly ok: false; readonly message: string };

/** What is wrong with a package name, or null. `except`: the package being renamed. */
export function nameProblem(name: string, packages: readonly RequestPackage[], except?: Id): string | null {
	const trimmed = name.trim();
	if (trimmed === '') return 'Name the package.';
	if (trimmed.length > MAX_PACKAGE_NAME) return `A package name is ${MAX_PACKAGE_NAME} characters at most.`;
	const other = packages.find((p) => p.id !== except && fold(p.name) === fold(trimmed));
	return other ? `Another package is named ${other.name}.` : null;
}

/** A new empty package. `id` is the caller's: `pkg:<random>`. */
export function addPackage<S extends RequestShot, A extends RequestAsset>(rows: PackageRows<S, A>, name: string, id: Id): Edit<S, A> {
	const problem = nameProblem(name, rows.packages);
	if (problem) return { ok: false, message: problem };
	if (rows.packages.some((p) => p.id === id)) return { ok: false, message: 'That package is there already.' };
	return { ok: true, rows: { ...rows, packages: [...rows.packages, { id, name: name.trim() }] } };
}

/** A copy of the package, named `<name> copy`, right after it, with no rows. A package holds no other setting. */
export function duplicatePackage<S extends RequestShot, A extends RequestAsset>(rows: PackageRows<S, A>, id: Id, copyId: Id): Edit<S, A> {
	const index = rows.packages.findIndex((p) => p.id === id);
	if (index < 0) return { ok: false, message: 'No such package.' };
	if (rows.packages.some((p) => p.id === copyId)) return { ok: false, message: 'That package is there already.' };
	const name = freeName(`${rows.packages[index].name} copy`.slice(0, MAX_PACKAGE_NAME), rows.packages);
	const packages = [...rows.packages];
	packages.splice(index + 1, 0, { id: copyId, name });
	return { ok: true, rows: { ...rows, packages } };
}

export function renamePackage<S extends RequestShot, A extends RequestAsset>(rows: PackageRows<S, A>, id: Id, name: string): Edit<S, A> {
	if (!rows.packages.some((p) => p.id === id)) return { ok: false, message: 'No such package.' };
	const problem = nameProblem(name, rows.packages, id);
	if (problem) return { ok: false, message: problem };
	return { ok: true, rows: { ...rows, packages: rows.packages.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)) } };
}

/** The rows named go to the package. */
export function moveRows<S extends RequestShot, A extends RequestAsset>(rows: PackageRows<S, A>, targets: readonly Target[], id: Id): Edit<S, A> {
	if (!rows.packages.some((p) => p.id === id)) return { ok: false, message: 'No such package.' };
	const keys = new Set(targets.map(targetKey));
	return {
		ok: true,
		rows: {
			...rows,
			shots: rows.shots.map((s) => (keys.has(targetKey({ kind: 'shot', id: s.id })) ? { ...s, package: id } : s)),
			assets: rows.assets.map((a) => (keys.has(targetKey({ kind: 'asset', id: a.id })) ? { ...a, package: id } : a))
		}
	};
}

/** The package goes. Each of its rows goes back to its sequence's package, else to the catch-all of its kind. */
export function deletePackage<S extends RequestShot, A extends RequestAsset>(rows: PackageRows<S, A>, id: Id): Edit<S, A> {
	const gone = rows.packages.find((p) => p.id === id);
	if (!gone) return { ok: false, message: 'No such package.' };
	const packages = rows.packages.filter((p) => p.id !== id);
	const known = new Set(packages.map((p) => p.id));
	let stuck = false;
	const home = (kind: Kind, sequence: string | undefined): Id => {
		const mine = defaultPackage(kind, sequence);
		if (mine.id !== id && known.has(mine.id)) return mine.id;
		const catchAll = kind === 'shot' ? OTHER_SHOTS : ASSETS;
		if (catchAll.id === id) {
			stuck = true;
			return id;
		}
		if (!known.has(catchAll.id)) {
			packages.push({ id: catchAll.id, name: freeName(catchAll.name, packages) });
			known.add(catchAll.id);
		}
		return catchAll.id;
	};
	const shots = rows.shots.map((s) => (s.package === id ? { ...s, package: home('shot', s.sequence) } : s));
	const assets = rows.assets.map((a) => (a.package === id ? { ...a, package: home('asset', undefined) } : a));
	if (stuck) return { ok: false, message: `${gone.name} holds rows with nowhere else to go. Move them to another package first.` };
	return { ok: true, rows: { shots, assets, packages } };
}

export interface PackageStats {
	/** Rows not omitted. */
	readonly rows: number;
	readonly omitted: number;
	readonly shots: number;
	readonly assets: number;
	/** Frames of the live shots that have a count. */
	readonly frames: number;
	readonly withoutFrames: number;
}

export function packageStats(request: Rows): Map<Id, PackageStats> {
	const resolved = resolvePackages(request);
	const byKey = new Map(entries(request).map((e) => [targetKey(e.target), e]));
	const out = new Map<Id, PackageStats>();
	for (const p of resolved.packages) {
		const all = resolved.rows.get(p.id) ?? [];
		const live = (resolved.live.get(p.id) ?? []).map((t) => byKey.get(targetKey(t))!);
		const shots = live.filter((e) => e.target.kind === 'shot');
		out.set(p.id, {
			rows: live.length,
			omitted: all.length - live.length,
			shots: shots.length,
			assets: live.length - shots.length,
			frames: shots.reduce((n, e) => n + (e.frames ?? 0), 0),
			withoutFrames: shots.filter((e) => e.frames === undefined).length
		});
	}
	return out;
}

// One figure for a package.

/**
 * A figure shared by weight, in minor units: each part rounded down, the remainder on the last, so
 * the parts sum to the figure exactly. A weight that is not a whole number above zero makes every
 * part equal.
 */
export function allocate(total: Money, weights: readonly number[]): Money[] {
	if (weights.length === 0) return [];
	const fair = weights.every((w) => Number.isSafeInteger(w) && w > 0);
	const ws = (fair ? weights : weights.map(() => 1)).map(BigInt);
	const whole = ws.reduce((a, b) => a + b, 0n);
	const minor = BigInt(total.minor);
	const parts = ws.map((w) => (minor * w) / whole);
	const given = parts.slice(0, -1).reduce((a, b) => a + b, 0n);
	parts[parts.length - 1] = minor - given;
	return parts.map((p) => money(Number(p), total.currency));
}

/** Each live row's weight in its package's figure: its frames when every shot has a count, else one each. */
function weightsOf(request: Rows, targets: readonly Target[]): number[] {
	const frames = new Map(request.shots.map((s) => [s.id, s.frames]));
	const counts = targets.map((t) => (t.kind === 'shot' ? frames.get(t.id) : undefined));
	return counts.every((n): n is number => typeof n === 'number' && n > 0) ? counts : targets.map(() => 1);
}

export interface LineAmount {
	readonly bid: Money;
	/** Null while the bid needs a rate. */
	readonly base: Money | null;
}

/**
 * What each line not excluded is worth, by target key: its own total, or its part of its package's
 * figure. `base`: the request's base currency.
 */
export function lineAmounts(request: Rows, bid: Pick<VendorBid, 'id' | 'currency' | 'rate' | 'lines' | 'packages'>, base: string): Map<string, LineAmount> {
	const convertible = bid.currency === base || bid.rate !== null;
	const inBase = (amount: Money): Money | null => (convertible ? toBase(amount, bid as VendorBid, base) : null);
	const out = new Map<string, LineAmount>();
	for (const line of bid.lines) {
		if (line.excluded || line.inPackage) continue;
		out.set(targetKey(line.target), { bid: line.total, base: inBase(line.total) });
	}
	if (!bid.packages?.length) return out;
	const resolved = resolvePackages(request);
	const covered = new Set(bid.lines.filter((l) => l.inPackage && !l.excluded).map((l) => targetKey(l.target)));
	for (const price of bid.packages) {
		const targets = (resolved.live.get(price.package) ?? []).filter((t) => covered.has(targetKey(t)));
		if (targets.length === 0) continue;
		const weights = weightsOf(request, targets);
		const parts = allocate(price.total, weights);
		const baseTotal = inBase(price.total);
		const baseParts = baseTotal ? allocate(baseTotal, weights) : null;
		targets.forEach((t, i) => out.set(targetKey(t), { bid: parts[i], base: baseParts ? baseParts[i] : null }));
	}
	return out;
}

/** The package figures by package id. */
export function packagePrices(bid: Pick<VendorBid, 'packages'>): Map<Id, PackagePrice> {
	return new Map((bid.packages ?? []).map((p) => [p.package, p]));
}

/**
 * What breaks the rules of package prices in a bid, in words. `allowed`: the packages the vendor may
 * price, when it is not invited to all.
 */
export function packageProblems(
	resolved: Resolved,
	request: Rows,
	bid: {
		readonly lines: readonly Pick<BidLine, 'target' | 'inPackage' | 'excluded'>[];
		readonly packages?: readonly PackagePrice[];
		readonly declined?: readonly Id[];
	},
	allowed?: ReadonlySet<Id>
): string[] {
	const problems: string[] = [];
	const names = new Map(resolved.packages.map((p) => [p.id, p.name]));
	const byKey = new Map(entries(request).map((e) => [targetKey(e.target), e]));
	const declined = new Set<Id>();
	for (const id of bid.declined ?? []) {
		if (!names.has(id) || (allowed && !allowed.has(id))) problems.push('You are not bidding on a package that is not in the request.');
		else declined.add(id);
	}
	const priced = new Set<Id>();
	for (const price of bid.packages ?? []) {
		if (!names.has(price.package) || (allowed && !allowed.has(price.package))) {
			problems.push('A package price names a package not in the request.');
			continue;
		}
		if (declined.has(price.package)) {
			problems.push(`You are not bidding on ${names.get(price.package)}. It takes no price.`);
			continue;
		}
		if (priced.has(price.package)) {
			problems.push(`${names.get(price.package)} is priced twice.`);
			continue;
		}
		priced.add(price.package);
	}
	const lines = new Map(bid.lines.map((l) => [targetKey(l.target), l]));
	for (const [key, line] of lines) {
		const entry = byKey.get(key);
		const pkg = resolved.of.get(key);
		if (!entry || pkg === undefined) continue;
		if (declined.has(pkg)) {
			problems.push(`${entry.label} is in ${names.get(pkg)}, which you are not bidding on. It takes no price.`);
			continue;
		}
		if (line.inPackage) {
			if (entry.omitted) problems.push(`${entry.label} is omitted. It is not in a package price.`);
			else if (!priced.has(pkg)) problems.push(`${entry.label} is in a package price, but ${names.get(pkg)} has no one figure.`);
		} else if (priced.has(pkg)) problems.push(`${entry.label} is in ${names.get(pkg)}, priced as one figure. It takes no price of its own.`);
	}
	for (const pkg of priced) {
		for (const target of resolved.live.get(pkg) ?? []) {
			if (!lines.has(targetKey(target))) problems.push(`${names.get(pkg)} is priced as one figure. ${byKey.get(targetKey(target))?.label} has no line in it.`);
		}
	}
	const offered = allowed ? resolved.packages.filter((p) => allowed.has(p.id)) : resolved.packages;
	if (offered.length > 0 && offered.every((p) => declined.has(p.id))) problems.push('Bid on one package at least.');
	return problems;
}

/** The packages the bid declines, as a set. */
export function declinedOf(bid: Pick<VendorBid, 'declined'>): Set<Id> {
	return new Set(bid.declined ?? []);
}

/**
 * The packages a set of picks gives in part to a bid that priced them as one figure, or splits with
 * it. Such a package goes whole to its vendor or not at all. `picks`: target key to shares.
 */
export function partialPackagePicks(
	resolved: Resolved,
	bids: readonly Pick<VendorBid, 'id' | 'packages'>[],
	picks: ReadonlyMap<string, readonly { readonly bidId: Id; readonly percent: string }[]>
): { bidId: Id; package: Id; name: string }[] {
	const out: { bidId: Id; package: Id; name: string }[] = [];
	for (const bid of bids) {
		for (const price of bid.packages ?? []) {
			const targets = resolved.live.get(price.package) ?? [];
			const given = targets.filter((t) => picks.get(targetKey(t))?.some((s) => s.bidId === bid.id));
			if (given.length === 0) continue;
			const whole = given.length === targets.length && given.every((t) => {
				const shares = picks.get(targetKey(t))!;
				return shares.length === 1 && Number(shares[0].percent) === 100;
			});
			if (!whole) out.push({ bidId: bid.id, package: price.package, name: resolved.packages.find((p) => p.id === price.package)?.name ?? price.package });
		}
	}
	return out;
}

// What a vendor sees.

/** The packages a vendor is invited to, in the request's order. No list: every package. */
export function invitedPackages(resolved: Resolved, invited: readonly Id[] | undefined | null): RequestPackage[] {
	if (!invited) return [...resolved.packages];
	const wanted = new Set(invited);
	return resolved.packages.filter((p) => wanted.has(p.id));
}

/** The target keys of the rows a vendor may see and bid on. */
export function visibleRows(resolved: Resolved, invited: readonly Id[] | undefined | null): Set<string> {
	const out = new Set<string>();
	for (const p of invitedPackages(resolved, invited)) for (const t of resolved.rows.get(p.id) ?? []) out.add(targetKey(t));
	return out;
}
