/**
 * The site setup notice, in words. Pure, no I/O.
 *
 * Publishing the award to Flow PT writes Bids and Bid Lines: two custom entities displayed `Bid` and
 * `Bid Line` (`fpt-setup.findEntities`). Until the publish page, nothing needs them. So the Requests
 * list and a request's page say early, once and quietly, what is missing, that the work up to the
 * award goes on without it, and the exact step for an admin. Ready: no notice.
 */

import { ENTITY_NAMES, type EntityKey } from './fpt-fields';
import type { EntityState } from './fpt-setup';

export interface SetupNotice {
	readonly title: string;
	readonly lines: readonly string[];
	/** What an admin does, in the site preferences. */
	readonly step: string;
}

const KEYS: readonly EntityKey[] = ['bid', 'line'];

/** The notice for the entities the site has, or null when both are there, once each. */
export function setupNotice(entities: Readonly<Record<EntityKey, EntityState>>): SetupNotice | null {
	const missing = KEYS.filter((k) => entities[k].state === 'missing').map((k) => ENTITY_NAMES[k]);
	const doubled = KEYS.filter((k) => entities[k].state === 'ambiguous').map((k) => ENTITY_NAMES[k]);
	if (missing.length === 0 && doubled.length === 0) return null;

	const parts: string[] = [];
	if (missing.length > 0) parts.push(`${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set up on this site`);
	if (doubled.length > 0) {
		const two = `two entities are displayed ${doubled.join(' and two ')}`;
		parts.push(parts.length > 0 ? two : `Two entities are displayed ${doubled.join(' and two ')} on this site`);
	}
	const title = `${parts.join(', and ')}.`;

	const steps: string[] = [];
	if (missing.length === 1) steps.push(`An admin enables a custom entity displayed '${missing[0]}' in the site preferences, with no Tasks and no Versions.`);
	if (missing.length === 2) steps.push(`An admin enables two custom entities, one displayed '${missing[0]}' and one displayed '${missing[1]}', in the site preferences, with no Tasks and no Versions.`);
	for (const name of doubled) steps.push(`An admin renames or disables one of them in the site preferences, so one custom entity is displayed '${name}'.`);

	const line =
		missing.length === 0
			? 'Everything up to the award works without one. Publishing the award to Flow PT needs one, and only one.'
			: missing.length + doubled.length > 1
				? 'Everything up to the award works without them. Publishing the award to Flow PT needs them.'
				: 'Everything up to the award works without it. Publishing the award to Flow PT needs it.';
	return { title, lines: [line], step: steps.join(' ') };
}
