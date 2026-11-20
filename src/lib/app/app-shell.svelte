<!--
	The frame of every screen: a h-12 header as sg-task-templates' (wordmark, the site and who reads
	it, the scheme switch), the demo banner, then the page. The header holds who and where; the page
	holds what this screen is about. On the vendor's side (`vendor`) there is no site and no person:
	the vendor has no Flow PT sign-in, so the header holds the wordmark and the scheme switch only.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import { Button } from '$lib/components/ui/button/index.js';
	import { isDark, setMode } from '$lib/theme';
	import { prepareLive, type LiveState } from '$lib/live';
	import { shortHost } from '$lib/pure/site';
	import DemoBanner from './demo-banner.svelte';
	import Wordmark from './wordmark.svelte';

	let { children, vendor = false }: { children: Snippet; vendor?: boolean } = $props();

	let live = $state<LiveState | null>(null);
	// svelte-ignore state_referenced_locally
	if (!vendor) void prepareLive().then((value) => (live = value));

	let dark = $state(isDark());

	// In `system` mode the OS can flip the scheme under the page; the icon and label follow it.
	$effect(() => {
		const media = matchMedia('(prefers-color-scheme: dark)');
		const follow = (): void => {
			dark = isDark();
		};
		media.addEventListener('change', follow);
		return () => media.removeEventListener('change', follow);
	});

	function toggleScheme(): void {
		const next = dark ? 'light' : 'dark';
		setMode(next);
		dark = isDark(next);
	}
</script>

<div class="bg-background text-foreground flex h-dvh flex-col">
	<header class="border-border bg-background flex h-12 shrink-0 items-center gap-3 border-b px-3 sm:gap-5 sm:px-4" data-slot="app-header">
		{#if vendor}
			<span class="shrink-0 text-sm"><Wordmark /></span>
		{:else}
			<a href="/" class="focus-visible:ring-ring shrink-0 rounded-md text-sm outline-none focus-visible:ring-2" aria-label="SG Bids, home">
				<Wordmark />
			</a>
		{/if}

		<div class="flex-1"></div>

		<div class="flex shrink-0 items-center gap-1 text-sm sm:gap-2">
			{#if live?.siteUrl}
				<a
					href="/connect"
					class="text-muted-foreground hover:text-foreground focus-visible:ring-ring hidden max-w-64 min-w-0 items-center gap-1.5 truncate rounded-md px-1.5 py-1 outline-none focus-visible:ring-2 sm:flex"
					title={`${live.siteUrl}${live.session ? ` · ${live.session.login}` : live.devToken ? ' · dev key' : ''}`}
					data-slot="site-who"
				>
					<span class="text-xs">Site</span>
					<span class="text-foreground truncate">{shortHost(live.siteUrl)}</span>
					{#if live.session}
						<span aria-hidden="true">·</span><span class="truncate">{live.session.login}</span>
					{:else if live.devToken}
						<span aria-hidden="true">·</span><span class="text-xs">Dev key</span>
					{/if}
				</a>
			{/if}
			<Button size="icon" variant="ghost" onclick={toggleScheme} aria-label={dark ? 'Switch to light' : 'Switch to dark'} title={dark ? 'Switch to light' : 'Switch to dark'}>
				{#if dark}
					<Moon aria-hidden="true" />
				{:else}
					<Sun aria-hidden="true" />
				{/if}
			</Button>
		</div>
	</header>
	<DemoBanner />
	<main class="flex min-h-0 flex-1 flex-col">
		{@render children()}
	</main>
</div>
