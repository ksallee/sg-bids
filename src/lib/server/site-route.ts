/**
 * The frame of a production endpoint across a site, beside `production-route.ts`: read the JSON
 * body, verify its `claim` (site and credential, no project) with the site, run the action with
 * the verified projects, answer JSON. Only `claim.siteUrl`, `claim.sessionToken` and
 * `claim.bearer` are read; a project or a list of projects in the body is never passed on.
 */

import { json } from '@sveltejs/kit';
import type { SitePrincipal } from '$lib/pure/access';
import type { ProjectRow } from '$lib/pure/fpt-session';
import { StoreError } from './errors';
import type { SiteClaim, VerifiedSite } from './production';
import type { SiteRequestOverview } from './requests';

export function siteRoute(verify: (claim: SiteClaim) => Promise<VerifiedSite>, action: (site: VerifiedSite) => Promise<unknown>) {
	return async (event: { request: Request }): Promise<Response> => {
		try {
			const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
			if (!body || typeof body !== 'object') throw new StoreError(400, 'Send a JSON body.');
			const claim = (body.claim ?? {}) as Record<string, unknown>;
			const site = await verify({ siteUrl: claim.siteUrl, sessionToken: claim.sessionToken, bearer: claim.bearer });
			return json(await action(site));
		} catch (error) {
			if (error instanceof StoreError) return json({ message: error.message }, { status: error.status });
			console.error(error);
			return json({ message: 'The server failed.' }, { status: 500 });
		}
	};
}

export interface RequestsAcross {
	/** The projects that hold a listed request, with their names, in the site's order. */
	readonly projects: readonly ProjectRow[];
	readonly requests: readonly SiteRequestOverview[];
}

/** The requests list across the site: the store reads only the verified projects of the verified site. */
export function listRequestsAcross(list: (principal: SitePrincipal) => Promise<SiteRequestOverview[]>) {
	return async (site: VerifiedSite): Promise<RequestsAcross> => {
		const requests = await list({ kind: 'production-site', siteHost: site.siteHost, projectIds: site.projectIds });
		const used = new Set(requests.map((r) => r.projectId));
		return { projects: site.projects.filter((p) => used.has(p.id)), requests };
	};
}
