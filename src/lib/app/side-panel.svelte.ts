/**
 * Whether a draft's side panel (details and vendors) is open, kept in this browser so the table keeps
 * its room from one request to the next. Open by default. A preference, never request data; blocked
 * storage is a fallback, never a throw. The app renders in the browser only (`ssr = false`).
 */

const KEY = 'sg-bids:side-panel';

function read(): boolean {
	try {
		return localStorage.getItem(KEY) !== 'closed';
	} catch {
		return true;
	}
}

class SidePanel {
	#open = $state(typeof localStorage === 'undefined' ? true : read());

	get open(): boolean {
		return this.#open;
	}

	set open(value: boolean) {
		this.#open = value;
		try {
			localStorage.setItem(KEY, value ? 'open' : 'closed');
		} catch {
			/* A remembered panel is a convenience. */
		}
	}
}

export const sidePanel = new SidePanel();
