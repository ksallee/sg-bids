<!--
	What production asks for, as it froze it: the title, the bids this vendor answers with their rows,
	who, which cut, when, how to deliver, the material, and production's own assumptions. Read only.
	The facts are `$lib/pure/vendor-view` (`requestFacts`): the bids are always there, so the box is
	never empty.
-->
<script lang="ts">
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { safeHref } from '$lib/pure/safe-href';
	import { requestFacts, type VendorRequestView } from '$lib/pure/vendor-view';

	let { request, day }: { request: VendorRequestView; day: (text: string) => string } = $props();

	const materialHref = $derived(safeHref(request.header.materialLink));
	const facts = $derived(requestFacts(request, day));
</script>

{#if facts.length > 0 || request.header.assumptions.length > 0 || materialHref}
	<div class="bg-card flex flex-col gap-4 rounded-lg border p-4" data-slot="request-summary">
		{#if facts.length > 0}
			<dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
				{#each facts as [label, value] (label)}
					<div class={label === 'Bids' || label === 'Bid' ? 'col-span-2 flex min-w-0 flex-col sm:col-span-3' : 'flex min-w-0 flex-col'}>
						<dt class="text-muted-foreground text-xs">{label}</dt>
						<dd class={label === 'Bids' || label === 'Bid' ? 'text-pretty' : 'truncate'} title={value}>{value}</dd>
					</div>
				{/each}
			</dl>
		{/if}
		{#if request.header.assumptions.length > 0}
			<div class="flex flex-col gap-1">
				<p class="text-muted-foreground text-xs">Production assumes</p>
				<ul class="flex list-disc flex-col gap-0.5 pl-5 text-sm">
					{#each request.header.assumptions as line, i (i)}<li>{line}</li>{/each}
				</ul>
			</div>
		{/if}
		{#if materialHref}
			<a
				class="text-primary inline-flex w-fit items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
				href={materialHref}
				target="_blank"
				rel="noopener noreferrer">Open the bid material <ExternalLink class="size-3.5" aria-hidden="true" /></a
			>
		{/if}
	</div>
{:else}
	<p class="text-muted-foreground text-sm" data-slot="request-summary-empty">Production gave no more than the rows below.</p>
{/if}
