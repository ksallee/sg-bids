<!--
	The frame of every screen: one h-12 header (wordmark, Requests, the demo badge, the site and
	who reads it, the scheme switch), then the page, which takes the rest and scrolls on its own. The
	header holds who and where; the page holds what this screen is about. On the vendor's side
	(`vendor`) there is no site and no person: the vendor has no Flow PT sign-in, so the header holds
	the wordmark, the demo badge and the scheme switch only.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import { isDark, setMode } from '$lib/theme';
	import { prepareLive, type LiveState } from '$lib/live';
	import { shortHost } from '$lib/pure/site';
	import DemoBanner from './demo-banner.svelte';
	import Wordmark from './wordmark.svelte';

	let { children, vendor = false }: { children: Snippet; vendor?: boolean } = $props();

	const under = (prefix: string) => page.url.pathname === prefix || page.url.pathname.startsWith(`${prefix}/`);
	const NAV = [{ href: '/requests', label: 'Requests', slot: 'nav-requests' }] as const;
	let live = $state<LiveState | null>(null);
	// The public pages render at build too (`(public)/+layout.ts`): nothing there reads the browser.
	// svelte-ignore state_referenced_locally
	if (!vendor && browser) void prepareLive().then((value) => (live = value));

	// Dark until the browser says otherwise, as `app.html` starts, so a prerendered page hydrates
	// onto the same markup it was built with.
	let dark = $state(true);

	// In `system` mode the OS can flip the scheme under the page; the icon and label follow it.
	$effect(() => {
		dark = isDark();
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
	<header class="border-border bg-background flex h-12 shrink-0 items-center gap-3 border-b px-3 sm:gap-4 sm:px-6" data-slot="app-header">
		{#if vendor}
			<span class="shrink-0 text-sm"><Wordmark /></span>
		{:else}
			<a href="/" class="focus-visible:ring-ring shrink-0 rounded-md text-sm outline-none focus-visible:ring-2" aria-label="SG Bids, home">
				<Wordmark />
			</a>
			<nav class="hidden items-center gap-1 text-sm sm:flex" aria-label="App">
				{#each NAV as item (item.href)}
					{@const on = under(item.href)}
					<a
						href={item.href}
						class={cn('focus-visible:ring-ring rounded-md px-2 py-1 outline-none focus-visible:ring-2', on ? 'text-foreground bg-accent font-medium' : 'text-muted-foreground hover:text-foreground')}
						aria-current={on ? 'page' : undefined}
						data-slot={item.slot}>{item.label}</a
					>
				{/each}
			</nav>
		{/if}
		<DemoBanner />

		<div class="flex-1"></div>

		<div class="flex shrink-0 items-center gap-1 text-sm sm:gap-2">
			{#if !vendor}
				<a
					href="/how"
					class="text-muted-foreground hover:text-foreground focus-visible:ring-ring hidden rounded-md px-1.5 py-1 outline-none focus-visible:ring-2 md:inline"
					data-slot="how-link">How it works</a
				>
			{/if}
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
	<main class="flex min-h-0 flex-1 flex-col">
		{@render children()}
	</main>
</div>
