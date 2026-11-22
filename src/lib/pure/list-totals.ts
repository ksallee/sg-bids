/**
 * The requests list's bids and totals, from three reads the server makes for every listed request
 * at once (`requests.ts`, `overview`). Pure, no I/O.
 *
 * Bids: every request's `request_packages`, by position. A draft's package names its bid; an issued
 * request's holds its rows. Totals count units, not rows (`count.ts`), and leave omitted rows out:
 *   - a draft from its `production_bids` counts, which `sg_production_bid_counts` keeps at every save
 *     as the units of the rows not omitted (`20261128100000_count.sql`);
 *   - an issued, awarded or closed request from its own `request_items`, each row its `unit_count`.
 */

import type { RequestRow } from './rows';

export interface ListTotals {
	readonly bids: readonly string[];
	readonly shots: number;
	readonly assets: number;
}

export interface TotalsInput {
	readonly packages: readonly { readonly request_id: string; readonly name: string; readonly position: number }[];
	/** A draft's bids, with the counts the database keeps on them. */
	readonly draftBids: readonly { readonly request_id: string; readonly shot_count: number; readonly asset_count: number }[];
	/** An issued request's rows. */
	readonly items: readonly { readonly request_id: string; readonly kind: string; readonly unit_count: number | null; readonly omitted: boolean }[];
}

export function listTotals(requests: readonly { readonly id: string; readonly status: RequestRow['status'] }[], input: TotalsInput): Map<string, ListTotals> {
	const drafts = new Set(requests.filter((r) => r.status === 'draft').map((r) => r.id));
	const out = new Map(requests.map((r) => [r.id, { bids: [] as { name: string; position: number }[], shots: 0, assets: 0 }]));
	for (const p of input.packages) out.get(p.request_id)?.bids.push({ name: p.name, position: p.position });
	for (const b of input.draftBids) {
		const t = drafts.has(b.request_id) ? out.get(b.request_id) : undefined;
		if (!t) continue;
		t.shots += b.shot_count;
		t.assets += b.asset_count;
	}
	for (const i of input.items) {
		const t = drafts.has(i.request_id) ? undefined : out.get(i.request_id);
		if (!t || i.omitted) continue;
		const units = i.unit_count ?? 1;
		if (i.kind === 'shot') t.shots += units;
		else if (i.kind === 'asset') t.assets += units;
	}
	return new Map(
		[...out].map(([id, t]) => [id, { bids: t.bids.sort((a, b) => a.position - b.position).map((b) => b.name), shots: t.shots, assets: t.assets }])
	);
}
