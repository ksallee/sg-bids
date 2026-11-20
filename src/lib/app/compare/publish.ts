/**
 * The seam between the award scenario and Flow PT. Not connected yet: a later step wires it to the
 * FPT write layer (`$lib/io/fpt-award` publishAward, `$lib/pure/fpt-award` planAward), from
 * production's own session, and records the award rows that lock the rates.
 *
 * What it will do: write a Bid per vendor in the scenario and a Bid Line per awarded shot or asset,
 * add each vendor's Group to the shots and assets it wins, read every write back, and keep the undo.
 */

import type { StoredScenario } from '$lib/compare-api';

/** False until the FPT layer is connected. The button reads it. */
export const PUBLISH_CONNECTED = false;

export const PUBLISH_LINE =
	'Publishing writes the chosen scenario to Flow PT: a Bid per vendor, a Bid Line per awarded shot or asset, and the vendor Group on what it wins. It comes in a later step.';

export async function publishAward(scenario: StoredScenario): Promise<never> {
	void scenario;
	throw new Error('Publishing the award is not connected yet.');
}
