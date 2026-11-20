/**
 * Production's actions on its requests, each with a verified tenant: the routes under
 * `src/routes/api/production/` are one line each over these. Bodies are checked by
 * `$lib/pure/wire` before the data layer sees them.
 */

import { nextRound } from '$lib/pure/persist';
import { parseId, parseSave, parseVendor } from '$lib/pure/wire';
import { loadPublication } from './award-actions';
import { database, serverStore } from './env';
import { StoreError } from './errors';
import type { VerifiedProduction } from './production';
import { createRequests, type Requests } from './requests';
import type { Body } from './production-route';

let requests: Requests | null = null;
function serverRequests(): Requests {
	requests ??= createRequests(database());
	return requests;
}

function id(value: unknown, what = 'request'): string {
	const parsed = parseId(value);
	if (!parsed) throw new StoreError(422, `That is not a ${what} id.`);
	return parsed;
}

/** The data layer throws a plain Error for a header or item it cannot store. */
async function storing<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof StoreError) throw error;
		if (error instanceof Error) throw new StoreError(422, error.message);
		throw error;
	}
}

export function listRequests(production: VerifiedProduction) {
	return serverRequests().listOverview(production);
}

export async function getRequest(production: VerifiedProduction, body: Body) {
	const requestId = id(body.id);
	const [request, meta, invitations, award] = await Promise.all([
		serverStore().getRequest(production, requestId),
		serverRequests().requestMeta(production, requestId),
		serverRequests().listInvitations(production, requestId),
		loadPublication(production, requestId)
	]);
	return { request, ...meta, invitations, award };
}

export async function saveRequest(production: VerifiedProduction, body: Body) {
	const parsed = parseSave(body);
	if (!parsed.ok) throw new StoreError(422, parsed.message);
	const { id: requestId, code, header, items } = parsed.value;
	const request = await storing(() =>
		requestId ? serverStore().updateDraftRequest(production, requestId, { code, header, items }) : serverStore().createDraftRequest(production, { code, header, items })
	);
	return { request };
}

export async function issueRequest(production: VerifiedProduction, body: Body) {
	return { request: await serverStore().issueRequest(production, id(body.id)) };
}

/** A new draft from an issued request: same code, the next round, the items copied. */
export async function newRound(production: VerifiedProduction, body: Body) {
	const issued = await serverStore().getRequest(production, id(body.id));
	const meta = await serverRequests().requestMeta(production, issued.id);
	if (meta.status === 'draft') throw new StoreError(409, 'Issue the request before starting a new round.');
	const next = nextRound(issued);
	return { request: await storing(() => serverStore().createDraftRequest(production, next)) };
}

export async function invite(production: VerifiedProduction, body: Body) {
	const vendor = parseVendor(body.vendor);
	if (!vendor.ok) throw new StoreError(422, vendor.message);
	return storing(() => serverStore().inviteVendor(production, id(body.requestId), vendor.value));
}

export async function revoke(production: VerifiedProduction, body: Body) {
	await serverStore().revokeInvitation(production, id(body.invitationId, 'invitation'));
	return { ok: true };
}

export function reissue(production: VerifiedProduction, body: Body) {
	return serverRequests().reissueInvitation(production, id(body.invitationId, 'invitation'));
}
