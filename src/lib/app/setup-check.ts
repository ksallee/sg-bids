/**
 * The site setup check behind the quiet notice on the Requests list and a request's page: are Bid
 * and Bid Line set up on the site (`fpt-setup.findEntities`)? Read once per session per site, kept in
 * the tab's sessionStorage; dismissed per site in this browser, until the problem it named changes.
 * A read that fails says nothing: the publish page checks again, in full. The words are
 * `$lib/pure/setup-notice`.
 */

import { liveWriter } from '$lib/live';
import type { EntityKey } from '$lib/pure/fpt-fields';
import { findEntities, type EntityState } from '$lib/pure/fpt-setup';
import { setupNotice, type SetupNotice } from '$lib/pure/setup-notice';

const readKey = (site: string) => `sg-bids:setup:${site}`;
const dismissKey = (site: string) => `sg-bids:setup-dismissed:${site}`;

type Entities = Record<EntityKey, EntityState>;

function stored<T>(storage: Storage | undefined, key: string): T | null {
	try {
		const raw = storage?.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

function keep(storage: Storage | undefined, key: string, value: unknown): void {
	try {
		storage?.setItem(key, JSON.stringify(value));
	} catch {
		/* A check kept is a convenience. */
	}
}

const session = () => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
const local = () => (typeof localStorage === 'undefined' ? undefined : localStorage);

/** The notice for the site, or null: ready, dismissed, or the read failed. */
export async function siteNotice(site: string): Promise<SetupNotice | null> {
	let entities = stored<Entities>(session(), readKey(site));
	if (!entities) {
		try {
			entities = findEntities(await liveWriter().entityTypes());
			keep(session(), readKey(site), entities);
		} catch {
			return null;
		}
	}
	const notice = setupNotice(entities);
	if (!notice) return null;
	return stored<string>(local(), dismissKey(site)) === notice.title ? null : notice;
}

/** Hide the notice for this site, in this browser, until the problem changes. */
export function dismissNotice(site: string, notice: SetupNotice): void {
	keep(local(), dismissKey(site), notice.title);
}
