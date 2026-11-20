/**
 * Take the person to the control a problem points at: scroll it to the middle of the view and
 * focus it, the first thing they can type in. A box that holds several controls names the one to
 * take with `data-focus-first`. Which id and which folded group come from `$lib/pure/readiness`.
 */

import { tick } from 'svelte';
import { controlId, type Target } from '$lib/pure/readiness';

const FOCUSABLE = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])';

export async function focusControl(target: Target): Promise<boolean> {
	await tick();
	const box = document.getElementById(controlId(target));
	if (!box) return false;
	const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	box.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
	const control = box.matches(FOCUSABLE) ? box : (box.querySelector<HTMLElement>('[data-focus-first]') ?? box.querySelector<HTMLElement>(FOCUSABLE) ?? box);
	control.focus({ preventScroll: true });
	return true;
}
