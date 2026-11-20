/**
 * The server's wiring from its env: the Supabase client with the secret key, and the production
 * check with the site allowlist. Server only: `$lib/server` never reaches the browser.
 *
 * `SUPABASE_URL` and `SUPABASE_SECRET_KEY` name the project. `FPT_SITE_HOSTS` lists the Flow PT
 * hosts this deployment serves, comma separated, exact hosts or a suffix written `*.<domain>`
 * (`fpt-session.ts`); unset, it is the host of `PUBLIC_FPT_SITE_URL`; neither set, nobody.
 * `FPT_PRODUCTION_ROLES` lists the permission group codes that may act as production, comma
 * separated; unset, `admin,manager`.
 */

import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { allowedHosts, productionRoles } from '$lib/pure/fpt-session';
import { StoreError } from './errors';
import { verifyProduction, type ProductionClaim, type VerifiedProduction } from './production';
import { createStore, type Store } from './store';

let client: SupabaseClient | null = null;
let store: Store | null = null;

export function database(): SupabaseClient {
	if (client) return client;
	const url = env.SUPABASE_URL;
	const key = env.SUPABASE_SECRET_KEY;
	if (!url || !key) throw new StoreError(500, 'The database is not configured.');
	client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
	return client;
}

export function serverStore(): Store {
	store ??= createStore(database());
	return store;
}

/** The Flow PT hosts the server may call: the production check and the sign-in launcher alike. */
export function fptSiteHosts(): string[] {
	return allowedHosts(env.FPT_SITE_HOSTS, publicEnv.PUBLIC_FPT_SITE_URL);
}

export function verifyProductionClaim(claim: ProductionClaim): Promise<VerifiedProduction> {
	return verifyProduction(claim, {
		fetch,
		allowedHosts: fptSiteHosts(),
		allowScript: dev,
		productionRoles: productionRoles(env.FPT_PRODUCTION_ROLES)
	});
}
