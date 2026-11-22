/**
 * Take the person to the control a named problem points at, by element id: scroll it to the middle
 * of the view and focus the first thing they can act on in it, as the builder's summary does
 * (`builder/focus.ts`). A box that holds several controls names the one to take with
 * `data-focus-first`. Answers whether the element was found.
 */

import { tick } from 'svelte';

const FOCUSABLE = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href]';

export async function focusById(id: string): Promise<boolean> {
	await tick();
	const box = document.getElementById(id);
	if (!box) return false;
	const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	box.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
	const control = box.matches(FOCUSABLE) ? box : (box.querySelector<HTMLElement>('[data-focus-first]') ?? box.querySelector<HTMLElement>(FOCUSABLE) ?? box);
	if (control === box && !box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1');
	control.focus({ preventScroll: true });
	return true;
}
