/**
 * The calls the FPT layer makes, as the signed-in person. Rows go through sg-widgets-core's
 * `RestClient`. Two calls it does not offer go through `raw`: a field create
 * (`POST /schema/<Type>/fields`) and a permission group read
 * (`GET /schema/permission_groups/...`). Both belong in the client upstream; until then `raw` is
 * the same request with the same bearer, and it never throws on an HTTP status, since a 403 or a
 * 400 code 105 is an answer the setup check reads.
 *
 * No `$app` import here, so a script under Node drives the same code the page does.
 */
import { RestClient } from 'sg-widgets-core';

export interface RawAnswer {
	readonly status: number;
	readonly body: unknown;
}

export interface FptApi {
	readonly client: RestClient;
	raw(method: 'GET' | 'POST', path: string, body?: unknown): Promise<RawAnswer>;
}

export function fptApi(siteUrl: string, token: () => Promise<string> | string, fetchFn: typeof fetch = globalThis.fetch.bind(globalThis)): FptApi {
	const base = `${siteUrl.replace(/\/+$/, '')}/api/v1`;
	return {
		client: new RestClient({ siteUrl, token, fetch: fetchFn }),
		async raw(method, path, body) {
			const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${await token()}` };
			if (body !== undefined) headers['Content-Type'] = 'application/json';
			const res = await fetchFn(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
			const text = await res.text();
			let parsed: unknown = null;
			try {
				parsed = text ? JSON.parse(text) : null;
			} catch {
				parsed = text;
			}
			return { status: res.status, body: parsed };
		}
	};
}

/** The first error's title, or the status. */
export function errorTitle(answer: RawAnswer): string {
	const title = (answer.body as { errors?: { title?: unknown }[] } | null)?.errors?.[0]?.title;
	return typeof title === 'string' ? title : `HTTP ${answer.status}`;
}
