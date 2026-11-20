/**
 * The vendor routes' HTTP side: the link cookie, the answer headers, the failure count.
 *
 * The token comes in the URL once (`/v/<token>`). That route moves it to a short cookie and
 * redirects to `/v/open` with no lookup. `/v/open` makes it the vendor cookie, HttpOnly, Secure
 * (SvelteKit leaves Secure off on http://localhost only), SameSite=Lax, scoped to `/v`, and
 * redirects to `/v`, so the token is not left in the address bar, the history or a referrer. When
 * the browser holds another vendor's live link, `/v/open` asks first, naming both, and only a
 * same-origin post switches: a link one vendor sends another never takes a browser over quietly.
 * Every vendor answer says `Referrer-Policy: no-referrer` and `Cache-Control: no-store`
 * (`hooks.server.ts`).
 *
 * The cookie holds `<invitation id>.<token>`. The id is the vendor's own and never leaves the
 * HttpOnly cookie. When production gives the vendor a new link, the old token stops working; the
 * id still names the invitation, so the answer says the link was replaced (410) rather than that
 * it never worked (401).
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

export function setVendorCookie(cookies: Cookies, invitationId: string, token: string): void {
	cookies.set(VENDOR_COOKIE, `${invitationId}.${token}`, { path: VENDOR_PATH, httpOnly: true, sameSite: 'lax', maxAge: COOKIE_DAYS * 86_400 });
}

export function clearVendorCookie(cookies: Cookies): void {
	cookies.delete(VENDOR_COOKIE, { path: VENDOR_PATH });
}

/**
 * The link just opened, waiting on `/v/open`: the link route moves the token here and redirects
 * at once. `/v/open` makes it the vendor cookie, or asks first when the browser holds another
 * vendor's live link. Ten minutes, then it is gone.
 */
export const OPENING_COOKIE = 'sg_bids_vendor_open';
const OPENING_SECONDS = 600;

export function setOpeningCookie(cookies: Cookies, token: string): void {
	cookies.set(OPENING_COOKIE, token, { path: VENDOR_PATH, httpOnly: true, sameSite: 'lax', maxAge: OPENING_SECONDS });
}

export function clearOpeningCookie(cookies: Cookies): void {
	cookies.delete(OPENING_COOKIE, { path: VENDOR_PATH });
}

/**
 * A post from this site's own page: the Origin is ours, and Sec-Fetch-Site, when the browser
 * sends it, says same-origin. SvelteKit checks the origin of form posts too; this holds without it.
 */
export function sameOrigin(event: Pick<RequestEvent, 'request' | 'url'>): boolean {
	const site = event.request.headers.get('sec-fetch-site');
	return event.request.headers.get('origin') === event.url.origin && (site === null || site === 'same-origin');
}

/** The cookie's invitation id and token. A cookie with no id is a token alone. */
export function readVendorCookie(value: string | undefined): { invitationId: string | null; token: string } | null {
	if (!value) return null;
	const dot = value.indexOf('.');
	return dot < 0 ? { invitationId: null, token: value } : { invitationId: value.slice(0, dot), token: value.slice(dot + 1) };
}

export const REPLACED = 'This link was replaced. Open the newest link production sent you. Your bid is kept.';

export function address(event: Pick<RequestEvent, 'getClientAddress'>): string {
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
		const cookie = readVendorCookie(event.cookies.get(VENDOR_COOKIE));
		if (!cookie) return json({ error: 'Open the link from your invitation.' }, { status: 401, headers: VENDOR_HEADERS });
		let body: unknown = null;
		if (event.request.method !== 'GET') {
			if (!(event.request.headers.get('content-type') ?? '').startsWith('application/json')) {
				return json({ error: 'Send JSON.' }, { status: 415, headers: VENDOR_HEADERS });
			}
			body = await event.request.json().catch(() => null);
		}
		try {
			return json(await action(serverStore(), cookie.token, body), { headers: VENDOR_HEADERS });
		} catch (error) {
			if (error instanceof StoreError) {
				if (error.status === 401) {
					lookups.fail(who, now);
					if (cookie.invitationId && (await serverStore().invitationExists(cookie.invitationId).catch(() => false))) {
						return json({ error: REPLACED }, { status: 410, headers: VENDOR_HEADERS });
					}
				}
				return json(error.reason ? { error: error.message, reason: error.reason } : { error: error.message }, { status: error.status, headers: VENDOR_HEADERS });
			}
			console.error(error);
			return json({ error: 'Something failed on our side. Try again.' }, { status: 500, headers: VENDOR_HEADERS });
		}
	};
}
