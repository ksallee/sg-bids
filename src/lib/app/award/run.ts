/**
 * The undo, from production's own browser session: take back what the award wrote in Flow PT, read
 * the site back, then tell the app what is left. Decisions are in `$lib/pure/fpt-award` and
 * `$lib/io/fpt-award`; this only joins them to the endpoints.
 */

import { compareApi } from '$lib/compare-api';
import { fptApi } from '$lib/io/fpt-api';
import { undoAward } from '$lib/io/fpt-award';
import { liveAuth } from '$lib/live';
import type { Publication } from '$lib/pure/award-record';
import { isClean } from '$lib/pure/fpt-award';
import { leftLine } from '$lib/pure/award-view';
import { setUndoNote } from './undo-state.svelte';

export function siteApi() {
	const auth = liveAuth();
	return fptApi(auth.siteUrl, auth.token);
}

/**
 * Undo the award. Answers the record left, or null when nothing the app wrote is left. A created row
 * that gained links since stays in Flow PT, named in the undo note.
 */
export async function undoPublished(projectId: number, requestId: string, publication: Publication): Promise<Publication | null> {
	const done = await undoAward(siteApi(), publication.site, publication.written);
	setUndoNote(requestId, leftLine(done.undo.left));
	const clean = isClean(done.remaining);
	const error = clean ? null : (done.error ?? 'Some of what the app wrote is still in Flow PT.');
	return (await compareApi.undoAward(projectId, requestId, clean ? null : done.remaining, error)).publication;
}
