/**
 * The vendor routes' HTTP side: the link cookie, the answer headers, the failure count.
 *
 * The token comes in the URL once (`/v/<token>`). That route puts it in a cookie, HttpOnly, Secure
 * (SvelteKit leaves Secure off on http://localhost only), SameSite=Lax, scoped to `/v`, and
 * redirects to `/v`, so the token is not left in the address bar, the history or a referrer.
 * Every vendor answer says `Referrer-Policy: no-referrer` and `Cache-Control: no-store`
 * (`hooks.server.ts`).
 *
 * Lookups that fail are counted per client address, in this instance only (`rate-limit.ts`).
 */

import { json, type Cookies, type RequestEvent, type RequestHandler } from '@sveltejs/kit';
import { createLimiter } from '$lib/pure/rate-limit';
import { StoreError } from './errors';
import { serverStore } from './env';
import type { Store } from './store';

export const VENDOR_COOKIE = 'sg_bids_vendor';
export const VENDOR_PATH = '/v';
/** The cookie outlives no invitation: they last 60 days unless production says otherwise. */
const COOKIE_DAYS = 60;

export const VENDOR_HEADERS: Readonly<Record<string, string>> = {
	'Referrer-Policy': 'no-referrer',
	'Cache-Control': 'no-store',
	'X-Robots-Tag': 'noindex, nofollow'
};

/** Twenty failed lookups per address in ten minutes, then a refusal for the rest of the window. */
export const lookups = createLimiter({ limit: 20, windowMs: 10 * 60_000 });

export function setVendorCookie(cookies: Cookies, token: string): void {
	cookies.set(VENDOR_COOKIE, token, { path: VENDOR_PATH, httpOnly: true, sameSite: 'lax', maxAge: COOKIE_DAYS * 86_400 });
}

export function clearVendorCookie(cookies: Cookies): void {
	cookies.delete(VENDOR_COOKIE, { path: VENDOR_PATH });
}

function address(event: Pick<RequestEvent, 'getClientAddress'>): string {
	try {
		return event.getClientAddress();
	} catch {
		return 'unknown';
	}
}

type Action = (store: Store, token: unknown, body: unknown) => Promise<unknown>;

/** A vendor endpoint: the token from the cookie, the body as JSON for a write, every refusal as `{error}`. */
export function vendorEndpoint(action: Action): RequestHandler {
	return async (event) => {
		const who = address(event);
		const now = Date.now();
		if (lookups.blocked(who, now)) return json({ error: 'Too many tries. Wait a few minutes.' }, { status: 429, headers: VENDOR_HEADERS });
		const token = event.cookies.get(VENDOR_COOKIE);
		if (!token) return json({ error: 'Open the link from your invitation.' }, { status: 401, headers: VENDOR_HEADERS });
		let body: unknown = null;
		if (event.request.method !== 'GET') {
			if (!(event.request.headers.get('content-type') ?? '').startsWith('application/json')) {
				return json({ error: 'Send JSON.' }, { status: 415, headers: VENDOR_HEADERS });
			}
			body = await event.request.json().catch(() => null);
		}
		try {
			return json(await action(serverStore(), token, body), { headers: VENDOR_HEADERS });
		} catch (error) {
			if (error instanceof StoreError) {
				if (error.status === 401) lookups.fail(who, now);
				return json({ error: error.message }, { status: error.status, headers: VENDOR_HEADERS });
			}
			console.error(error);
			return json({ error: 'Something failed on our side. Try again.' }, { status: 500, headers: VENDOR_HEADERS });
		}
	};
}
