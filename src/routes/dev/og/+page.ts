// Dev only, like `/dev/fpt`: a production build answers 404. `pnpm og` shoots this page.
import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

export function load(): void {
	if (!dev) error(404, 'Not found');
}
