/**
 * The browser's calls to this app's production endpoints (`src/routes/api/production/`). Each
 * carries the Flow PT claim for the project (`$lib/live`); the server verifies it with the site
 * and takes the tenant from that, never from the body.
 */

import { productionClaim } from '$lib/live';
import type { BidRequest, InvitedVendor } from '$lib/pure/model';
import type { InvitationState } from '$lib/pure/invitations';
import type { Publication } from '$lib/pure/award-record';

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

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

export async function call<T>(action: string, projectId: number, body: Record<string, unknown> = {}): Promise<T> {
	const claim = await productionClaim(projectId);
	let res: Response;
	try {
		res = await fetch(`/api/production/${action}`, {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...body, claim })
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
	save: (projectId: number, body: { id: string | null; code: string; header: unknown; items: unknown }) => call<{ request: BidRequest }>('save', projectId, body),
	issue: (projectId: number, id: string) => call<{ request: BidRequest }>('issue', projectId, { id }),
	newRound: (projectId: number, id: string) => call<{ request: BidRequest }>('new-round', projectId, { id }),
	invite: (projectId: number, requestId: string, vendor: { name: string; email: string; groupId: number | null }) => call<Invited>('invite', projectId, { requestId, vendor }),
	revoke: (projectId: number, invitationId: string) => call<{ ok: true }>('revoke', projectId, { invitationId }),
	reissue: (projectId: number, invitationId: string) => call<{ token: string; expiresAt: string }>('reissue', projectId, { invitationId }),
	/** Breakdown rows matched to Flow PT. Only the Flow PT row changes; vendors see nothing new. */
	linkItems: (projectId: number, requestId: string, links: { kind: 'shot' | 'asset'; key: string; fpt: { type: string; id: number } }[]) =>
		call<{ request: BidRequest }>('link-items', projectId, { requestId, links })
};
