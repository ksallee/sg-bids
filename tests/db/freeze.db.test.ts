/**
 * The freezes hold in the database itself, against the secret key and in SQL: a submitted bid and
 * its lines, and an issued request's items and header, cannot be updated or deleted.
 */
import type postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { draft, header, issuedWithTwoVendors, items, refusal, rest, store, superuser, tenant } from './helpers';

const sql = superuser();

afterAll(async () => {
	await sql.end();
});

/** Runs a statement as the service role, the role the server's key acts as. */
async function asService(statement: (tx: postgres.TransactionSql) => Promise<unknown>): Promise<unknown> {
	return sql.begin(async (tx) => {
		await tx`set local role service_role`;
		return statement(tx);
	});
}


async function submitted() {
	const fixture = await issuedWithTwoVendors();
	const bid = await fixture.s.saveDraftBid(fixture.a.token, draft(100_000));
	await fixture.s.submitBid(fixture.a.token, bid.id);
	const [line] = await sql`select id from public.bid_lines where bid_id = ${bid.id} and item_key = 'sh010'`;
	return { ...fixture, bid, lineId: line.id as string };
}

describe('a submitted bid', () => {
	it('cannot be updated or deleted, in SQL', async () => {
		const { bid } = await submitted();
		const before = await sql`select * from public.bids where id = ${bid.id}`;
		for (const statement of [
			(tx: postgres.TransactionSql) => tx`update public.bids set currency = 'EUR' where id = ${bid.id}`,
			(tx: postgres.TransactionSql) => tx`update public.bids set header = '{}' where id = ${bid.id}`,
			(tx: postgres.TransactionSql) => tx`update public.bids set status = 'draft', submitted_at = null where id = ${bid.id}`,
			(tx: postgres.TransactionSql) => tx`delete from public.bids where id = ${bid.id}`
		]) {
			const error = await refusal(() => asService(statement));
			expect(error.message).toMatch(/submitted bid/);
		}
		expect(await sql`select * from public.bids where id = ${bid.id}`).toEqual(before);
	});

	it('cannot be updated or deleted through PostgREST with the secret key', async () => {
		const { bid } = await submitted();
		const db = rest('service_role');
		const updated = await db.from('bids').update({ currency: 'EUR' }).eq('id', bid.id).select();
		expect(updated.error?.code).toBe('P0001');
		const deleted = await db.from('bids').delete().eq('id', bid.id).select();
		expect(deleted.error?.code).toBe('P0001');
		const [row] = await sql`select currency from public.bids where id = ${bid.id}`;
		expect(row.currency).toBe('USD');
	});

	it('keeps its lines: no update, delete or insert', async () => {
		const { bid, lineId, request } = await submitted();
		const before = await sql`select * from public.bid_lines where bid_id = ${bid.id} order by id`;
		const [{ invitation_id, site_host, project_id }] = await sql`select invitation_id, site_host, project_id from public.bids where id = ${bid.id}`;
		for (const statement of [
			(tx: postgres.TransactionSql) => tx`update public.bid_lines set total_minor = 1 where id = ${lineId}`,
			(tx: postgres.TransactionSql) => tx`delete from public.bid_lines where id = ${lineId}`,
			(tx: postgres.TransactionSql) => tx`insert into public.bid_lines (bid_id, invitation_id, request_id, site_host, project_id, item_kind, item_key, total_minor)
				values (${bid.id}, ${invitation_id}, ${request.id}, ${site_host}, ${project_id}, 'shot', 'sh010', 5)`
		]) {
			const error = await refusal(() => asService(statement));
			expect(error.message).toMatch(/submitted bid/);
		}
		expect(await sql`select * from public.bid_lines where bid_id = ${bid.id} order by id`).toEqual(before);
	});

	it('changes only by a new version, and may be withdrawn, once', async () => {
		const { s, a, bid } = await submitted();
		const next = await s.saveDraftBid(a.token, draft(90_000));
		expect(next.id).not.toBe(bid.id);

		await asService((tx) => tx`update public.bids set status = 'withdrawn' where id = ${bid.id}`);
		const [row] = await sql`select status, withdrawn_at from public.bids where id = ${bid.id}`;
		expect(row.status).toBe('withdrawn');
		expect(row.withdrawn_at).not.toBeNull();

		const again = await refusal(() => asService((tx) => tx`update public.bids set status = 'submitted' where id = ${bid.id}`));
		expect(again.message).toMatch(/submitted bid/);
		const withdrawAndEdit = await refusal(() => asService((tx) => tx`update public.bids set status = 'withdrawn', currency = 'EUR' where id = ${next.id}`));
		expect(withdrawAndEdit.message).toMatch(/Only a submitted bid/);
	});

	it('is refused by the store when submitted twice', async () => {
		const { s, a, bid } = await submitted();
		expect((await refusal(() => s.submitBid(a.token, bid.id))).status).toBe(409);
	});
});

