// A vendor link, just opened (`/v/<token>` moved its token to the opening cookie). With no other
// link in the browser, or the same one, or one that no longer works, the link becomes the vendor
// cookie and the page goes to `/v`: one click from the invitation to the bid. When the browser holds
// another vendor's live link, the page asks first, naming both, and only a post from this site
// switches (`$lib/server/vendor-http`).
import { error, redirect, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { serverStore } from '$lib/server/env';
import {
	address,
	clearOpeningCookie,
	clearVendorCookie,
	lookups,
	OPENING_COOKIE,
	readVendorCookie,
	sameOrigin,
	setVendorCookie,
	VENDOR_COOKIE
} from '$lib/server/vendor-http';
import type { Actions, PageServerLoad } from './$types';

/** The link waiting in the opening cookie, looked up. Redirects when there is none or it is unknown. */
async function opening(event: Pick<RequestEvent, 'cookies' | 'getClientAddress'>) {
	const token = event.cookies.get(OPENING_COOKIE);
	if (!token) redirect(303, '/v');
	const who = address(event);
	const now = Date.now();
	if (lookups.blocked(who, now)) redirect(303, '/v?link=wait');
	const invitation = await serverStore().linkInvitation(token);
	if (!invitation) {
		lookups.fail(who, now);
		clearOpeningCookie(event.cookies);
		clearVendorCookie(event.cookies);
		redirect(303, '/v?link=invalid');
	}
	return { token, invitation };
}

function open(cookies: Cookies, invitationId: string, token: string): never {
	setVendorCookie(cookies, invitationId, token);
	clearOpeningCookie(cookies);
	redirect(303, '/v');
}

export const load: PageServerLoad = async (event) => {
	const { token, invitation } = await opening(event);
	const current = readVendorCookie(event.cookies.get(VENDOR_COOKIE));
	const held = current ? await serverStore().linkInvitation(current.token) : null;
	if (!held || !held.live || held.id === invitation.id) open(event.cookies, invitation.id, token);
	return { next: invitation.vendorName, current: held.vendorName };
};

export const actions: Actions = {
	switch: async (event) => {
		if (!sameOrigin(event)) error(403, 'Open the link again.');
		const { token, invitation } = await opening(event);
		open(event.cookies, invitation.id, token);
	},
	keep: async (event) => {
		if (!sameOrigin(event)) error(403, 'Open the link again.');
		clearOpeningCookie(event.cookies);
		redirect(303, '/v');
	}
};
