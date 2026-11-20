<!--
	Asked when a vendor link opens in a browser that holds another vendor's live link. Names both, so
	a link one vendor sends another cannot take over the bid on screen. Each button posts to this
	page (`./+page.server.ts`); only a post from this site switches.
-->
<script lang="ts">
	import Users from '@lucide/svelte/icons/users';
	import PageState from '$lib/app/page-state.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Another bid is open · SG Bids</title>
	<meta name="referrer" content="no-referrer" />
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<PageState state="empty" icon={Users} title="Another bid is open" line={`This link is for ${data.next}. You have ${data.current}'s bid open.`}>
	{#snippet action()}
		<div class="flex flex-wrap justify-center gap-2">
			<form method="POST" action="?/keep">
				<Button type="submit" variant="outline">Keep {data.current}'s bid</Button>
			</form>
			<form method="POST" action="?/switch">
				<Button type="submit">Open {data.next}'s bid</Button>
			</form>
		</div>
	{/snippet}
</PageState>