describe('an issued request', () => {
	it('keeps its items: no update, delete or insert', async () => {
		const { request, production } = await issuedWithTwoVendors();
		const before = await sql`select * from public.request_items where request_id = ${request.id} order by position`;
		for (const statement of [
			(tx: postgres.TransactionSql) => tx`update public.request_items set code = 'X' where request_id = ${request.id}`,
			(tx: postgres.TransactionSql) => tx`update public.request_items set omitted = true where request_id = ${request.id}`,
			(tx: postgres.TransactionSql) => tx`delete from public.request_items where request_id = ${request.id}`,
			(tx: postgres.TransactionSql) => tx`insert into public.request_items (request_id, site_host, project_id, kind, key, code)
				values (${request.id}, ${production.siteHost}, ${production.projectId}, 'shot', 'sh999', 'SH999')`
		]) {
			const error = await refusal(() => asService(statement));
			expect(error.message).toMatch(/issued request are frozen/);
		}
		expect(await sql`select * from public.request_items where request_id = ${request.id} order by position`).toEqual(before);
	});

	it('refuses new items and edits through the store', async () => {
		const { s, request, production } = await issuedWithTwoVendors();
		expect((await refusal(() => s.updateDraftRequest(production, request.id, { items: items() }))).status).toBe(404);
		expect((await refusal(() => s.updateDraftRequest(production, request.id, { header: header({ title: 'New' }) }))).status).toBe(404);
	});

	it('keeps its code, round, currency and header, cannot go back to draft or be deleted', async () => {
		const { request } = await issuedWithTwoVendors();
		const before = await sql`select * from public.bid_requests where id = ${request.id}`;
		for (const statement of [
			(tx: postgres.TransactionSql) => tx`update public.bid_requests set header = '{"project":"Other"}' where id = ${request.id}`,
			(tx: postgres.TransactionSql) => tx`update public.bid_requests set base_currency = 'EUR' where id = ${request.id}`,
			(tx: postgres.TransactionSql) => tx`update public.bid_requests set round = 9 where id = ${request.id}`,
			(tx: postgres.TransactionSql) => tx`update public.bid_requests set code = 'X' where id = ${request.id}`,
			(tx: postgres.TransactionSql) => tx`update public.bid_requests set status = 'draft', issued_at = null where id = ${request.id}`,
			(tx: postgres.TransactionSql) => tx`delete from public.bid_requests where id = ${request.id}`
		]) {
			await refusal(() => asService(statement));
		}
		expect(await sql`select * from public.bid_requests where id = ${request.id}`).toEqual(before);
	});

	it('moves its due day and closes; closed, it takes no bid and stays closed', async () => {
		const { s, a, request } = await issuedWithTwoVendors();
		await asService((tx) => tx`update public.bid_requests set due_on = '2027-01-10' where id = ${request.id}`);
		await asService((tx) => tx`update public.bid_requests set status = 'closed' where id = ${request.id}`);
		const [row] = await sql`select status, closed_at, due_on from public.bid_requests where id = ${request.id}`;
		expect(row.status).toBe('closed');
		expect(row.closed_at).not.toBeNull();
		expect((await refusal(() => s.saveDraftBid(a.token, draft(1)))).status).toBe(409);
		const reopen = await refusal(() => asService((tx) => tx`update public.bid_requests set status = 'issued' where id = ${request.id}`));
		expect(reopen.message).toMatch(/stays closed/);
	});

	it('changes only by a new round', async () => {
		const { s, production } = await issuedWithTwoVendors();
		const next = await s.createDraftRequest(production, { code: 'BR-1', header: header({ round: 2 }), items: items() });
		expect(next.header.round).toBe(2);
		const duplicate = await refusal(() => s.createDraftRequest(production, { code: 'BR-1', header: header({ round: 2 }) }));
		expect(duplicate.status).toBe(409);
	});

	it('needs a shot or an asset to be issued', async () => {
		const s = store();
		const production = tenant();
		const empty = await s.createDraftRequest(production, { code: 'EMPTY', header: header() });
		expect((await refusal(() => s.issueRequest(production, empty.id))).status).toBe(409);
	});
});
