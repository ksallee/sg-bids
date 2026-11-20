/**
 * The vendor's own moves on its bid: a currency of its own with no rate, withdrawal, versions.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { draft, issuedWithTwoVendors, refusal, superuser } from './helpers';

const sql = superuser();

afterAll(async () => {
	await sql.end();
});

function inEur(total: number) {
	const usd = draft(total);
	return {
		...usd,
		currency: 'EUR',
		lines: usd.lines.map((l) => ({ ...l, total: { minor: l.total.minor, currency: 'EUR' } }))
	};
}

describe('a vendor bid in its own currency', () => {
	it('saves and submits with no rate: production locks one', async () => {
		const { s, a } = await issuedWithTwoVendors();
		const saved = await s.saveDraftBid(a.token, inEur(50_000));
		expect(saved.currency).toBe('EUR');
		expect(saved.rate).toBeNull();
		const submitted = await s.submitBid(a.token, saved.id);
		expect(submitted.status).toBe('submitted');
		const [row] = await sql`select currency, exchange_rate, exchange_rate_date from public.bids where id = ${saved.id}`;
		expect(row).toEqual({ currency: 'EUR', exchange_rate: null, exchange_rate_date: null });
	});

	it('drops a rate the vendor sends', async () => {
		const { s, a } = await issuedWithTwoVendors();
		const saved = await s.saveDraftBid(a.token, { ...inEur(1), rate: { from: 'EUR', to: 'USD', rate: '9.99', date: '2026-11-20' } });
		expect(saved.rate).toBeNull();
		const [row] = await sql`select exchange_rate from public.bids where id = ${saved.id}`;
		expect(row.exchange_rate).toBeNull();
	});

	it('still refuses an amount in another currency than the bid’s', async () => {
		const { s, a } = await issuedWithTwoVendors();
		const mixed = { ...inEur(1), costs: [{ kind: 'overhead' as const, label: 'Overhead', amount: { minor: 5, currency: 'USD' }, labour: false }] };
		expect((await refusal(() => s.saveDraftBid(a.token, mixed))).status).toBe(422);
	});
});

describe('withdrawBid', () => {
	it('withdraws a submitted bid, once, and a new version may follow', async () => {
		const { s, a } = await issuedWithTwoVendors();
		const saved = await s.saveDraftBid(a.token, draft(100));
		expect((await refusal(() => s.withdrawBid(a.token, saved.id))).status).toBe(409);
		await s.submitBid(a.token, saved.id);
		const withdrawn = await s.withdrawBid(a.token, saved.id);
		expect(withdrawn.status).toBe('withdrawn');
		expect((await refusal(() => s.withdrawBid(a.token, saved.id))).status).toBe(409);
		const next = await s.saveDraftBid(a.token, draft(90));
		expect(next.id).not.toBe(saved.id);
	});

	it('cannot reach the other vendor’s bid', async () => {
		const { s, a, b } = await issuedWithTwoVendors();
		const bidB = await s.saveDraftBid(b.token, draft(100));
		await s.submitBid(b.token, bidB.id);
		expect((await refusal(() => s.withdrawBid(a.token, bidB.id))).status).toBe(404);
		const [row] = await sql`select status from public.bids where id = ${bidB.id}`;
		expect(row.status).toBe('submitted');
	});
});

describe('vendorBidRecords', () => {
	it('lists the vendor’s own versions with their stamps, oldest first', async () => {
		const { s, a, b } = await issuedWithTwoVendors();
		const first = await s.saveDraftBid(a.token, draft(100));
		await s.submitBid(a.token, first.id);
		const second = await s.saveDraftBid(a.token, draft(90));
		await s.saveDraftBid(b.token, draft(80));
		const records = await s.vendorBidRecords(a.token);
		expect(records.map((r) => [r.bid.id, r.version, r.bid.status])).toEqual([
			[first.id, 1, 'submitted'],
			[second.id, 2, 'draft']
		]);
		expect(records[0].submittedAt).not.toBeNull();
		expect(records[1].submittedAt).toBeNull();
	});
});

describe('openInvitation', () => {
	it('says the request’s code and status and when the link ends', async () => {
		const { s, a } = await issuedWithTwoVendors();
		const view = await s.openInvitation(a.token);
		expect(view.code).toBe('BR-1');
		expect(view.status).toBe('issued');
		expect(view.issuedAt).not.toBeNull();
		expect(view.expiresAt).toBe(a.expiresAt);
	});
});
