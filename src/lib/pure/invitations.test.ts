import { describe, expect, it } from 'vitest';
import { VENDOR_REQUIRED, invitationState, requestCounts, stateLabel, validateVendor, vendorLink, type BidFacts, type InvitationFacts } from './invitations';

const NOW = new Date('2026-11-20T12:00:00Z');

function inv(extra: Partial<InvitationFacts> = {}): InvitationFacts {
	return { id: 'i1', request_id: 'r1', expires_at: '2027-01-19T12:00:00Z', revoked_at: null, last_opened_at: null, ...extra };
}

function bid(extra: Partial<BidFacts> = {}): BidFacts {
	return { invitation_id: 'i1', request_id: 'r1', version: 1, status: 'submitted', submitted_at: '2026-11-21T09:00:00Z', withdrawn_at: null, ...extra };
}

describe('invitationState', () => {
	it('is not opened until the vendor opens the link', () => {
		expect(invitationState(inv(), [], NOW)).toEqual({ kind: 'not_opened' });
	});

	it('is opened once the link was read', () => {
		expect(invitationState(inv({ last_opened_at: '2026-11-20T10:00:00Z' }), [], NOW)).toEqual({ kind: 'opened', at: '2026-11-20T10:00:00Z' });
	});

	it('is submitted with the latest version and its date', () => {
		const bids = [bid(), bid({ version: 2, submitted_at: '2026-11-22T09:00:00Z' }), bid({ invitation_id: 'other', version: 5 })];
		expect(invitationState(inv({ last_opened_at: 'x' }), bids, NOW)).toEqual({ kind: 'submitted', version: 2, at: '2026-11-22T09:00:00Z' });
	});

	it('is withdrawn when the latest version was', () => {
		const bids = [bid({ status: 'withdrawn', withdrawn_at: '2026-11-23T09:00:00Z' })];
		expect(invitationState(inv(), bids, NOW)).toEqual({ kind: 'withdrawn', version: 1, at: '2026-11-23T09:00:00Z' });
	});

	it('is pending while the vendor waits for the issue to get its link', () => {
		expect(invitationState(inv({ link_pending: true }), [], NOW)).toEqual({ kind: 'pending' });
	});

	it('is revoked or expired before anything else', () => {
		expect(invitationState(inv({ revoked_at: '2026-11-20T11:00:00Z' }), [bid()], NOW)).toEqual({ kind: 'revoked', at: '2026-11-20T11:00:00Z' });
		expect(invitationState(inv({ expires_at: '2026-11-20T11:59:59Z' }), [bid()], NOW)).toEqual({ kind: 'expired', at: '2026-11-20T11:59:59Z' });
	});
});

describe('stateLabel', () => {
	it('says each state in plain words', () => {
		expect(stateLabel({ kind: 'pending' })).toBe('Link made at the issue');
		expect(stateLabel({ kind: 'not_opened' })).toBe('Not opened');
		expect(stateLabel({ kind: 'opened', at: 'x' })).toBe('Opened');
		expect(stateLabel({ kind: 'submitted', version: 2, at: 'x' })).toBe('Submitted, version 2');
		expect(stateLabel({ kind: 'withdrawn', version: 1, at: 'x' })).toBe('Withdrawn, version 1');
		expect(stateLabel({ kind: 'revoked', at: 'x' })).toBe('Link revoked');
		expect(stateLabel({ kind: 'expired', at: 'x' })).toBe('Link expired');
	});
});

describe('requestCounts', () => {
	it('counts live invitations and the vendors who submitted, per request', () => {
		const invitations = [inv(), inv({ id: 'i2' }), inv({ id: 'i3', revoked_at: 'x' }), inv({ id: 'i4', request_id: 'r2' })];
		const bids = [bid(), bid({ version: 2 }), bid({ invitation_id: 'i2', status: 'withdrawn' }), bid({ invitation_id: 'i4', request_id: 'r2' })];
		const counts = requestCounts(invitations, bids, NOW);
		expect(counts.get('r1')).toEqual({ invited: 2, submitted: 1 });
		expect(counts.get('r2')).toEqual({ invited: 1, submitted: 1 });
		expect(counts.get('r3')).toBeUndefined();
	});
});

describe('validateVendor', () => {
	it('needs a name and an email the database takes, each message naming its field', () => {
		expect(validateVendor({ name: ' ', email: '' })).toEqual({ name: 'Name the vendor.', email: 'Write the contact email.' });
		expect(validateVendor({ name: 'Vendor A', email: 'bids@vendor-a.test' })).toEqual({});
		expect(validateVendor({ name: 'A', email: 'a b@c.d' }).email).toBe('The contact email is not an address. Write it as name@studio.com.');
		expect(validateVendor({ name: 'A', email: 'x' }).email).toBe('The contact email is not an address. Write it as name@studio.com.');
	});

	it('lists the vendor form’s required fields', () => {
		expect(VENDOR_REQUIRED).toEqual(['name', 'email']);
	});
});

describe('vendorLink', () => {
	it('puts the token in the vendor path of this app', () => {
		expect(vendorLink('https://bids.example.com/', 'tok')).toBe('https://bids.example.com/v/tok');
	});
});
