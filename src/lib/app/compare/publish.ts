/**
 * The seam between the award scenario and Flow PT. The button opens `/bids/[id]/publish`, which
 * checks the site, previews every write, publishes from production's own session, reads it back and
 * records the award (`$lib/app/award`).
 */

export const PUBLISH_CONNECTED = true;

export function publishLine(chosen: boolean, awarded: boolean): string {
	if (!chosen) return 'Mark a scenario as chosen to publish it.';
	if (awarded) return 'Published. Publish again to update Flow PT to the chosen scenario.';
	return 'Writes the chosen scenario to Flow PT: a Bid per vendor, a Bid Line per awarded shot or asset, and the vendor Group on what it wins. A preview comes first.';
}
