<!--
	Step 7, Review: the draft as a vendor will get it, set as the sheet itself, beside a rail with
	the counts, what still blocks it, and where the draft is kept. Omitted items are left off the
	sheet and counted in the rail. View and counts from `$lib/pure/request`.
-->
<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Thumbnail from '$lib/components/thumbnail.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { currencyLabel } from '$lib/pure/currencies';
	import { blockers, summarize, vendorView } from '$lib/pure/request';
	import type { StepKey } from '$lib/pure/steps';
	import { today } from '$lib/app/today';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, onPick }: { builder: Builder; onPick: (key: StepKey) => void } = $props();

	const request = $derived(builder.request());
	const view = $derived(vendorView(request));
	const counts = $derived(summarize(request));
	const blocked = $derived(blockers(builder.state, today()));
	const h = $derived(view.header);
	const number = new Intl.NumberFormat();
	const dayFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
	const day = (value?: string) => (value ? dayFormat.format(new Date(`${value}T00:00:00Z`)) : null);

	const FIX: Record<string, StepKey> = { 'Pick a project.': 'project', 'Pick at least one shot or asset.': 'shots', 'Every item is omitted.': 'items' };

	let confirming = $state(false);
	async function startOver(): Promise<void> {
		await builder.discard();
		confirming = false;
		onPick('project');
	}

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

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div class="grid w-full items-start gap-6 px-6 py-6 xl:grid-cols-[16rem_minmax(0,1fr)]">
		<aside class="flex flex-col gap-5 xl:sticky xl:top-6" aria-label="Draft status" data-slot="review-rail">
			<dl class="grid grid-cols-2 gap-x-4 gap-y-3 xl:grid-cols-1">
				<div>
					<dt class="text-muted-foreground text-xs">Shots going out</dt>
					<dd class="text-2xl font-semibold tabular-nums">{counts.shots}</dd>
					{#if counts.shotsOmitted > 0}<dd class="text-muted-foreground text-xs">{counts.shotsOmitted} omitted</dd>{/if}
				</div>
				<div>
					<dt class="text-muted-foreground text-xs">Assets going out</dt>
					<dd class="text-2xl font-semibold tabular-nums">{counts.assets}</dd>
					{#if counts.assetsOmitted > 0}<dd class="text-muted-foreground text-xs">{counts.assetsOmitted} omitted</dd>{/if}
				</div>
				<div>
					<dt class="text-muted-foreground text-xs">Frames</dt>
					<dd class="text-lg font-semibold tabular-nums">{number.format(counts.frames)}</dd>
					{#if counts.shotsWithoutFrames > 0}<dd class="text-muted-foreground text-xs">{counts.shotsWithoutFrames} shots have no count</dd>{/if}
				</div>
				<div>
					<dt class="text-muted-foreground text-xs">Sequences</dt>
					<dd class="text-lg font-semibold tabular-nums">{counts.sequences}</dd>
				</div>
			</dl>

			{#if blocked.length > 0}
				<div class="border-warning/60 bg-warning/10 flex flex-col gap-2 rounded-lg border p-3 text-sm" role="alert" data-slot="review-blockers">
					<p class="flex items-center gap-2 font-medium"><TriangleAlert class="text-warning size-4" aria-hidden="true" />Not ready yet</p>
					<ul class="flex flex-col gap-1">
						{#each blocked as line (line)}
							<li>
								<button type="button" class="text-left underline decoration-current/40 underline-offset-2 hover:decoration-current" onclick={() => onPick(FIX[line] ?? 'details')}>{line}</button>
							</li>
						{/each}
					</ul>
				</div>
			{:else}
				<p class="flex items-center gap-2 text-sm" data-slot="review-ready"><CircleCheck class="text-success size-4" aria-hidden="true" />The draft is complete.</p>
			{/if}

			<p class="text-muted-foreground text-xs">Saved in this tab as you go. Sending to vendors comes in a later version.</p>
			<div class="flex flex-wrap gap-2">
				{#if confirming}
					<Button size="sm" variant="destructive" onclick={() => void startOver()}>Discard the draft</Button>
					<Button size="sm" variant="ghost" onclick={() => (confirming = false)}>Keep it</Button>
				{:else}
					<Button size="sm" variant="ghost" onclick={() => (confirming = true)}>Start over</Button>
				{/if}
			</div>
		</aside>

		<article class="bg-card text-card-foreground mx-auto flex w-full max-w-5xl flex-col rounded-lg border shadow-xs" aria-label="The request as vendors see it" data-slot="vendor-sheet">
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
					<p class="text-sm">
						Bid material: <a class="underline decoration-current/40 underline-offset-2 hover:decoration-current break-all" href={h.materialLink} target="_blank" rel="noopener">{h.materialLink}</a>
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
										<td class="py-2 pr-3">
											<div class="flex items-start gap-2.5">
												<Thumbnail src={s.thumbnail ?? null} alt="" size="sm" entityType="Shot" />
												<span class="font-mono text-xs font-medium">{s.code}</span>
											</div>
										</td>
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
	</div>
</div>
