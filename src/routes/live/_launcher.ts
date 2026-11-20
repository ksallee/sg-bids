/**
 * Shared bits of the two launcher endpoints. Neither holds state.
 *
 * `/api/v1` answers an OPTIONS preflight with the request origin echoed and
 * credentials allowed, so the browser calls the REST API itself. The App
 * Session Launcher lives outside `/api/v1` and answers no CORS headers at all
 * (probe 062), so its two calls are the only ones that need this server.
 */
import { json } from '@sveltejs/kit';
import { siteOrigin } from '$lib/pure/fpt-session';
import { fptSiteHosts } from '$lib/server/env';

/** The one path either endpoint appends to the site a caller names. */
export const launcherBase = '/internal_api/app_session_request';

export function badRequest(message: string): Response {
	return json({ message }, { status: 400 });
}

export function forwardFailed(error: unknown): Response {
	return json({ message: error instanceof Error ? error.message : String(error) }, { status: 502 });
}

/**
 * The site root to forward to, or the answer to give instead. The endpoints take no sign-in, so
 * the site must be on the same allowlist the production check uses (`FPT_SITE_HOSTS`): https, the
 * default port, an allowed host. Anything else is 403 and nothing is called.
 */
export function siteFromBody(value: unknown): string | Response {
	if (typeof value !== 'string' || value.trim() === '') return badRequest("'siteUrl' is required.");
	const site = siteOrigin(value, fptSiteHosts());
	if (!site) return json({ message: 'This app does not serve that site.' }, { status: 403 });
	return site.origin;
}

/** A call to the site that follows no redirect: a site answers at its own host (129). */
export function forward(url: string, init: RequestInit): Promise<Response> {
	return fetch(url, { ...init, redirect: 'error' });
}

export async function bodyOf(request: Request): Promise<Record<string, unknown> | Response> {
	try {
		const body: unknown = await request.json();
		return (body ?? {}) as Record<string, unknown>;
	} catch {
		return badRequest('Body must be a JSON object.');
	}
}
