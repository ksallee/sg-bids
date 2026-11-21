// The send flow lived here. A request is made from the Requests list now and opens on its one page.
import { redirect } from '@sveltejs/kit';
import { movedRequestPath } from '$lib/pure/routes';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	redirect(307, movedRequestPath(url.pathname, url.search) ?? '/requests');
};
