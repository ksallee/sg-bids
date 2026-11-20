<!--
	What production asks for, as it froze it: who, which cut, when, how to deliver, the material,
	and production's own assumptions. Read only.
-->
<script lang="ts">
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { safeHref } from '$lib/pure/safe-href';
	import type { VendorRequestView } from '$lib/pure/vendor-view';

	let { request, day }: { request: VendorRequestView; day: (text: string) => string } = $props();

	const materialHref = $derived(safeHref(request.header.materialLink));

	const facts = $derived(
		[
			['Studio', request.header.studio],
			['Director', request.header.director],
			['Client supervisor', request.header.clientSupervisor],
			['Client producer', request.header.clientProducer],
			['Cut', request.header.cutVersion],
			['Turnover', request.header.turnoverWeek],
			['Delivery', request.header.deliveryDate ? day(request.header.deliveryDate) : undefined],
			['Format', request.header.deliveryFormat]
		].filter((fact): fact is [string, string] => typeof fact[1] === 'string' && fact[1] !== '')
	);
</script>

<div class="bg-card flex flex-col gap-4 rounded-lg border p-4" data-slot="request-summary">
	{#if facts.length > 0}
		<dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
			{#each facts as [label, value] (label)}
				<div class="flex min-w-0 flex-col">
					<dt class="text-muted-foreground text-xs">{label}</dt>
					<dd class="truncate" title={value}>{value}</dd>
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
