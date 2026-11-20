<!--
	A bid request as a vendor gets it: the header set as the sheet's head, the assumptions, then the
	shots and assets that are in. Omitted items are left off. Used by the review step and by the
	request's page. View and counts from `$lib/pure/request`.
-->
<script lang="ts">
	import { currencyLabel } from '$lib/pure/currencies';
	import type { BidRequest } from '$lib/pure/model';
	import { summarize, vendorView } from '$lib/pure/request';
	import { safeHref } from '$lib/pure/safe-href';

	let { request }: { request: BidRequest } = $props();

	const view = $derived(vendorView(request));
	const counts = $derived(summarize(request));
	const h = $derived(view.header);
	const number = new Intl.NumberFormat();
	const dayFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
	const day = (value?: string) => (value ? dayFormat.format(new Date(`${value}T00:00:00Z`)) : null);
	const facts = $derived(
		[
			['Bids due', day(h.dueDate)],
			['Base currency', currencyLabel(h.baseCurrency)],
			['Turnover', day(h.turnoverDate)],
			['Delivery', day(h.deliveryDate)],
			['Delivery format', h.deliveryFormat ?? null]
		].filter((pair): pair is [string, string] => pair[1] !== null)
	);
</script>

	<article class="bg-card text-card-foreground flex w-full flex-col rounded-lg border shadow-xs" aria-label="The request as vendors see it" data-slot="vendor-sheet">
		<header class="border-border flex flex-col gap-5 border-b p-6 sm:p-8">
			<div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
				<p class="text-muted-foreground text-sm">{h.project || 'No project'}</p>
				<p class="text-muted-foreground text-sm">
					{#if h.code}<span class="text-foreground font-mono text-xs">{h.code}</span>{/if}
					Round {h.round}
				</p>
			</div>
			<h2 class="text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl">{h.title ?? 'Untitled request'}</h2>
			<p class="text-sm">
				{counts.shots}
				{counts.shots === 1 ? 'shot' : 'shots'}, {number.format(counts.frames)} frames, {counts.assets}
				{counts.assets === 1 ? 'asset' : 'assets'}.
			</p>
			{#if facts.length > 0}
				<dl class="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
					{#each facts as [label, value] (label)}
						<div class="flex flex-col gap-0.5">
							<dt class="text-muted-foreground text-xs">{label}</dt>
							<dd class="text-sm font-medium">{value}</dd>
						</div>
					{/each}
				</dl>
			{/if}
			{#if h.materialLink}
				{@const href = safeHref(h.materialLink)}
				<p class="text-sm">
					Bid material:
					{#if href}<a class="underline decoration-current/40 underline-offset-2 hover:decoration-current break-all" {href} target="_blank" rel="noopener noreferrer">{h.materialLink}</a
						>{:else}<span class="break-all">{h.materialLink}</span>{/if}
				</p>
			{/if}
		</header>

		{#if h.assumptions.length > 0}
			<section class="border-border flex flex-col gap-2 border-b p-6 sm:px-8" aria-label="Assumptions">
				<h3 class="text-sm font-semibold">Assumptions</h3>
				<ol class="flex max-w-[70ch] list-decimal flex-col gap-1 pl-5 text-sm">
					{#each h.assumptions as line, i (i)}<li>{line}</li>{/each}
				</ol>
			</section>
		{/if}

		<section class="flex flex-col gap-2 p-6 sm:px-8" aria-label="Shots">
			<h3 class="text-sm font-semibold">Shots <span class="text-muted-foreground text-xs font-normal tabular-nums">{view.shots.length}</span></h3>
			{#if view.shots.length === 0}
				<p class="text-muted-foreground text-sm">No shots in this request.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full min-w-[44rem] text-sm" data-slot="sheet-shots">
						<thead>
							<tr class="text-muted-foreground border-border border-b text-left text-xs">
								<th class="py-2 pr-3 font-medium">Shot</th>
								<th class="px-3 py-2 font-medium">Where</th>
								<th class="px-3 py-2 text-right font-medium">Frames</th>
								<th class="px-3 py-2 font-medium">Difficulty</th>
								<th class="py-2 pl-3 font-medium">Description</th>
							</tr>
						</thead>
						<tbody>
							{#each view.shots as s (s.id)}
								<tr class="border-border border-b align-top last:border-0">
									<td class="py-2 pr-3 font-mono text-xs font-medium">{s.code}</td>
									<td class="text-muted-foreground px-3 py-2 text-xs">{[s.episode, s.sequence].filter(Boolean).join(' / ')}</td>
									<td class="px-3 py-2 text-right tabular-nums">{s.frames ?? ''}</td>
									<td class="px-3 py-2">{s.difficulty ?? ''}</td>
									<td class="py-2 pl-3">
										<p class="max-w-[60ch]">{s.description ?? ''}</p>
										{#if s.notes}<p class="text-muted-foreground mt-1 max-w-[60ch] text-xs">Note: {s.notes}</p>{/if}
										{#if s.assetIds.length > 0}<p class="text-muted-foreground mt-1 text-xs">Uses {s.assetIds.length} {s.assetIds.length === 1 ? 'asset' : 'assets'} below</p>{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="border-border flex flex-col gap-2 border-t p-6 sm:px-8" aria-label="Assets">
			<h3 class="text-sm font-semibold">Assets <span class="text-muted-foreground text-xs font-normal tabular-nums">{view.assets.length}</span></h3>
			{#if view.assets.length === 0}
				<p class="text-muted-foreground text-sm">No assets in this request.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full min-w-[40rem] text-sm" data-slot="sheet-assets">
						<thead>
							<tr class="text-muted-foreground border-border border-b text-left text-xs">
								<th class="py-2 pr-3 font-medium">Asset</th>
								<th class="px-3 py-2 font-medium">Type</th>
								<th class="px-3 py-2 text-right font-medium">Used in</th>
								<th class="px-3 py-2 font-medium">Difficulty</th>
								<th class="py-2 pl-3 font-medium">Description</th>
							</tr>
						</thead>
						<tbody>
							{#each view.assets as a (a.id)}
								<tr class="border-border border-b align-top last:border-0">
									<td class="py-2 pr-3 font-mono text-xs font-medium">{a.name}</td>
									<td class="px-3 py-2">{a.type ?? ''}</td>
									<td class="px-3 py-2 text-right tabular-nums">{a.timesUsed ?? 0}</td>
									<td class="px-3 py-2">{a.difficulty ?? ''}</td>
									<td class="py-2 pl-3">
										<p class="max-w-[60ch]">{a.description ?? ''}</p>
										{#if a.notes}<p class="text-muted-foreground mt-1 max-w-[60ch] text-xs">Note: {a.notes}</p>{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	</article>
