// The link a vendor gets: `/v/<token>`, as `vendorLink` writes it. It does as little as it can
// while the token is in the address: no lookup, no page. The token moves to a short cookie and the
// address becomes `/v/open`, which finds the invitation (`./open/+page.server.ts`). A token that is
// not a token's shape lands on `/v?link=invalid`.
import { redirect } from '@sveltejs/kit';
import { parseToken } from '$lib/pure/token';
import { setOpeningCookie } from '$lib/server/vendor-http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const token = parseToken(event.params.token);
	if (!token) redirect(303, '/v?link=invalid');
	setOpeningCookie(event.cookies, token);
	redirect(303, '/v/open');
};
