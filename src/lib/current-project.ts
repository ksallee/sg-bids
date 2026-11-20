/**
 * The project a request's pages work in, kept per site in this browser, and the default for a new
 * request. The builder and the requests list set it. Blocked storage is a fallback, never a throw.
 */

import type { ProjectPick } from '$lib/pure/header';
import { projectParam } from '$lib/pure/routes';

const key = (siteUrl: string) => `sg-bids:project:${siteUrl}`;

export function currentProject(siteUrl: string): ProjectPick | null {
	try {
		const parsed = JSON.parse(localStorage.getItem(key(siteUrl)) ?? 'null') as ProjectPick | null;
		return parsed && Number.isSafeInteger(parsed.id) && typeof parsed.name === 'string' ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * The project a request's page works in: the one its address names (`?project=`, as the requests
 * list links), else the one kept in this browser. An address that names another project makes it
 * the kept one, so the request's other pages follow.
 */
export function workingProject(siteUrl: string, url: URL): ProjectPick | null {
	const kept = currentProject(siteUrl);
	const named = projectParam(url.searchParams);
	if (named === null || kept?.id === named) return kept;
	const next = { id: named, name: `Project ${named}` };
	setCurrentProject(siteUrl, next);
	return next;
}

export function setCurrentProject(siteUrl: string, project: ProjectPick | null): void {
	try {
		if (project) localStorage.setItem(key(siteUrl), JSON.stringify({ id: project.id, name: project.name }));
		else localStorage.removeItem(key(siteUrl));
	} catch {
		/* A remembered project is a convenience. */
	}
}
