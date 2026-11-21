/**
 * Paths between the signed-in pages: where a request opens, where an old address of a request goes
 * now, the project an address names, and the page connect sends a person back to after the sign-in.
 * `safeNext` is the one gate on that last one: only a path of this app's signed-in pages passes, so
 * a crafted link cannot send a person to another site, or loop them back to connect.
 */

const FALLBACK = '/requests';
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

/** Where a request opens: its one page, draft or issued, naming its project. */
export function requestHref(row: { id: string; status?: string; projectId: number }): string {
	return `/requests/${encodeURIComponent(row.id)}?project=${row.projectId}`;
}

/**
 * Where an old address goes now. A request is on one page: `/bids/<id>/compare` and `/publish` go to
 * the request's, `/bids/new?id=` and `/requests/new?id=` to its page, and `/bids/<id>`, when the id is
 * a request's, to its page. The Bids pages are gone: any other `/bids` address goes to the Requests
 * list, and the old new request page to the list with New request open. The project goes along.
 * Null for any other path.
 */
export function movedRequestPath(pathname: string, search: string, isRequest = false): string | null {
	const params = new URLSearchParams(search);
	const project = projectParam(params);
	const keep = project === null ? '' : `?project=${project}`;
	const page = /^\/bids\/([^/]+)\/(compare|publish)\/?$/.exec(pathname);
	if (page && page[1] !== 'new') return `/requests/${page[1]}/${page[2]}${search}`;
	if (/^\/(bids|requests)\/new\/?$/.test(pathname)) {
		const id = params.get('id');
		return id ? `/requests/${encodeURIComponent(id)}${keep}` : '/requests?new=1';
	}
	if (/^\/bids\/?$/.test(pathname)) return '/requests';
	const one = /^\/bids\/([^/]+)\/?$/.exec(pathname);
	if (one) return isRequest ? `/requests/${one[1]}${search}` : '/requests';
	return null;
}
