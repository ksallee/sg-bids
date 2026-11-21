// The publish page of a request lived here before bids came first. It is under /requests now.
import { redirect } from '@sveltejs/kit';
import { movedRequestPath } from '$lib/pure/routes';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	redirect(308, movedRequestPath(url.pathname, url.search) ?? '/requests');
};
