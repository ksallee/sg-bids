/**
 * The public keys reach nothing. `anon` and `authenticated` are what Supabase's publishable and
 * anon keys act as; they read and write no row of any table and call no function, through
 * PostgREST (the path a key takes) and in SQL. Row level security alone holds even if a grant
 * comes back.
 */
import type { TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_TABLES } from '$lib/pure/access';
import { createComparison } from '$lib/server/comparison';
import { draft, draftIn, issuedWithTwoVendors, rest, superuser, type Role } from './helpers';

const sql = superuser();
const PUBLIC_ROLES: Role[] = ['anon', 'authenticated'];

/** A row's worth of plausible values per table, for the insert attempts. */
type Table = (typeof ALL_TABLES)[number];
const SAMPLE: Record<Table, Record<string, unknown>> = {
	bid_requests: { site_host: 'x.example.com', project_id: 1, code: 'X', base_currency: 'USD' },
	request_items: { request_id: '00000000-0000-0000-0000-000000000000', site_host: 'x.example.com', project_id: 1, kind: 'shot', key: 'k', code: 'K' },
	request_packages: { request_id: '00000000-0000-0000-0000-000000000000', site_host: 'x.example.com', project_id: 1, key: 'p', name: 'P' },
	invitations: { request_id: '00000000-0000-0000-0000-000000000000', site_host: 'x.example.com', project_id: 1, vendor_name: 'V', contact_email: 'v@example.com', token_hash: 'a'.repeat(64), expires_at: '2099-01-01' },
	bids: { invitation_id: '00000000-0000-0000-0000-000000000000', request_id: '00000000-0000-0000-0000-000000000000', site_host: 'x.example.com', project_id: 1, currency: 'USD' },
	bid_lines: { bid_id: '00000000-0000-0000-0000-000000000000', item_kind: 'shot', item_key: 'k', total_minor: 1 },
	award_scenarios: { request_id: '00000000-0000-0000-0000-000000000000', site_host: 'x.example.com', project_id: 1, name: 'S' },
	award_scenario_items: { scenario_id: '00000000-0000-0000-0000-000000000000', item_kind: 'shot', item_key: 'k', bid_id: '00000000-0000-0000-0000-000000000000', share_percent: '100' },
	awards: { request_id: '00000000-0000-0000-0000-000000000000', item_kind: 'shot', item_key: 'k', bid_line_id: '00000000-0000-0000-0000-000000000000', share_percent: '100' },
	award_publications: { request_id: '00000000-0000-0000-0000-000000000000', site_host: 'x.example.com', project_id: 1, state: 'published', site: {}, written: {}, published_by: {} },
	bid_rates: { bid_id: '00000000-0000-0000-0000-000000000000', request_id: '00000000-0000-0000-0000-000000000000', site_host: 'x.example.com', project_id: 1, rate: '1.2', rate_date: '2026-11-20' },
	withdrawn_links: { token_hash: 'b'.repeat(64) }
};

