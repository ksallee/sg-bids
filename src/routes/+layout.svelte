<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import AppShell from '$lib/app/app-shell.svelte';
	import { isVendorPath } from '$lib/pure/vendor-path';
	import { apply, mode } from '$lib/theme';

	let { children } = $props();

	// `app.html` applied the scheme before the first paint; this keeps `system` mode following the OS.
	$effect(() => {
		const media = matchMedia('(prefers-color-scheme: dark)');
		const follow = (): void => {
			if (mode() === 'system') apply();
		};
		media.addEventListener('change', follow);
		return () => media.removeEventListener('change', follow);
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<AppShell vendor={isVendorPath(page.url.pathname)}>{@render children()}</AppShell>
