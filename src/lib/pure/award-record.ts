/**
 * The award as the app records it, once Flow PT holds it: the award rows, the summary the request
 * and compare pages show, and the links to the Bids in Flow PT. Pure, no I/O.
 *
 * The rows come from the chosen scenario as stored, never from the browser: each share becomes a row
 * on the bid line it names, with the Flow PT Bid and Bid Line written for it, found by key.
 *
 * A record's link to a Bid is the site's detail page, `/detail/<Type>/<id>`: the shape the site gives
 * a Project's landing page and a person's page (entity_types/Project, 156). It is not measured for a
 * custom entity.
 */

import { bidKey, GENERAL_COSTS, lineKey, rowBidKey, type FptSite, type MissingOptions, type Written } from './fpt-award';
import { applyScenario } from './compare';
import { targetKey, type AwardScenario, type BidRequest, type Id, type VendorBid } from './model';
import { add, money, type Money } from './money';
import { percentOf } from './percent';
import { lineAmounts, resolvePackages } from './packages';

export interface AwardRow {
	readonly item_kind: 'shot' | 'asset';
	readonly item_key: string;
	readonly bid_line_id: Id;
	readonly share_percent: string;
	readonly fpt_bid_id: number | null;
	readonly fpt_line_id: number | null;
}

/** One row per share of each pick, on the line it names, with what Flow PT holds for it. */
export function awardRows(request: BidRequest, bids: readonly VendorBid[], scenario: AwardScenario, written: Written): AwardRow[] {
	const byId = new Map(bids.map((b) => [b.id, b]));
	const bidIds = new Map(written.bids.map((b) => [b.key, b.id]));
	const lineIds = new Map(written.lines.map((l) => [l.key, l.id]));
	const packages = resolvePackages(request);
	const rows: AwardRow[] = [];
	for (const pick of scenario.picks) {
		for (const share of pick.shares) {
			const bid = byId.get(share.bidId);
			if (!bid) throw new Error(`The scenario picks bid ${share.bidId}; it is not among the bids.`);
			const line = bid.lines.find((l) => targetKey(l.target) === targetKey(pick.target));
			if (!line) throw new Error(`Bid ${bid.id} has no line for ${pick.target.kind} ${pick.target.id}.`);
			// The row's line sits under its package's Bid (`fpt-award.ts`).
			const key = rowBidKey(packages, bidKey(request.id, bid.vendorId, bid.round), pick.target);
			rows.push({
				item_kind: pick.target.kind,
				item_key: pick.target.id,
				bid_line_id: line.id,
				share_percent: share.percent,
				fpt_bid_id: bidIds.get(key) ?? null,
				fpt_line_id: lineIds.get(lineKey(key, pick.target)) ?? null
			});
		}
	}
	return rows;
}

export interface VendorPart {
	readonly vendorId: Id;
	readonly name: string;
	readonly shots: number;
	readonly assets: number;
	/** Of those, rows it shares with another vendor. */
	readonly split: number;
	/** Its awarded part in the base currency. */
	readonly total: Money;
}

export interface AwardSummary {
	readonly baseCurrency: string;
	readonly total: Money;
	readonly shots: number;
	readonly assets: number;
	readonly split: number;
	readonly vendors: readonly VendorPart[];
}

/** Who won what, in the base currency. Non-shot costs are left out: they stay on each Bid's total. */
export function awardSummary(request: BidRequest, bids: readonly VendorBid[], scenario: AwardScenario): AwardSummary {
	applyScenario(request, bids, scenario); // throws on a scenario that does not hold together
	const base = request.header.baseCurrency;
	const byId = new Map(bids.map((b) => [b.id, b]));
	const names = new Map(request.vendors.map((v) => [v.id, v.name]));
	const parts = new Map<Id, { shots: number; assets: number; split: number; total: Money }>();
	let total = money(0, base);
	let shots = 0;
	let assets = 0;
	let split = 0;
	// A row in a package price is worth its part of the figure (`packages.ts`): the parts sum to it exactly.
	const worth = new Map(bids.map((b) => [b.id, lineAmounts(request, b, base)]));
	for (const pick of scenario.picks) {
		if (pick.target.kind === 'shot') shots++;
		else assets++;
		const shared = pick.shares.length > 1;
		if (shared) split++;
		for (const share of pick.shares) {
			const bid = byId.get(share.bidId)!;
			const own = worth.get(bid.id)!.get(targetKey(pick.target));
			if (!own?.base) throw new Error(`Bid ${bid.id} has no figure in ${base} for ${pick.target.kind} ${pick.target.id}.`);
			const amount = percentOf(own.base, share.percent);
			const part = parts.get(bid.vendorId) ?? { shots: 0, assets: 0, split: 0, total: money(0, base) };
			if (pick.target.kind === 'shot') part.shots++;
			else part.assets++;
			if (shared) part.split++;
			part.total = add(part.total, amount);
			parts.set(bid.vendorId, part);
			total = add(total, amount);
		}
	}
	const vendors = [...parts.entries()]
		.map(([vendorId, p]) => ({ vendorId, name: names.get(vendorId) ?? 'A vendor', ...p }))
		.sort((a, b) => b.total.minor - a.total.minor || a.name.localeCompare(b.name));
	return { baseCurrency: base, total, shots, assets, split, vendors };
}

