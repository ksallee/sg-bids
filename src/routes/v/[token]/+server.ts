// The link a vendor gets: `/v/<token>`. The token moves into the cookie and the address becomes
// `/v`, so it stays out of the history and every referrer (`$lib/server/vendor-http`).
import { redirect } from '@sveltejs/kit';
import { parseToken } from '$lib/pure/token';
import { clearVendorCookie, setVendorCookie } from '$lib/server/vendor-http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, cookies }) => {
	const token = parseToken(params.token);
	if (token) setVendorCookie(cookies, token);
	else clearVendorCookie(cookies);
	redirect(303, token ? '/v' : '/v?link=invalid');
};
