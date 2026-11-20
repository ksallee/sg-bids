/**
 * The project the requests list and a request's page work in, kept per site in this browser. The
 * builder sets it when a project is picked. Blocked storage is a fallback, never a throw.
 */

import type { ProjectPick } from '$lib/pure/header';

const key = (siteUrl: string) => `sg-bids:project:${siteUrl}`;

export function currentProject(siteUrl: string): ProjectPick | null {
	try {
		const parsed = JSON.parse(localStorage.getItem(key(siteUrl)) ?? 'null') as ProjectPick | null;
		return parsed && Number.isSafeInteger(parsed.id) && typeof parsed.name === 'string' ? parsed : null;
	} catch {
		return null;
	}
}

export function setCurrentProject(siteUrl: string, project: ProjectPick | null): void {
	try {
		if (project) localStorage.setItem(key(siteUrl), JSON.stringify({ id: project.id, name: project.name }));
		else localStorage.removeItem(key(siteUrl));
	} catch {
		/* A remembered project is a convenience. */
	}
}
