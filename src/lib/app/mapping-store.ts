/**
 * The field mapping is kept per site and project in this browser, so the next request on the same
 * project opens with the same picks. It is a preference, not request data: the request holds the
 * values the mapping read. Blocked storage is a fallback, never a throw.
 */

import type { Mapping } from '$lib/pure/field-map';

export interface StoredMapping {
	shot: Mapping;
	asset: Mapping;
}

function key(siteUrl: string, projectId: number): string {
	return `sg-bids:mapping:${siteUrl}:${projectId}`;
}

export function loadMapping(siteUrl: string, projectId: number): StoredMapping | null {
	try {
		const raw = localStorage.getItem(key(siteUrl, projectId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as StoredMapping;
		return parsed && typeof parsed.shot === 'object' && typeof parsed.asset === 'object' ? parsed : null;
	} catch {
		return null;
	}
}

export function storeMapping(siteUrl: string, projectId: number, mapping: StoredMapping): void {
	try {
		localStorage.setItem(key(siteUrl, projectId), JSON.stringify(mapping));
	} catch {
		/* A remembered mapping is a convenience. */
	}
}
