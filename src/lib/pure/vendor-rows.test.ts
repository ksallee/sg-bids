import { describe, expect, it } from 'vitest';
import type { InvitedVendor } from './model';
import type { DraftBid } from './request-draft';
import { bidsLabel, blankVendor, fromInvited, isBlank, rowProblems, savedVendors, setBids, toggleBid, withoutBid, type VendorRow } from './vendor-rows';

const bids: DraftBid[] = [
	{ key: 'bid:a', name: 'Bid 1' },
	{ key: 'bid:b', name: 'Hero' },
	{ key: 'bid:c', name: 'Environments' }
];

const row = (extra: Partial<VendorRow> = {}): VendorRow => ({ ...blankVendor('v1'), name: 'Studio A', email: 'bids@a.com', ...extra });

describe('a vendor row', () => {
	it('starts blank, invited to every bid', () => {
		expect(blankVendor('v1')).toEqual({ id: 'v1', name: '', email: '', group: null, bids: null, linked: false });
		expect(isBlank(blankVendor('v1'))).toBe(true);
		expect(isBlank(row({ name: '', email: ' ', group: { id: 4, name: 'Studio A' } }))).toBe(false);
	});

	it('comes from an invitation, with its Group and its bids', () => {
		const invited: InvitedVendor = { id: 'v9', name: 'Studio B', email: 'b@b.com', ndaExecuted: false, fpt: { type: 'Group', id: 12 }, groupName: 'Studio B', packages: ['bid:b'] };
		expect(fromInvited(invited, true)).toEqual({ id: 'v9', name: 'Studio B', email: 'b@b.com', group: { id: 12, name: 'Studio B' }, bids: ['bid:b'], linked: false });
		expect(fromInvited({ ...invited, groupName: undefined, packages: undefined }, false).group).toEqual({ id: 12, name: 'Group 12' });
		expect(fromInvited(invited, false).linked).toBe(true);
	});

	it('names what it is missing, field by field', () => {
		expect(rowProblems(row())).toEqual({});
		expect(rowProblems(row({ name: ' ', email: '' }))).toEqual({ name: 'Give the vendor a name.', email: 'Write the vendor’s email.' });
		expect(rowProblems(row({ email: 'bids at a.com' }))).toEqual({ email: 'This email is not an address. Write it as name@studio.com.' });
	});

	it('saves only when something is typed in it', () => {
		expect(savedVendors([blankVendor('v0'), row()])).toEqual([row()]);
	});
});

describe('the bids a vendor answers', () => {
	it('reads Every bid, the one bid, or the names', () => {
		expect(bidsLabel(row(), bids)).toBe('Every bid');
		expect(bidsLabel(row({ bids: ['bid:b'] }), bids)).toBe('Hero');
		expect(bidsLabel(row({ bids: ['bid:c', 'bid:a'] }), bids)).toBe('Bid 1, Environments');
		expect(bidsLabel(row(), [bids[0]])).toBe('Bid 1');
	});

	it('toggles one bid, every one picked reads as every bid, and the last one stays', () => {
		const one = toggleBid(row(), 'bid:b', bids);
		expect(one.bids).toEqual(['bid:a', 'bid:c']);
		expect(toggleBid(one, 'bid:b', bids).bids).toBeNull();
		const last = row({ bids: ['bid:a'] });
		expect(toggleBid(last, 'bid:a', bids)).toBe(last);
	});

	it('sets a list: empty or every bid reads as every bid', () => {
		expect(setBids(row(), [], bids).bids).toBeNull();
		expect(setBids(row(), ['bid:c', 'bid:b', 'bid:a'], bids).bids).toBeNull();
		expect(setBids(row(), ['bid:c', 'bid:a'], bids).bids).toEqual(['bid:a', 'bid:c']);
	});

	it('loses a bid that goes; left with none, every bid', () => {
		const rows = [row({ bids: ['bid:a', 'bid:b'] }), row({ id: 'v2', bids: ['bid:b'] }), row({ id: 'v3' })];
		expect(withoutBid(rows, 'bid:b').map((r) => r.bids)).toEqual([['bid:a'], null, null]);
	});
});
