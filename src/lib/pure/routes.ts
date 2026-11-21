/**
 * Paths between the signed-in pages: where a request opens, where an old address of a request goes
 * now, the project an address names, and the page connect sends a person back to after the sign-in.
 * `safeNext` is the one gate on that last one: only a path of this app's signed-in pages passes, so
 * a crafted link cannot send a person to another site, or loop them back to connect.
 */

const FALLBACK = '/bids';
/** The signed-in pages a sign-in may lead back to. */
const APP = /^\/(bids|requests|dev)(\/|\?|$)/;
const BASE = 'https://app.invalid';

/** The app path to go to after connect: `value` when it is one of this app's signed-in pages, else the requests list. */
export function safeNext(value: string | null | undefined): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\s\u0000-\u001f]/.test(value) || /%(2f|5c)/i.test(value)) return FALLBACK;
	let url: URL;
	try {
		url = new URL(value, BASE);
	} catch {
		return FALLBACK;
	}
	if (url.origin !== BASE) return FALLBACK;
	const path = `${url.pathname}${url.search}`;
	// The browser resolves dot segments: keep only what was written, resolved to itself.
	if (path !== value.replace(/#.*$/, '') || !APP.test(path)) return FALLBACK;
	return path;
}

/** Connect, with the page to come back to when it is not the list. */
export function connectHref(path: string): string {
	const next = safeNext(path);
	return next === FALLBACK ? '/connect' : `/connect?next=${encodeURIComponent(next)}`;
}

/** The Flow PT project id an address names in `project`, or null. */
export function projectParam(params: URLSearchParams): number | null {
	const raw = params.get('project') ?? '';
	if (!/^[1-9]\d{0,15}$/.test(raw)) return null;
	const id = Number(raw);
	return Number.isSafeInteger(id) ? id : null;
}

/** Where a request in the list opens: a draft in the send flow, anything else on its page. Both name its project. */
export function requestHref(row: { id: string; status: string; projectId: number }): string {
	const project = `project=${row.projectId}`;
	return row.status === 'draft' ? `/requests/new?id=${encodeURIComponent(row.id)}&${project}` : `/requests/${encodeURIComponent(row.id)}?${project}`;
}

/**
 * Where an address a request had before bids came first goes now: `/bids/<id>/compare` and
 * `/bids/<id>/publish` to the request's, `/bids/new?id=<id>` to the send flow, and `/bids/<id>`,
 * when the id is a request's, to its page. The query goes along. Null for any other path.
 */
export function movedRequestPath(pathname: string, search: string, isRequest = false): string | null {
	const page = /^\/bids\/([^/]+)\/(compare|publish)\/?$/.exec(pathname);
	if (page && page[1] !== 'new') return `/requests/${page[1]}/${page[2]}${search}`;
	if (/^\/bids\/new\/?$/.test(pathname) && new URLSearchParams(search).has('id')) return `/requests/new${search}`;
	const one = /^\/bids\/([^/]+)\/?$/.exec(pathname);
	if (one && one[1] !== 'new' && isRequest) return `/requests/${one[1]}${search}`;
	return null;
}
