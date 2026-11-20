/**
 * Match to Flow PT: breakdown rows of a request against the Flow PT Shots or Assets of the project
 * with the same code. Exact first, then without case; never a near code. Pure, no I/O.
 *
 * Flow PT's text filters ignore case (field_types/text), so one `code in [...]` read brings both
 * kinds of candidate, and the case is checked here. A code is not unique in Flow PT (entity_types/
 * Shot): two rows that fit equally are named, never picked between. A Flow PT row already in the
 * request, or given to an earlier row here, is not given twice.
 */

import type { ItemKind } from './field-map';
import type { EntityRef, Id, RequestAsset, RequestShot } from './model';
import type { ItemLink } from './wire';

export interface Candidate {
	readonly id: number;
	readonly code: string;
}

type Row = RequestShot | RequestAsset;

export type Match =
	| { readonly id: Id; readonly code: string; readonly state: 'exact' | 'case'; readonly fpt: EntityRef; readonly found: string }
	| { readonly id: Id; readonly code: string; readonly state: 'several'; readonly ids: readonly number[] }
	| { readonly id: Id; readonly code: string; readonly state: 'taken'; readonly by: string }
	| { readonly id: Id; readonly code: string; readonly state: 'none' };

const labelOf = (row: Row) => ('code' in row ? row.code : row.name);

/** The breakdown rows still waiting for their Flow PT row. */
export function unmatched<T extends Row>(rows: readonly T[]): T[] {
	return rows.filter((r) => r.source === 'breakdown' && !r.fpt);
}

/** The codes to look up, once each. */
export function codesToFind(rows: readonly Row[]): string[] {
	return [...new Set(unmatched(rows).map((r) => labelOf(r).trim()).filter(Boolean))];
}

export function matchRows(kind: ItemKind, rows: readonly Row[], candidates: readonly Candidate[]): Match[] {
	const type = kind === 'shot' ? 'Shot' : 'Asset';
	const held = new Map<number, string>();
	for (const r of rows) if (r.fpt && r.fpt.type === type) held.set(r.fpt.id, labelOf(r));
	const out: Match[] = [];
	for (const row of unmatched(rows)) {
		const code = labelOf(row).trim();
		const exact = candidates.filter((c) => c.code.trim() === code);
		const loose = candidates.filter((c) => c.code.trim().toLowerCase() === code.toLowerCase());
		const fit = exact.length > 0 ? exact : loose;
		const base = { id: row.id, code: labelOf(row) };
		if (fit.length === 0) out.push({ ...base, state: 'none' });
		else if (fit.length > 1) out.push({ ...base, state: 'several', ids: fit.map((c) => c.id) });
		else if (held.has(fit[0].id)) out.push({ ...base, state: 'taken', by: held.get(fit[0].id)! });
		else {
			held.set(fit[0].id, labelOf(row));
			out.push({ ...base, state: exact.length > 0 ? 'exact' : 'case', fpt: { type, id: fit[0].id }, found: fit[0].code });
		}
	}
	return out;
}

/** The links for the rows picked, those with one match only. */
export function linkPlan(kind: ItemKind, matches: readonly Match[], picked: ReadonlySet<Id>): ItemLink[] {
	return matches.flatMap((m) => ((m.state === 'exact' || m.state === 'case') && picked.has(m.id) ? [{ kind, key: m.id, fpt: m.fpt }] : []));
}

/** The rows with their links applied, for a draft. */
export function withLinks<T extends Row>(rows: readonly T[], links: readonly ItemLink[]): T[] {
	const by = new Map(links.map((l) => [l.key, l.fpt]));
	return rows.map((r) => (by.has(r.id) && !r.fpt ? { ...r, fpt: by.get(r.id)! } : r));
}
