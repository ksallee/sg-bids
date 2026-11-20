/**
 * The frame of every production endpoint: read the JSON body, verify its `claim` with the site
 * (`production.ts`, through `env.ts`), run the action with the verified tenant, answer JSON. A
 * StoreError answers its status and message; anything else answers 500 with a plain line.
 */

import { json, type RequestEvent } from '@sveltejs/kit';
import { StoreError } from './errors';
import { verifyProductionClaim } from './env';
import type { VerifiedProduction } from './production';

export type Body = Record<string, unknown>;

export async function productionRoute(event: RequestEvent, action: (production: VerifiedProduction, body: Body) => Promise<unknown>): Promise<Response> {
	try {
		const body = (await event.request.json().catch(() => null)) as Body | null;
		if (!body || typeof body !== 'object') throw new StoreError(400, 'Send a JSON body.');
		const claim = (body.claim ?? {}) as Body;
		const production = await verifyProductionClaim({
			siteUrl: claim.siteUrl,
			projectId: claim.projectId,
			sessionToken: claim.sessionToken,
			bearer: claim.bearer
		});
		return json(await action(production, body));
	} catch (error) {
		if (error instanceof StoreError) return json({ message: error.message }, { status: error.status });
		console.error(error);
		return json({ message: 'The server failed.' }, { status: 500 });
	}
}

/** A refusal for a body that did not parse. */
export function badRequest(message: string): never {
	throw new StoreError(422, message);
}
