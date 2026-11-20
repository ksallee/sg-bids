/**
 * Production's award actions, each with a verified tenant: `award-record` after a run of the award
 * in Flow PT, `award-undo` after its undo. Bodies are checked by `$lib/pure/award-wire` first.
 */

import { parseAwardRecord, parseAwardUndo } from '$lib/pure/award-wire';
import { createAwards, type Awards } from './awards';
import { database } from './env';
import { StoreError } from './errors';
import type { VerifiedProduction } from './production';
import type { Body } from './production-route';

let store: Awards | null = null;
function awards(): Awards {
	store ??= createAwards(database());
	return store;
}

function parsed<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
	if (!result.ok) throw new StoreError(422, result.message);
	return result.value;
}

export async function recordAward(production: VerifiedProduction, body: Body) {
	return { publication: await awards().recordAward(production, parsed(parseAwardRecord(body, production.projectId))) };
}

export async function undoAward(production: VerifiedProduction, body: Body) {
	return { publication: await awards().clearAward(production, parsed(parseAwardUndo(body))) };
}

export function loadPublication(production: VerifiedProduction, requestId: string) {
	return awards().loadPublication(production, requestId);
}
