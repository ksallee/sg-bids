/**
 * Production's actions on its bids and requests, each with a verified tenant: the routes under
 * `src/routes/api/production/` are one line each over these. Bodies are checked by
 * `$lib/pure/wire` before the data layer sees them.
 */

import type { Id, RequestAsset, RequestShot } from '$lib/pure/model';
import { resolvePackages } from '$lib/pure/packages';
import { nextRound } from '$lib/pure/persist';
import { UNTITLED_BID } from '$lib/pure/production-bid';
import { parseBidMove, parseBidSave, parseId, parseInvitationPackages, parseLinks, parseRequestBids, parseSave, parseVendor } from '$lib/pure/wire';
import { loadPublication } from './award-actions';
import { database, serverStore } from './env';
import { StoreError } from './errors';
import type { VerifiedProduction } from './production';
import { createProductionBids, type ProductionBids } from './production-bids';
import { createRequests, type Requests } from './requests';
import type { Body } from './production-route';

let requests: Requests | null = null;
function serverRequests(): Requests {
	requests ??= createRequests(database());
	return requests;
}

let bids: ProductionBids | null = null;
export function serverBids(): ProductionBids {
	bids ??= createProductionBids(database());
	return bids;
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

// Bids.

/** The project's bids, newest change first, each with its counts and the requests it is in. */
export async function listBids(production: VerifiedProduction) {
	return { bids: await serverBids().list(production) };
}

export function getBid(production: VerifiedProduction, body: Body) {
	return serverBids().get(production, id(body.id, 'bid'));
}

/** Create a bid or replace one's name and rows. */
export async function saveBid(production: VerifiedProduction, body: Body) {
	const parsed = parseBidSave(body);
	if (!parsed.ok) throw new StoreError(422, parsed.message);
	return storing(() => serverBids().save(production, parsed.value));
}

/** A copy of the bid, `<name> copy`, with every row. */
export function cloneBid(production: VerifiedProduction, body: Body) {
	return serverBids().clone(production, id(body.id, 'bid'));
}

/** What deleting the bid would do: the drafts it leaves, the requests that keep what was issued. */
export async function bidDeletionFacts(production: VerifiedProduction, body: Body) {
	return { facts: await serverBids().deletionFacts(production, id(body.id, 'bid')) };
}

/** Deletes the bid. Writes nothing to Flow PT. */
export async function deleteBid(production: VerifiedProduction, body: Body) {
	return { deleted: await serverBids().remove(production, id(body.id, 'bid')) };
}

/** Rows of one bid copied, or moved, to another. */
export async function moveBidRows(production: VerifiedProduction, body: Body) {
	const parsed = parseBidMove(body);
	if (!parsed.ok) throw new StoreError(422, parsed.message);
	return serverBids().moveRows(production, parsed.value);
}

// Requests.

export function listRequests(production: VerifiedProduction) {
	return serverRequests().listOverview(production);
}

/** The request, its status, its vendors and the award. A draft made from bids reads as its bids make it now, with the rows in two of them. */
export async function getRequest(production: VerifiedProduction, body: Body) {
	const requestId = id(body.id);
	const [view, meta, invitations, award] = await Promise.all([
		serverStore().getDraftView(production, requestId),
		serverRequests().requestMeta(production, requestId),
		serverRequests().listInvitations(production, requestId),
		loadPublication(production, requestId)
	]);
	return { request: view.request, overlaps: view.overlaps, ...meta, invitations, award };
}

/**
 * A draft's header, and its bids when they come: a new draft without an id. A draft that holds rows
 * of its own (made before bids) takes them with its packages, as it did.
 */
export async function saveRequest(production: VerifiedProduction, body: Body) {
	const parsed = parseSave(body);
	if (!parsed.ok) throw new StoreError(422, parsed.message);
	const { id: requestId, code, header, items, packages, bids: bidIds } = parsed.value;
	const rows = items ? { ...items, packages } : undefined;
	const request = await storing(() =>
		requestId
			? serverStore().updateDraftRequest(production, requestId, { code, header, items: rows, bids: bidIds })
			: serverStore().createDraftRequest(production, { code, header, items: rows, bids: bidIds })
	);
	return { request };
}

/** A draft's bids, in order. */
export async function requestBids(production: VerifiedProduction, body: Body) {
	const parsed = parseRequestBids(body);
	if (!parsed.ok) throw new StoreError(422, parsed.message);
	await serverStore().setRequestBids(production, parsed.value.requestId, parsed.value.bids);
	return getRequest(production, { id: parsed.value.requestId });
}

/** Breakdown rows matched to Flow PT: on a draft, and on an issued request (the freeze allows it). */
export async function linkItems(production: VerifiedProduction, body: Body) {
	const parsed = parseLinks(body);
	if (!parsed.ok) throw new StoreError(422, parsed.message);
	return { request: await serverStore().linkItems(production, parsed.value.requestId, parsed.value.links) };
}

/** Issues the draft: each bid's rows copied as they are now. Answers the links of the vendors added to the draft, once. */
export async function issueRequest(production: VerifiedProduction, body: Body) {
	return serverStore().issue(production, id(body.id));
}

/**
 * A new draft from an issued request: same code, the next round, the same bids. A bid of the request
 * whose production bid is gone, or one from before bids, comes back as a new bid made from what was
 * issued.
 */
export async function newRound(production: VerifiedProduction, body: Body) {
	const issued = await serverStore().getRequest(production, id(body.id));
	const meta = await serverRequests().requestMeta(production, issued.id);
	if (meta.status === 'draft') throw new StoreError(409, 'Issue the request before starting a new round.');
	const resolved = resolvePackages(issued);
	const shots = new Map(issued.shots.map((s) => [s.id, s]));
	const assets = new Map(issued.assets.map((a) => [a.id, a]));
	const order: Id[] = [];
	for (const p of resolved.packages) {
		if (p.bid) {
			order.push(p.bid);
			continue;
		}
		const rows = resolved.rows.get(p.id) ?? [];
		const name = resolved.implicit ? issued.header.title?.trim() || issued.header.code || UNTITLED_BID : p.name;
		const made = await storing(() =>
			serverBids().save(production, {
				id: null,
				name: name.slice(0, 120).trim() || UNTITLED_BID,
				shots: rows.flatMap((t) => (t.kind === 'shot' && shots.has(t.id) ? [shots.get(t.id) as RequestShot] : [])),
				assets: rows.flatMap((t) => (t.kind === 'asset' && assets.has(t.id) ? [assets.get(t.id) as RequestAsset] : []))
			})
		);
		order.push(made.bid.id);
	}
	const next = nextRound(issued);
	return { request: await storing(() => serverStore().createDraftRequest(production, { code: next.code, header: next.header, bids: order })) };
}

/** A vendor invited to the request: at once, with a link answered once; or, `pending`, added to a draft, its link made at the issue. */
export async function invite(production: VerifiedProduction, body: Body) {
	const vendor = parseVendor(body.vendor);
	if (!vendor.ok) throw new StoreError(422, vendor.message);
	if (body.pending === true) return { invitation: await storing(() => serverStore().planVendor(production, id(body.requestId), vendor.value)) };
	return storing(() => serverStore().inviteVendor(production, id(body.requestId), vendor.value));
}

/** A vendor added to a draft goes again. */
export async function uninvite(production: VerifiedProduction, body: Body) {
	await serverStore().removePlannedVendor(production, id(body.invitationId, 'invitation'));
	return { ok: true };
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
 * Deletes the request and everything under it: `{id, code}`, the code typed by the person. Refused
 * while an award is in Flow PT. Answers what went. Writes nothing to Flow PT.
 */
export async function deleteRequest(production: VerifiedProduction, body: Body) {
	if (typeof body.code !== 'string') throw new StoreError(422, "Type the request's code to delete it.");
	return { deleted: await serverStore().deleteRequest(production, id(body.id), body.code) };
}
