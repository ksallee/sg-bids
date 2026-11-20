<!--
	The signed-in pages wait here for the session: a centred loading state while it is checked, then
	the page. Not signed in, the person goes to connect, which brings them back to this page after
	the sign-in (`connectHref`, `safeNext`). Signed in, connect is never a step on the way.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import PageState from './page-state.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { prepareLive } from '$lib/live';
	import { connectHref } from '$lib/pure/routes';

	let { children }: { children: Snippet } = $props();

	const here = () => `${page.url.pathname}${page.url.search}`;
	const ready = prepareLive().then((state) => {
		if (state.problem) void goto(connectHref(here()), { replaceState: true });
		return state;
	});
</script>

{#await ready}
	<PageState state="loading" title="Checking your Flow PT session…" />
{:then state}
	{#if state.problem}
		<PageState state="loading" title="Taking you to sign in…" />
	{:else}
		{@render children()}
	{/if}
{:catch failure}
	<PageState state="error" title="Could not reach Flow PT" line={failure.message}>
		{#snippet action()}
			<Button variant="outline" onclick={() => location.reload()}>Try again</Button>
			<Button href={connectHref(here())}>Connect</Button>
		{/snippet}
	</PageState>
{/await}