async function snapshot(): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const table of ALL_TABLES) {
		const rows = await sql.unsafe(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h, count(*)::int as n from public.${table} t`);
		out[table] = `${rows[0].n}:${rows[0].h}`;
	}
	return out;
}

beforeAll(async () => {
	// One of everything, so there is something to fail to read.
	const { s, production, request, a, b } = await issuedWithTwoVendors();
	const bidA = await s.saveDraftBid(a.token, draft(100_000));
	await s.submitBid(a.token, bidA.id);
	await s.saveDraftBid(b.token, draft(90_000));
	await s.saveScenario(production, request.id, { name: 'All A', picks: [{ target: { kind: 'shot', id: 'sh010' }, shares: [{ bidId: bidA.id, percent: '100' }] }] });
	const [line] = await sql`select id from public.bid_lines where bid_id = ${bidA.id} and item_key = 'sh010'`;
	await sql`insert into public.awards (request_id, site_host, project_id, item_kind, item_key, bid_line_id, share_percent)
		values (${request.id}, ${production.siteHost}, ${production.projectId}, 'shot', 'sh010', ${line.id}, '100')`;
	await sql`insert into public.award_publications (request_id, site_host, project_id, state, site, written, published_by)
		values (${request.id}, ${production.siteHost}, ${production.projectId}, 'published', '{}', '{}', '{}')`;
	// A rate, on another request: an award locks the rates of its own.
	const other = await issuedWithTwoVendors();
	const pounds = await other.s.saveDraftBid(other.a.token, draftIn('GBP', 80_000));
	await other.s.submitBid(other.a.token, pounds.id);
	await createComparison(rest('service_role')).setRate(other.production, other.request.id, pounds.id, { rate: '1.27', date: '2026-11-20' });
	// A deleted request, so a withdrawn link is kept.
	const gone = await issuedWithTwoVendors();
	await gone.s.deleteRequest(gone.production, gone.request.id, 'BR-1');
});

afterAll(async () => {
	await sql.end();
});

type Sql = ReturnType<typeof superuser> | TransactionSql;

/**
 * What the catalog says is wrong with `public`, from the catalog alone, not from `ALL_TABLES`: a table
 * that a later migration adds and forgets fails here. Every table (plain or partitioned) has row
 * level security; no table, view, sequence or function is granted to `anon` or `authenticated`.
 */
async function guard(db: Sql): Promise<string[]> {
	const problems: string[] = [];
	const noRls = await db`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
		where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by c.relname`;
	for (const row of noRls) problems.push(`public.${row.relname} has no row level security.`);
	const relations = await db`select c.relname, r.rolname from pg_class c join pg_namespace n on n.oid = c.relnamespace
		cross join pg_roles r
		where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and r.rolname in ('anon', 'authenticated')
			and (case when c.relkind = 'S' then has_sequence_privilege(r.oid, c.oid, 'usage, select, update')
				else has_table_privilege(r.oid, c.oid, 'select, insert, update, delete, truncate, references, trigger') end)
		order by c.relname, r.rolname`;
	for (const row of relations) problems.push(`public.${row.relname} is granted to ${row.rolname}.`);
	const functions = await db`select p.proname, r.rolname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
		cross join pg_roles r
		where n.nspname = 'public' and r.rolname in ('anon', 'authenticated') and has_function_privilege(r.oid, p.oid, 'execute')
		order by p.proname, r.rolname`;
	for (const row of functions) problems.push(`public.${row.proname}() is executable by ${row.rolname}.`);
	return problems;
}

describe('the schema', () => {
	it('has row level security on every table and not one policy', async () => {
		const tables = await sql`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
			where n.nspname = 'public' and c.relkind = 'r' order by c.relname`;
		expect(tables.map((t) => t.relname)).toEqual([...ALL_TABLES].sort());
		expect(tables.every((t) => t.relrowsecurity)).toBe(true);
		const policies = await sql`select policyname from pg_policies where schemaname = 'public'`;
		expect(policies).toHaveLength(0);
	});

	it('grants the public roles no table and no function', async () => {
		const tables = await sql`select table_name, grantee, privilege_type from information_schema.role_table_grants
			where table_schema = 'public' and grantee in ('anon', 'authenticated')`;
		expect(tables).toHaveLength(0);
		const functions = await sql`select p.proname, r.rolname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			cross join pg_roles r
			where n.nspname = 'public' and r.rolname in ('anon', 'authenticated') and has_function_privilege(r.oid, p.oid, 'execute')`;
		expect(functions).toHaveLength(0);
	});

	it('passes the guard: every relation in public has row level security and no public grant', async () => {
		expect(await guard(sql)).toEqual([]);
		// The guard reads the catalog, so it covers every table there, bid_rates included.
		const seen = (await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
			where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity`).map((r) => r.relname);
		for (const table of ALL_TABLES) expect(seen, table).toContain(table);
		expect(seen).toContain('bid_rates');
	});

	it('gives a table or function added later nothing for the public roles, and the guard catches one without row level security', async () => {
		await sql
			.begin(async (tx) => {
				// As a later migration would: created by the migration role, no grant, no revoke, no RLS.
				await tx.unsafe('create table public.sg_guard_probe (id integer)');
				await tx.unsafe('create function public.sg_guard_probe_fn() returns integer language sql as $$ select 1 $$');
				const granted = await tx`select r.rolname,
						has_table_privilege(r.oid, 'public.sg_guard_probe', 'select, insert, update, delete') as tbl,
						has_function_privilege(r.oid, 'public.sg_guard_probe_fn()', 'execute') as fn
					from pg_roles r where r.rolname in ('anon', 'authenticated')`;
				for (const row of granted) {
					expect(row.tbl, `${row.rolname} on the table`).toBe(false);
					expect(row.fn, `${row.rolname} on the function`).toBe(false);
				}
				expect(await guard(tx)).toEqual(['public.sg_guard_probe has no row level security.']);
				throw new Error('roll back');
			})
			.catch((error: Error) => {
				if (error.message !== 'roll back') throw error;
			});
	});

	it('every table has rows to protect', async () => {
		for (const table of ALL_TABLES) {
			const [{ n }] = await sql.unsafe(`select count(*)::int as n from public.${table}`);
			expect(n, table).toBeGreaterThan(0);
		}
	});
});

