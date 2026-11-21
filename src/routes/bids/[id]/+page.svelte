<!-- A bid, in the editor (`$lib/app/bid/bid-page`). -->
<script lang="ts">
	import { page } from '$app/state';
	import BidPage from '$lib/app/bid/bid-page.svelte';
</script>

<BidPage bidId={page.params.id ?? null} />
