// Dev only, like `/live/dev-token`: a production build answers 404. Not linked from the nav.
import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

export function load(): void {
	if (!dev) error(404, 'Not found');
}
