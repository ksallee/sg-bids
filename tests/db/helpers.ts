/**
 * What the database tests share: a superuser connection, PostgREST clients signed as each
 * Supabase role, the store on the service role, and a few builders.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import type { ProductionPrincipal } from '$lib/pure/access';
import type { InvitedVendor, RequestAsset, RequestHeader, RequestShot } from '$lib/pure/model';
import type { BidDraft } from '$lib/pure/rows';
import { createStore, type StoreOptions } from '$lib/server/store';

function need(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set. Run the database tests with \`pnpm test:db\`.`);
	return value;
}

export const DATABASE_URL = () => need('TEST_DATABASE_URL');
export const REST_URL = () => need('TEST_REST_URL');

export const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);

/** The migration files in the order they apply. */
export function migrations(): { name: string; sql: string }[] {
	return readdirSync(MIGRATIONS)
		.filter((name) => name.endsWith('.sql'))
		.sort()
		.map((name) => ({ name, sql: readFileSync(new URL(name, MIGRATIONS), 'utf8') }));
}

export function superuser() {
	return postgres(DATABASE_URL(), { max: 2, onnotice: () => {} });
}

export type Role = 'anon' | 'authenticated' | 'service_role';

/** An HS256 JWT for a Supabase role, signed with this run's secret, as Supabase signs its keys. */
export function jwt(role: Role): string {
	const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
	const now = Math.floor(Date.now() / 1000);
	const body = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ iss: 'supabase', role, iat: now, exp: now + 3600 })}`;
	return `${body}.${createHmac('sha256', need('TEST_JWT_SECRET')).update(body).digest('base64url')}`;
}

/** supabase-js against the bare PostgREST, which serves at `/` rather than `/rest/v1/`. */
export function rest(role: Role): SupabaseClient {
	const fetcher: typeof fetch = (input, init) => fetch(String(input instanceof Request ? input.url : input).replace('/rest/v1/', '/'), init);
	return createClient(REST_URL(), jwt(role), {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		global: { fetch: fetcher }
	});
}

export function store(options: StoreOptions = {}) {
	return createStore(rest('service_role'), options);
}

/** A tenant no other test uses. */
export function tenant(host = `site-${randomUUID().slice(0, 8)}.example.com`, projectId = 1000 + Math.floor(Math.random() * 1_000_000)): ProductionPrincipal {
	return { kind: 'production', siteHost: host, projectId };
}

export function header(extra: Partial<RequestHeader> = {}): RequestHeader {
	return { project: 'Show', round: 1, baseCurrency: 'USD', assumptions: ['4K'], dueDate: '2026-12-15', ...extra };
}

export function items(): { shots: RequestShot[]; assets: RequestAsset[] } {
	return {
		shots: [
			{ id: 'sh010', code: 'SH010', fpt: { type: 'Shot', id: 1234 }, omitted: false, assetIds: ['hero'], frames: 96 },
			{ id: 'sh020', code: 'SH020', omitted: false, assetIds: [] }
		],
		assets: [{ id: 'hero', name: 'Hero', fpt: { type: 'Asset', id: 55 } }]
	};
}

export function vendor(name: string): Omit<InvitedVendor, 'id'> {
	return { name, email: `${name.toLowerCase().replace(/\W/g, '')}@example.com`, ndaExecuted: true, fpt: { type: 'Group', id: 7 } };
}

export function draft(total: number, extra: Partial<BidDraft> = {}): BidDraft {
	return {
		number: 'Q-1',
		date: '2026-11-21',
		currency: 'USD',
		rate: null,
		assumptions: [],
		exclusions: [],
		milestones: [],
		lines: [
			{ target: { kind: 'shot', id: 'sh010' }, total: { minor: total, currency: 'USD' }, excluded: false, notes: 'two layers' },
			{ target: { kind: 'shot', id: 'sh020' }, total: { minor: 0, currency: 'USD' }, excluded: true },
			{ target: { kind: 'asset', id: 'hero' }, total: { minor: total * 2, currency: 'USD' }, excluded: false }
		],
		costs: [],
		discount: null,
		tax: null,
		rebate: [],
		...extra
	};
}

/** The same draft in another currency: every amount in it. */
export function draftIn(currency: string, total: number, extra: Partial<BidDraft> = {}): BidDraft {
	const base = draft(total, extra);
	return { ...base, currency, lines: base.lines.map((line) => ({ ...line, total: { minor: line.total.minor, currency } })), ...extra };
}

/** An issued request in a fresh tenant with two vendors invited. */
export async function issuedWithTwoVendors(options: StoreOptions = {}) {
	const s = store(options);
	const production = tenant();
	const request = await s.createDraftRequest(production, { code: 'BR-1', header: header(), items: items() });
	const a = await s.inviteVendor(production, request.id, vendor('Vendor A'));
	const b = await s.inviteVendor(production, request.id, vendor('Vendor B'));
	await s.issueRequest(production, request.id);
	return { s, production, request, a, b };
}

/** Runs `fn`, expecting a refusal; answers it. */
export async function refusal(fn: () => unknown): Promise<Error & { status?: number; code?: string }> {
	try {
		await fn();
	} catch (error) {
		return error as Error & { status?: number };
	}
	throw new Error('expected a refusal');
}
