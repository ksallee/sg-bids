// The link a vendor gets: `/v/<token>`, as `vendorLink` writes it. The token moves into the cookie
// with its invitation's id, and the address becomes `/v`, so it stays out of the history and every
// referrer (`$lib/server/vendor-http`). A token no invitation holds clears the cookie.
import { redirect } from '@sveltejs/kit';
import { parseToken } from '$lib/pure/token';
import { serverStore } from '$lib/server/env';
import { address, clearVendorCookie, lookups, setVendorCookie } from '$lib/server/vendor-http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const who = address(event);
	const now = Date.now();
	if (lookups.blocked(who, now)) redirect(303, '/v?link=wait');
	const token = parseToken(event.params.token);
	const invitationId = token ? await serverStore().peekInvitation(token) : null;
	if (!token || !invitationId) {
		lookups.fail(who, now);
		clearVendorCookie(event.cookies);
		redirect(303, '/v?link=invalid');
	}
	setVendorCookie(event.cookies, invitationId, token);
	redirect(303, '/v');
};
