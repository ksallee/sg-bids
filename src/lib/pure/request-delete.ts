/**
 * Deleting a request: what the confirm says goes, whether it is refused, the typed check, and the
 * line after. Pure, no I/O. The facts come from `requests.ts` (`deletionFacts`), the delete itself
 * from `sg_delete_request`.
 *
 * A draft asks once. An issued, awarded or closed request destroys vendors' work and kills their
 * links: the confirm names what goes and the request's code must be typed. While an award is in
 * Flow PT the delete is refused: the app's record is what the undo takes Flow PT's rows back with.
 */

export type DeletableStatus = 'draft' | 'issued' | 'awarded' | 'closed';
export type AwardState = 'published' | 'partial' | 'undo_partial';

/** What production may know of a request before it deletes it. Vendor drafts are not counted. */
export interface DeletionFacts {
	readonly id: string;
	readonly code: string;
	readonly title: string | null;
	readonly round: number;
	readonly status: DeletableStatus;
	readonly shots: number;
	readonly assets: number;
	readonly invitations: number;
	/** Submitted and withdrawn bids, every version. */
	readonly bids: number;
	/** The vendors with a submitted or withdrawn bid, by name, once each. */
	readonly vendors: readonly string[];
	readonly scenarios: number;
	readonly rates: number;
	/** The award record, while one is in Flow PT. */
	readonly award: AwardState | null;
}

/** What `sg_delete_request` answers: the request and what went with it. */
export interface Deleted {
	readonly code: string;
	readonly round: number;
	readonly status: DeletableStatus;
	readonly items: number;
	readonly invitations: number;
	readonly bids: number;
	readonly drafts: number;
	readonly lines: number;
	readonly scenarios: number;
	readonly rates: number;
}

export type DeletionPlan =
	| { readonly kind: 'refused'; readonly reason: string }
	| { readonly kind: 'draft' | 'issued'; readonly title: string; readonly lines: readonly string[]; readonly typed: boolean; readonly confirm: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "A", "A and B", "A, B and C". */
export function names(list: readonly string[]): string {
	if (list.length <= 1) return list[0] ?? '';
	return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

function items(f: Pick<DeletionFacts, 'shots' | 'assets'>): string {
	return `${plural(f.shots, 'shot')} and ${plural(f.assets, 'asset')}`;
}

export const REFUSED_AWARD = 'The award is in Flow PT. Undo the award first. Deleting now would leave its Bids and vendor Groups in Flow PT with nothing here to take them back.';

/** What the confirm shows, or why the delete is refused. */
export function deletionPlan(f: DeletionFacts): DeletionPlan {
	if (f.award !== null || f.status === 'awarded') return { kind: 'refused', reason: REFUSED_AWARD };
	const links = f.invitations > 0 ? [`${plural(f.invitations, 'invitation')}. Their links stop working.`] : [];
	if (f.status === 'draft') {
		return { kind: 'draft', title: `Delete the draft ${f.code}?`, lines: [`The draft, with ${items(f)}.`, ...links], typed: false, confirm: 'Delete draft' };
	}
	const lines = [`The request, round ${f.round}, with ${items(f)}.`];
	if (f.invitations > 0) {
		lines.push(`${plural(f.invitations, 'invitation')}. Their links stop working. The vendors see that the production withdrew the request.`);
	}
	if (f.bids > 0) lines.push(`${plural(f.bids, 'submitted bid')}, from ${names(f.vendors)}.`);
	if (f.invitations > 0) lines.push('Any draft a vendor started.');
	if (f.scenarios > 0) lines.push(`${plural(f.scenarios, 'award scenario')}.`);
	if (f.rates > 0) lines.push(`${plural(f.rates, 'exchange rate')}.`);
	return { kind: 'issued', title: `Delete ${f.code}, round ${f.round}?`, lines, typed: true, confirm: 'Delete request' };
}

/** The typed confirmation names the request: its code exactly, spaces around it aside. */
export function codeMatches(typed: string, code: string): boolean {
	return code !== '' && typed.trim() === code;
}

/** The line the list shows after a delete. */
export function deletedLine(d: Deleted): string {
	const parts: string[] = [];
	if (d.invitations > 0) parts.push(plural(d.invitations, 'invitation'));
	if (d.bids > 0) parts.push(plural(d.bids, 'submitted bid'));
	if (d.scenarios > 0) parts.push(plural(d.scenarios, 'scenario'));
	const what = d.status === 'draft' ? `the draft ${d.code}` : `${d.code}, round ${d.round}`;
	return parts.length === 0 ? `Deleted ${what}.` : `Deleted ${what}, with ${names(parts)}.`;
}
