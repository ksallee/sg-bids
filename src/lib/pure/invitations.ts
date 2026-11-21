/**
 * An invitation as production sees it: its state, the counts on the requests list, the vendor
 * form's checks and the link. Pure, no I/O.
 *
 * Production never sees a vendor's draft (`access.ts`: a draft is the vendor's until it submits),
 * so an invitation with a draft in progress reads as opened.
 */

export interface InvitationFacts {
	readonly id: string;
	readonly request_id: string;
	readonly expires_at: string;
	readonly revoked_at: string | null;
	readonly last_opened_at: string | null;
	/** Added to a draft: its link is made at the issue. */
	readonly link_pending?: boolean;
}

export interface BidFacts {
	readonly invitation_id: string;
	readonly request_id: string;
	readonly version: number;
	readonly status: 'draft' | 'submitted' | 'withdrawn';
	readonly submitted_at: string | null;
	readonly withdrawn_at: string | null;
}

export type InvitationState =
	| { readonly kind: 'pending' }
	| { readonly kind: 'not_opened' }
	| { readonly kind: 'opened'; readonly at: string }
	| { readonly kind: 'submitted'; readonly version: number; readonly at: string }
	| { readonly kind: 'withdrawn'; readonly version: number; readonly at: string }
	| { readonly kind: 'revoked'; readonly at: string }
	| { readonly kind: 'expired'; readonly at: string };

function live(invitation: InvitationFacts, now: Date): boolean {
	return invitation.revoked_at === null && new Date(invitation.expires_at).getTime() > now.getTime();
}

export function invitationState(invitation: InvitationFacts, bids: readonly BidFacts[], now: Date): InvitationState {
	if (invitation.link_pending) return { kind: 'pending' };
	if (invitation.revoked_at !== null) return { kind: 'revoked', at: invitation.revoked_at };
	if (!live(invitation, now)) return { kind: 'expired', at: invitation.expires_at };
	const latest = bids
		.filter((b) => b.invitation_id === invitation.id && b.status !== 'draft')
		.sort((a, b) => b.version - a.version)[0];
	if (latest?.status === 'withdrawn') return { kind: 'withdrawn', version: latest.version, at: latest.withdrawn_at ?? '' };
	if (latest) return { kind: 'submitted', version: latest.version, at: latest.submitted_at ?? '' };
	if (invitation.last_opened_at) return { kind: 'opened', at: invitation.last_opened_at };
	return { kind: 'not_opened' };
}

export function stateLabel(state: InvitationState): string {
	switch (state.kind) {
		case 'pending':
			return 'Link made at the issue';
		case 'not_opened':
			return 'Not opened';
		case 'opened':
			return 'Opened';
		case 'submitted':
			return `Submitted, version ${state.version}`;
		case 'withdrawn':
			return `Withdrawn, version ${state.version}`;
		case 'revoked':
			return 'Link revoked';
		case 'expired':
			return 'Link expired';
	}
}

export interface RequestCounts {
	/** Invitations whose link still works. */
	readonly invited: number;
	/** Vendors whose latest bid is submitted. */
	readonly submitted: number;
}

export function requestCounts(invitations: readonly InvitationFacts[], bids: readonly BidFacts[], now: Date): Map<string, RequestCounts> {
	const counts = new Map<string, { invited: number; submitted: number }>();
	for (const invitation of invitations) {
		const entry = counts.get(invitation.request_id) ?? { invited: 0, submitted: 0 };
		if (live(invitation, now)) entry.invited += 1;
		if (invitationState({ ...invitation, revoked_at: null, expires_at: '9999-12-31T00:00:00Z' }, bids, now).kind === 'submitted') entry.submitted += 1;
		counts.set(invitation.request_id, entry);
	}
	return counts;
}

export interface VendorForm {
	readonly name: string;
	readonly email: string;
}

/** The database takes `^[^@\s]+@[^@\s]+$` (supabase/migrations). */
const EMAIL = /^[^@\s]+@[^@\s]+$/;

/** What the invite form cannot go without. The Flow PT Group is optional. */
export const VENDOR_REQUIRED: readonly (keyof VendorForm)[] = ['name', 'email'];

export function validateVendor(form: VendorForm): Partial<Record<keyof VendorForm, string>> {
	const errors: Partial<Record<keyof VendorForm, string>> = {};
	if (form.name.trim() === '') errors.name = 'Name the vendor.';
	if (form.email.trim() === '') errors.email = 'Write the contact email.';
	else if (!EMAIL.test(form.email.trim())) errors.email = 'The contact email is not an address. Write it as name@studio.com.';
	return errors;
}

/** The link a vendor opens. The vendor pages live under `/v/`. */
export function vendorLink(origin: string, token: string): string {
	return `${origin.replace(/\/+$/, '')}/v/${token}`;
}
