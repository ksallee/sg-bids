/**
 * Production's actions on its requests, each with a verified tenant: the routes under
 * `src/routes/api/production/` are one line each over these. Bodies are checked by
 * `$lib/pure/wire` before the data layer sees them.
 *
 * A request is made, filled and issued on one page. It owns its bids: `create` makes it with one,
 * Bid 1; `save` writes its page (details, bids with their rows, vendors); `issue` sends it. A request
 * is copied whole with `duplicate`, with its rows or without, and an issued one starts its next
 * round with `new-round`.
 */

import { suggestCode } from '$lib/pure/header';
import type { RequestHeader } from '$lib/pure/model';
import { copyRequest, type SavedBid } from '$lib/pure/request-draft';
import { parseCreate, parseDraftSave, parseDuplicate, parseId, parseInvitationPackages, parseLinks, parseVendor } from '$lib/pure/wire';
import { loadPublication } from './award-actions';
import { database, serverStore } from './env';
import { StoreError } from './errors';
import type { VerifiedProduction } from './production';
import { createRequests, type Requests } from './requests';
import type { DraftVendor } from './store';
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

/**
 * A new draft with a code made from its name, free in the tenant for its round. The code stays out
 * of sight: it keys the request and is written to Flow PT's Request Code. Two people making one at
 * once: the second takes the next code.
 */
async function draftWithCode(
	production: VerifiedProduction,
	name: string,
	header: RequestHeader,
	content: { bids?: readonly SavedBid[]; vendors?: readonly DraftVendor[]; code?: string }
) {
	for (let attempt = 0; ; attempt++) {
		const code = content.code ?? suggestCode(name, await serverStore().codesInRound(production, header.round));
		try {
			return await storing(() => serverStore().createDraftRequest(production, { code, header, bids: content.bids, vendors: content.vendors }));
		} catch (error) {
			if (content.code || attempt >= 4 || !(error instanceof StoreError) || error.status !== 409 || error.message !== 'That already exists.') throw error;
		}
	}
}

export function listRequests(production: VerifiedProduction) {
	return serverRequests().listOverview(production);
}

/** The request, its status, its vendors and the award. A draft reads as its bids make it. */
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

/** A new draft: its name, the details it starts with, and one empty bid, Bid 1. */
export async function createRequest(production: VerifiedProduction, body: Body) {
	const parsed = parseCreate(body);
	if (!parsed.ok) throw new StoreError(422, parsed.message);
	const request = await draftWithCode(production, parsed.value.name, { ...parsed.value.header, round: 1 }, {});
	return { request: { id: request.id } };
}

/** A draft's page, in one write: its details, its bids with their rows, its vendors. What is absent stays. */
export async function saveRequest(production: VerifiedProduction, body: Body) {
	const parsed = parseDraftSave(body);
	if (!parsed.ok) throw new StoreError(422, parsed.message);
	const { id: requestId, header, bids, vendors } = parsed.value;
	await storing(() => serverStore().saveDraft(production, requestId, { header, bids, vendors }));
	return { ok: true };
}

/**
 * A copy of a request, draft or issued, as a new draft: the name given, its details, its vendors,
 * its bids by name, and their rows when asked. Round 1, a code of its own.
 */
export async function duplicateRequest(production: VerifiedProduction, body: Body) {
	const parsed = parseDuplicate(body);
	if (!parsed.ok) throw new StoreError(422, parsed.message);
	const source = await serverStore().getRequest(production, parsed.value.id);
	const copy = copyRequest(source, { rows: parsed.value.rows, key: () => crypto.randomUUID(), id: () => crypto.randomUUID() });
	const { code: _, ...header } = source.header;
	const request = await draftWithCode(production, parsed.value.name, { ...header, title: parsed.value.name, round: 1 }, copy);
	return { request: { id: request.id } };
}

/** Breakdown rows matched to Flow PT: on a draft, and on an issued request (the freeze allows it). */
export async function linkItems(production: VerifiedProduction, body: Body) {
	const parsed = parseLinks(body);
	if (!parsed.ok) throw new StoreError(422, parsed.message);
	return { request: await serverStore().linkItems(production, parsed.value.requestId, parsed.value.links) };
}

/** Issues the draft: each bid's rows copied as they are now. Answers the links of its vendors, once. */
export async function issueRequest(production: VerifiedProduction, body: Body) {
	return serverStore().issue(production, id(body.id));
}

/**
 * The next round of an issued request, as a new draft: the same name and code, the round after, its
 * bids with the rows as issued, and its vendors, each invited to the same bids. Their links are made
 * at its issue.
 */
export async function newRound(production: VerifiedProduction, body: Body) {
	const issued = await serverStore().getRequest(production, id(body.id));
	const meta = await serverRequests().requestMeta(production, issued.id);
	if (meta.status === 'draft') throw new StoreError(409, 'Issue the request before starting a new round.');
	const copy = copyRequest(issued, { rows: true, key: () => crypto.randomUUID(), id: () => crypto.randomUUID() });
	const header = { ...issued.header, round: issued.header.round + 1 };
	const request = await draftWithCode(production, header.title ?? '', header, { ...copy, code: issued.header.code ?? '' });
	return { request: { id: request.id } };
}

/** A vendor invited to an issued request, with its link answered once. A draft's vendors are saved with its page. */
export async function invite(production: VerifiedProduction, body: Body) {
	const vendor = parseVendor(body.vendor);
	if (!vendor.ok) throw new StoreError(422, vendor.message);
	const requestId = id(body.requestId);
	const meta = await serverRequests().requestMeta(production, requestId);
	if (meta.status === 'draft') throw new StoreError(409, 'Add the vendor on the draft’s page. Its link is made at the issue.');
	return storing(() => serverStore().inviteVendor(production, requestId, vendor.value));
}

/**
 * A vendor's bids: some, or null for every one. Refused once the vendor has submitted an answer,
 * withdrawn or not, with the reason.
 */
export async function invitePackages(production: VerifiedProduction, body: Body) {
	const parsed = parseInvitationPackages(body);
	if (!parsed.ok) throw new StoreError(422, parsed.message);
	return { invitation: await serverStore().setInvitationPackages(production, parsed.value.invitationId, parsed.value.packages) };
}

export async function revoke(production: VerifiedProduction, body: Body) {
	await serverStore().revokeInvitation(production, id(body.invitationId, 'invitation'));
	return { ok: true };
}

export function reissue(production: VerifiedProduction, body: Body) {
	return serverRequests().reissueInvitation(production, id(body.invitationId, 'invitation'));
}

/** What deleting the request would take with it, or why it is refused: for the confirm. */
export async function deletionFacts(production: VerifiedProduction, body: Body) {
	return { facts: await serverRequests().deletionFacts(production, id(body.id)) };
}

/**
 * Deletes the request and everything under it: `{id, name}`, the name typed by the person. Refused
 * while an award is in Flow PT. Answers what went. Writes nothing to Flow PT.
 */
export async function deleteRequest(production: VerifiedProduction, body: Body) {
	if (typeof body.name !== 'string') throw new StoreError(422, "Type the request's name to delete it.");
	return { deleted: await serverStore().deleteRequest(production, id(body.id), body.name) };
}
