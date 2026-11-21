/**
 * Where a row of the request comes from, for the mark by its code and the source filter: Flow PT,
 * a breakdown, or a breakdown row linked to its Flow PT row since. A linked row is still a
 * breakdown row: its cells stay in the request only. Pure, no I/O.
 */

export type RowSource = 'fpt' | 'breakdown' | 'linked';
export type SourceFilter = 'all' | 'fpt' | 'breakdown';

interface Sourced {
	readonly source?: 'breakdown';
	readonly fpt?: unknown;
}

export function rowSource(item: Sourced): RowSource {
	if (item.source !== 'breakdown') return 'fpt';
	return item.fpt ? 'linked' : 'breakdown';
}

export function bySource<T extends Sourced>(items: readonly T[], filter: SourceFilter): readonly T[] {
	if (filter === 'all') return items;
	return items.filter((item) => (rowSource(item) === 'fpt') === (filter === 'fpt'));
}

/** The filter shows only when the request holds both kinds. */
export function hasBothSources(items: readonly Sourced[]): boolean {
	let fpt = false;
	let breakdown = false;
	for (const item of items) {
		if (rowSource(item) === 'fpt') fpt = true;
		else breakdown = true;
		if (fpt && breakdown) return true;
	}
	return false;
}
