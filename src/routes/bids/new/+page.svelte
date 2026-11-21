<!--
	A new bid, in the editor. An address from before bids came first (`/bids/new?id=<request>`) goes to
	the send flow of that request.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import BidPage from '$lib/app/bid/bid-page.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import { movedRequestPath } from '$lib/pure/routes';

	const moved = $derived(movedRequestPath(page.url.pathname, page.url.search));
	$effect(() => {
		if (moved) void goto(moved, { replaceState: true });
	});
</script>

{#if moved}
	<PageState state="loading" title="Opening the request…" />
{:else}
	<BidPage bidId={null} />
{/if}
