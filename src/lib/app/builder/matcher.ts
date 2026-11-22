/**
 * What Match to Flow PT works on: a bid in the editor (`Builder`), where linking is an edit of the
 * bid, or an issued request's rows (`$lib/app/request/issued-rows.svelte`), where it is the one
 * change the freeze allows and vendors see none.
 */

import type { ItemKind } from '$lib/pure/field-map';
import type { Match } from '$lib/pure/match';
import type { RequestAsset, RequestShot } from '$lib/pure/model';
import type { ItemLink } from '$lib/pure/wire';

export interface Matcher {
	readonly state: { readonly shots: readonly RequestShot[]; readonly assets: readonly RequestAsset[] };
	/** An issued request: only the Flow PT row changes. */
	readonly readOnly: boolean;
	findMatches(kind: ItemKind): Promise<Match[]>;
	link(kind: ItemKind, links: ItemLink[]): Promise<void>;
}
