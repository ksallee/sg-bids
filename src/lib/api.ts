/**
 * The browser's calls to this app's production endpoints (`src/routes/api/production/`). Each
 * carries the Flow PT claim for the project (`$lib/live`); the server verifies it with the site
 * and takes the tenant from that, never from the body.
 */

import { productionClaim, siteClaim } from '$lib/live';
import type { BidRequest, InvitedVendor, RequestAsset, RequestHeader, RequestShot } from '$lib/pure/model';
import type { InvitationState } from '$lib/pure/invitations';
import type { Publication } from '$lib/pure/award-record';
import type { Deleted, DeletionFacts } from '$lib/pure/request-delete';

export type RequestStatus = 'draft' | 'issued' | 'awarded' | 'closed';

export interface RequestOverview {
	id: string;
	code: string;
	title: string | null;
	round: number;
	status: RequestStatus;
	dueDate: string | null;
	issuedAt: string | null;
	invited: number;
	submitted: number;
}

export interface InvitationView {
	vendor: InvitedVendor;
	state: InvitationState;
	expiresAt: string;
	createdAt: string;
}

export interface LoadedRequest {
	/** A draft reads as its bids make it: each bid a package, each row in one. */
	request: BidRequest;
	status: RequestStatus;
	issuedAt: string | null;
	invitations: InvitationView[];
	/** What the award wrote to Flow PT, or null. */
	award: Publication | null;
}

export interface Invited {
	invitation: InvitedVendor;
	token: string;
	expiresAt: string;
}

/** A bid as a draft's save sends it. */
export interface SavedBidWire {
	key: string;
	name: string;
	items: { shots: readonly RequestShot[]; assets: readonly RequestAsset[] };
}

/** A vendor as a draft's save sends it: as typed. */
export interface DraftVendorWire {
	id: string;
	name: string;
	email: string;
	group: { id: number; name: string } | null;
	bids: readonly string[] | null;
}

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

/** A request in the list across the site. */
export interface SiteRequestOverview extends RequestOverview {
	projectId: number;
}

export interface RequestsAcross {
	/** The projects that hold a listed request. */
	projects: { id: number; name: string }[];
	requests: SiteRequestOverview[];
}

/**
 * The signed-in person's requests in every project they may read on the site. The server lists
 * those projects with the person's own bearer; the browser sends no project.
 */
export async function listAcross(): Promise<RequestsAcross> {
	return post<RequestsAcross>('requests', { claim: await siteClaim() });
}

export async function call<T>(action: string, projectId: number, body: Record<string, unknown> = {}): Promise<T> {
	return post<T>(action, { ...body, claim: await productionClaim(projectId) });
}

async function post<T>(action: string, body: Record<string, unknown>): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`/api/production/${action}`, {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
	} catch {
		throw new ApiError(0, 'The app could not reach its server.');
	}
	const answer = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
	if (!res.ok) throw new ApiError(res.status, answer?.message ?? 'The server failed.');
	return answer as T;
}

export const api = {
	list: (projectId: number) => call<RequestOverview[]>('list', projectId),
	get: (projectId: number, id: string) => call<LoadedRequest>('get', projectId, { id }),
	/** A new draft: its name and the details it starts with. It holds one bid, Bid 1. */
	create: (projectId: number, body: { name: string; header: RequestHeader }) => call<{ request: { id: string } }>('create', projectId, body),
	/** A draft's page in one write. What is left out stays as it is. */
	saveDraft: (projectId: number, body: { id: string; header?: RequestHeader; bids?: SavedBidWire[]; vendors?: DraftVendorWire[] }) => call<{ ok: true }>('save', projectId, body),
	/** A copy of a request as a new draft, with its rows or without. */
	duplicate: (projectId: number, body: { id: string; name: string; rows: boolean }) => call<{ request: { id: string } }>('duplicate', projectId, body),
	/** Issues the draft. Answers the links of the vendors added to it, once. */
	issue: (projectId: number, id: string) => call<{ request: BidRequest; links: Invited[] }>('issue', projectId, { id }),
	newRound: (projectId: number, id: string) => call<{ request: { id: string } }>('new-round', projectId, { id }),
	/** A vendor invited to an issued request, its link answered once. */
	invite: (projectId: number, requestId: string, vendor: { name: string; email: string; groupId: number | null; packages?: string[] | null }) =>
		call<Invited>('invite', projectId, { requestId, vendor }),
	/** A vendor's packages: some, or null for every one. Refused once the vendor has submitted a bid. */
	invitePackages: (projectId: number, invitationId: string, packages: string[] | null) => call<{ invitation: InvitedVendor }>('invite-packages', projectId, { invitationId, packages }),
	revoke: (projectId: number, invitationId: string) => call<{ ok: true }>('revoke', projectId, { invitationId }),
	reissue: (projectId: number, invitationId: string) => call<{ token: string; expiresAt: string }>('reissue', projectId, { invitationId }),
	/** What deleting the request would take with it, or the award that stops it. */
	deleteCheck: (projectId: number, id: string) => call<{ facts: DeletionFacts }>('delete-check', projectId, { id }),
	/** Deletes the request and everything under it. `name` is the request's name, as typed. */
	deleteRequest: (projectId: number, id: string, name: string) => call<{ deleted: Deleted }>('delete', projectId, { id, name }),
	/** Breakdown rows matched to Flow PT. Only the Flow PT row changes; vendors see nothing new. */
	linkItems: (projectId: number, requestId: string, links: { kind: 'shot' | 'asset'; key: string; fpt: { type: string; id: number } }[]) =>
		call<{ request: BidRequest }>('link-items', projectId, { requestId, links })
};
