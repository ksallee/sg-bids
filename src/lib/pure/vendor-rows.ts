/**
 * The vendors of a draft request, as rows on its page. Pure, no I/O.
 *
 * A row is typed straight in: a name, an email, a Flow PT Group, and the bids it answers (every bid,
 * or some). A blank row is not saved. A row is kept as typed, so a half typed one survives a
 * reload; the issue holds each to a name and an email (`readiness`). The bids it answers are never
 * none: unticking the last one keeps it, and a bid that goes leaves the vendor its others, or every
 * bid when it had only that one.
 */

import type { Id, InvitedVendor } from './model';
import type { DraftBid } from './request-draft';

export interface VendorRow {
	readonly id: Id;
	readonly name: string;
	readonly email: string;
	/** The vendor's Group in Flow PT, written to the Shots it wins. */
	readonly group: { readonly id: number; readonly name: string } | null;
	/** The bids it answers, by key. Null: every bid. */
	readonly bids: readonly Id[] | null;
	/** Its link was made before (a request from before this page): it cannot be taken off the draft. */
	readonly linked: boolean;
}

export function blankVendor(id: Id): VendorRow {
	return { id, name: '', email: '', group: null, bids: null, linked: false };
}

/** Nothing typed and no Group picked: the row is not saved. */
export function isBlank(row: VendorRow): boolean {
	return row.name.trim() === '' && row.email.trim() === '' && row.group === null;
}

/** An invitation of the draft as a row. `pending`: its link is made at the issue. */
export function fromInvited(vendor: InvitedVendor, pending: boolean): VendorRow {
	return {
		id: vendor.id,
		name: vendor.name,
		email: vendor.email,
		group: vendor.fpt ? { id: vendor.fpt.id, name: vendor.groupName?.trim() || `Group ${vendor.fpt.id}` } : null,
		bids: vendor.packages ? [...vendor.packages] : null,
		linked: !pending
	};
}

/** The database takes `^[^@\s]+@[^@\s]+$` (supabase/migrations). */
const EMAIL = /^[^@\s]+@[^@\s]+$/;

/** What a row is missing to go out, by field. Empty when it may go. */
export function rowProblems(row: VendorRow): Partial<Record<'name' | 'email', string>> {
	const out: Partial<Record<'name' | 'email', string>> = {};
	if (row.name.trim() === '') out.name = 'Give the vendor a name.';
	const email = row.email.trim();
	if (email === '') out.email = 'Write the vendor’s email.';
	else if (!EMAIL.test(email)) out.email = 'This email is not an address. Write it as name@studio.com.';
	return out;
}

/** The rows a save sends: every one with something typed in it. */
export function savedVendors(rows: readonly VendorRow[]): VendorRow[] {
	return rows.filter((r) => !isBlank(r));
}

/** The bids a row answers, in words: `Every bid`, the one bid, or their names in the request's order. */
export function bidsLabel(row: VendorRow, bids: readonly DraftBid[]): string {
	if (bids.length === 1) return bids[0].name;
	if (row.bids === null) return 'Every bid';
	const picked = bids.filter((b) => row.bids!.includes(b.key));
	return picked.length === 0 || picked.length === bids.length ? 'Every bid' : picked.map((b) => b.name).join(', ');
}

/** The keys a row answers, in the request's order. */
export function answered(row: VendorRow, bids: readonly DraftBid[]): Id[] {
	return row.bids === null ? bids.map((b) => b.key) : bids.filter((b) => row.bids!.includes(b.key)).map((b) => b.key);
}

/** The row answering `keys`: none or all of them reads as every bid. */
export function setBids(row: VendorRow, keys: readonly Id[], bids: readonly DraftBid[]): VendorRow {
	const picked = bids.filter((b) => keys.includes(b.key)).map((b) => b.key);
	return { ...row, bids: picked.length === 0 || picked.length === bids.length ? null : picked };
}

/** One bid ticked or unticked. The last one picked stays. */
export function toggleBid(row: VendorRow, key: Id, bids: readonly DraftBid[]): VendorRow {
	const now = answered(row, bids);
	if (now.includes(key)) {
		if (now.length === 1) return row;
		return setBids(row, now.filter((k) => k !== key), bids);
	}
	return setBids(row, [...now, key], bids);
}

/** A bid goes: each row loses it, and a row left with none answers every bid. */
export function withoutBid(rows: readonly VendorRow[], key: Id): VendorRow[] {
	return rows.map((r) => {
		if (r.bids === null || !r.bids.includes(key)) return r;
		const left = r.bids.filter((k) => k !== key);
		return { ...r, bids: left.length === 0 ? null : left };
	});
}