describe.each(PUBLIC_ROLES)('through PostgREST as %s', (role) => {
	const client = rest(role);

	it('reads nothing from any table', async () => {
		for (const table of ALL_TABLES) {
			const { data, error } = await client.from(table).select('*');
			expect(error !== null || (Array.isArray(data) && data.length === 0), table).toBe(true);
		}
	});

	it('inserts, updates and deletes nothing in any table', async () => {
		const before = await snapshot();
		for (const table of ALL_TABLES) {
			const inserted = await client.from(table).insert(SAMPLE[table]).select();
			expect(inserted.error, `insert ${table}`).not.toBeNull();
			const updated = await client.from(table).update({ id: '00000000-0000-0000-0000-000000000001' }).not('id', 'is', null).select();
			expect(updated.error !== null || updated.data?.length === 0, `update ${table}`).toBe(true);
			const deleted = await client.from(table).delete().not('id', 'is', null).select();
			expect(deleted.error !== null || deleted.data?.length === 0, `delete ${table}`).toBe(true);
		}
		expect(await snapshot()).toEqual(before);
	});

	it('calls no function', async () => {
		const before = await snapshot();
		const calls = [
			client.rpc('sg_save_request_items', { p_request_id: '00000000-0000-0000-0000-000000000000', p_site_host: 'x', p_project_id: 1, p_items: [] }),
			client.rpc('sg_save_bid_draft', { p_invitation_id: '00000000-0000-0000-0000-000000000000', p_bid: {}, p_lines: [] }),
			client.rpc('sg_save_scenario', {
				p_request_id: '00000000-0000-0000-0000-000000000000',
				p_site_host: 'x',
				p_project_id: 1,
				p_scenario_id: null,
				p_name: 'x',
				p_items: []
			}),
			client.rpc('sg_set_bid_rate', {
				p_request_id: '00000000-0000-0000-0000-000000000000',
				p_site_host: 'x',
				p_project_id: 1,
				p_bid_id: '00000000-0000-0000-0000-000000000000',
				p_rate: '1',
				p_rate_date: '2026-11-20'
			}),
			client.rpc('sg_save_award_scenario', {
				p_request_id: '00000000-0000-0000-0000-000000000000',
				p_site_host: 'x',
				p_project_id: 1,
				p_scenario_id: null,
				p_name: 'x',
				p_items: [],
				p_costs_left_out: []
			}),
			client.rpc('sg_choose_scenario', { p_request_id: '00000000-0000-0000-0000-000000000000', p_site_host: 'x', p_project_id: 1, p_scenario_id: null }),
			client.rpc('sg_delete_request', { p_request_id: '00000000-0000-0000-0000-000000000000', p_site_host: 'x', p_project_id: 1 })
		];
		for (const call of await Promise.all(calls)) expect(call.error).not.toBeNull();
		expect(await snapshot()).toEqual(before);
	});
});

describe('row level security alone', () => {
	it.each(PUBLIC_ROLES)('stops %s even with every grant given back', async (role) => {
		const before = await snapshot();
		await sql
			.begin(async (tx) => {
				await tx.unsafe(`grant select, insert, update, delete on all tables in schema public to ${role}`);
				await tx.unsafe(`set local role ${role}`);
				for (const table of ALL_TABLES) {
					const [{ n }] = await tx.unsafe(`select count(*)::int as n from public.${table}`);
					expect(n, table).toBe(0);
					const updated = await tx.unsafe(`update public.${table} set id = id`);
					expect(updated.count, table).toBe(0);
					const deleted = await tx.unsafe(`delete from public.${table}`);
					expect(deleted.count, table).toBe(0);
				}
				await tx.savepoint(async (sp) => {
					const error = await sp.unsafe(`insert into public.bid_requests (site_host, project_id, code, base_currency) values ('x.example.com', 1, 'X', 'USD')`).then(
						() => null,
						(e: { code?: string }) => e
					);
					expect(error?.code).toBe('42501');
					throw new Error('roll back the savepoint');
				}).catch(() => {});
				throw new Error('roll back');
			})
			.catch((error: Error) => {
				if (error.message !== 'roll back') throw error;
			});
		expect(await snapshot()).toEqual(before);
	});
});
