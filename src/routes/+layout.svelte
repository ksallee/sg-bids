<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import AppShell from '$lib/app/app-shell.svelte';
	import { publicPage } from '$lib/pure/seo';
	import { isVendorPath } from '$lib/pure/vendor-path';
	import { apply, mode } from '$lib/theme';

	let { children } = $props();

	// `static/theme.js` applied the scheme before the first paint; this keeps `system` mode following the OS.
	$effect(() => {
		const media = matchMedia('(prefers-color-scheme: dark)');
		const follow = (): void => {
			if (mode() === 'system') apply();
		};
		media.addEventListener('change', follow);
		return () => media.removeEventListener('change', follow);
	});
</script>

<!--
	A public page is a prerendered document: its CSP is the build's meta tag, without the Flow PT
	site the app calls (`hooks.server.ts` adds that per request). A client side move from it would
	keep that policy, so every link on a public page loads the next page whole, under its own policy.
-->
<div style="display: contents" data-sveltekit-reload={publicPage(page.url.pathname) ? '' : 'off'}>
	<AppShell vendor={isVendorPath(page.url.pathname)}>{@render children()}</AppShell>
</div>
