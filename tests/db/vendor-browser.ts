/**
 * One vendor's browser, for calling the vendor routes as SvelteKit calls them: a cookie jar, an
 * address, and every answer kept so a test can search them all. A thrown redirect becomes a 303
 * answer with its location, as the browser sees it.
 */
import { isActionFailure, isHttpError, isRedirect, type Cookies, type RequestEvent } from '@sveltejs/kit';

export type Handler = (event: RequestEvent) => Response | Promise<Response>;
export type Jar = Map<string, { value: string; options: Record<string, unknown> }>;

export const ORIGIN = 'http://localhost:5181';

export function jarCookies(jar: Jar): Cookies {
	return {
		get: (name: string) => jar.get(name)?.value,
		getAll: () => [...jar].map(([name, { value }]) => ({ name, value })),
		set: (name: string, value: string, options: Record<string, unknown>) => void jar.set(name, { value, options }),
		delete: (name: string) => void jar.delete(name),
		serialize: () => ''
	} as unknown as Cookies;
}

export interface Answer {
	status: number;
	headers: Headers;
	text: string;
	json: any;
}

export interface CallOptions {
	params?: Record<string, string>;
	headers?: Record<string, string>;
	/** A raw body, sent as is, in place of JSON. */
	raw?: BodyInit;
}

export function browser(address = '203.0.113.1') {
	const jar: Jar = new Map();
	const answers: Answer[] = [];

	function event(method: string, path: string, body: unknown, options: CallOptions): RequestEvent {
		const url = new URL(`${ORIGIN}${path}`);
		const init: RequestInit = { method, headers: { ...options.headers } };
		if (options.raw !== undefined) init.body = options.raw;
		else if (body !== undefined) {
			init.headers = { 'content-type': 'application/json', ...options.headers };
			init.body = JSON.stringify(body);
		}
		return { request: new Request(url, init), url, params: options.params ?? {}, cookies: jarCookies(jar), getClientAddress: () => address } as unknown as RequestEvent;
	}

	async function settle(run: () => unknown): Promise<Answer> {
		let res: Response;
		try {
			const out = await run();
			res = isActionFailure(out)
				? new Response(JSON.stringify(out.data), { status: out.status })
				: out instanceof Response ? out : new Response(out === undefined ? null : JSON.stringify(out), { status: 200 });
		} catch (thrown) {
			if (isHttpError(thrown)) res = new Response(JSON.stringify(thrown.body), { status: thrown.status });
			else if (isRedirect(thrown)) res = new Response(null, { status: thrown.status, headers: { location: thrown.location } });
			else throw thrown;
		}
		const text = await res.text();
		const answer = { status: res.status, headers: res.headers, text, json: text ? JSON.parse(text) : null };
		answers.push(answer);
		return answer;
	}

	/** An endpoint (`+server.ts`). */
	function call(handler: Handler, method: string, path: string, body?: unknown, options: CallOptions | Record<string, string> = {}): Promise<Answer> {
		const given = 'params' in options || 'headers' in options || 'raw' in options ? (options as CallOptions) : { params: options as Record<string, string> };
		return settle(() => handler(event(method, path, body, given)));
	}

	/** A page's server `load`: its data as the JSON answer. */
	function load(fn: (event: any) => unknown, path: string): Promise<Answer> {
		return settle(() => fn(event('GET', path, undefined, {})));
	}

	/** A form action, posted as a form from `origin`. */
	function action(fn: (event: any) => unknown, path: string, origin: string | null = ORIGIN): Promise<Answer> {
		const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
		if (origin !== null) headers.origin = origin;
		return settle(() => fn(event('POST', path, undefined, { headers, raw: '' })));
	}

	/** A vendor link opened in this browser, as the browser follows it: `/v/<token>`, then `/v/open`. */
	async function open(openRoute: { GET: unknown }, openPage: { load: unknown }, token: string): Promise<Answer> {
		const first = await call(openRoute.GET as Handler, 'GET', `/v/${token}`, undefined, { token });
		if (first.headers.get('location') !== '/v/open') return first;
		return load(openPage.load as (event: RequestEvent) => unknown, '/v/open');
	}

	return { jar, answers, call, load, action, open };
}

/** Every key anywhere in a JSON value. */
export function keys(value: unknown, into = new Set<string>()): Set<string> {
	if (Array.isArray(value)) value.forEach((v) => keys(v, into));
	else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			into.add(k);
			keys(v, into);
		}
	}
	return into;
}
