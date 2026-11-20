<!--
	A section of the bid form: a title, an optional note beside it, then its content. The id is the
	anchor the totals rail links to.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { id, title, note, children }: { id: string; title: string; note?: string; children: Snippet } = $props();
</script>

<section {id} class="flex scroll-mt-4 flex-col gap-3" aria-labelledby={`${id}-title`} data-slot="vendor-section">
	<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
		<h2 id={`${id}-title`} class="text-sm font-semibold">{title}</h2>
		{#if note}<p class="text-muted-foreground text-xs">{note}</p>{/if}
	</div>
	{@render children()}
</section>