export interface BidLink {
	readonly vendorId: Id;
	readonly name: string;
	/** The package the Bid is for, `General costs` for the whole-bid figures, or null: the one Bid of a request from before packages. */
	readonly label: string | null;
	readonly id: number;
	readonly url: string;
}

/** The site's page for a row. */
export function detailUrl(siteUrl: string, type: string, id: number): string {
	return `${siteUrl.replace(/\/+$/, '')}/detail/${encodeURIComponent(type)}/${id}`;
}

/** A link to each Bid the award wrote, by vendor, with its package, read from the keys. */
export function bidLinks(siteUrl: string, site: Pick<FptSite, 'bidType'>, written: Written, request: Pick<BidRequest, 'id' | 'vendors' | 'packages'>): BidLink[] {
	const prefix = `sgbids/${request.id}/`;
	const packageNames = new Map((request.packages ?? []).map((p) => [p.id, p.name]));
	return written.bids.flatMap((b) => {
		if (!b.key.startsWith(prefix)) return [];
		const [vendorId, , part] = b.key.slice(prefix.length).split('/');
		const name = request.vendors.find((v) => v.id === vendorId)?.name ?? 'A vendor';
		const label = part === 'general' ? GENERAL_COSTS : part?.startsWith('p:') ? (packageNames.get(decodeURIComponent(part.slice(2))) ?? 'A bid') : null;
		return [{ vendorId, name, label, id: b.id, url: detailUrl(siteUrl, site.bidType, b.id) }];
	});
}

/** The choice to publish while vendors could read Bid or Bid Line, as recorded. */
export interface ExposureChoice {
	readonly state: 'exposed' | 'unknown';
	readonly lines: readonly string[];
	readonly acceptedAt: string;
}

export type PublicationState = 'published' | 'partial' | 'undo_partial';

/** The award record as the pages read it. */
export interface Publication {
	readonly state: PublicationState;
	readonly scenarioId: Id | null;
	readonly site: FptSite;
	readonly written: Written;
	readonly options: { readonly allLines: boolean; readonly groups: Readonly<Record<Id, number | null>>; readonly missing?: MissingOptions };
	readonly problems: readonly string[];
	readonly error: string | null;
	readonly exposure: ExposureChoice | null;
	readonly summary: AwardSummary | null;
	readonly publishedBy: { readonly type: string; readonly id: number; readonly name: string | null };
	readonly publishedAt: string;
	readonly updatedAt: string;
}

/** An `award_publications` row as the database answers it. */
export interface PublicationRow {
	readonly state: PublicationState;
	readonly scenario_id: string | null;
	readonly site: FptSite;
	readonly written: Written;
	readonly options: Publication['options'];
	readonly problems: string[];
	readonly error: string | null;
	readonly exposure: ExposureChoice | null;
	readonly summary: AwardSummary | Record<string, never>;
	readonly published_by: Publication['publishedBy'];
	readonly published_at: string;
	readonly updated_at: string;
}

export function publicationFromRow(row: PublicationRow): Publication {
	return {
		state: row.state,
		scenarioId: row.scenario_id,
		site: row.site,
		written: row.written,
		options: row.options,
		problems: row.problems,
		error: row.error,
		exposure: row.exposure,
		summary: 'total' in row.summary ? (row.summary as AwardSummary) : null,
		publishedBy: row.published_by,
		publishedAt: row.published_at,
		updatedAt: row.updated_at
	};
}

/** What a stopped run or undo left, counted, for the plain words on the page. */
export function leftCounts(written: Written): { bids: number; lines: number; groups: number } {
	return { bids: written.bids.length, lines: written.lines.length, groups: written.groups.reduce((n, g) => n + g.groups.length, 0) };
}
