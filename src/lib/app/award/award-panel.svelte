<!--
	The award once it is in Flow PT, on the request, compare and publish pages: who won what and the
	totals, when and by whom, a link to each Bid in Flow PT, and Undo award. A run or an undo that
	stopped part way says what landed and offers to go on. The undo runs from this browser
	(`./run.ts`); the words come from `$lib/pure/award-view` and `award-record`.
-->
<script lang="ts">
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Notice from '$lib/app/notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { bidLinks, leftCounts, type Publication } from '$lib/pure/award-record';
	import { undoLine } from '$lib/pure/award-view';
	import { formatAmount } from '$lib/pure/display';
	import type { BidRequest } from '$lib/pure/model';
	import { undoPublished } from './run';

	let {
		projectId,
		request,
		publication,
		siteUrl,
		onChange,
		resume = true
	}: {
		projectId: number;
		request: Pick<BidRequest, 'id' | 'vendors'>;
		publication: Publication;
		siteUrl: string;
		/** After an undo: the record left, or null. */
		onChange: (next: Publication | null) => void;
		/** Show the way back to the publish page for a run that stopped. */
		resume?: boolean;
	} = $props();

	let confirming = $state(false);
	let undoing = $state(false);
	let failure = $state<string | null>(null);

	const links = $derived(bidLinks(siteUrl, publication.site, publication.written, request));
	const sum = $derived(publication.summary);
	const left = $derived(leftCounts(publication.written));
	const when = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	const by = $derived(publication.publishedBy.name ?? (publication.publishedBy.type === 'ApiUser' ? 'the dev key' : `person ${publication.publishedBy.id}`));

	const title = $derived(
		publication.state === 'published' ? 'Awarded in Flow PT' : publication.state === 'partial' ? 'Publishing stopped part way' : 'The undo stopped part way'
	);

	async function undo(): Promise<void> {
		undoing = true;
		failure = null;
		try {
			const next = await undoPublished(projectId, request.id, publication);
			confirming = false;
			onChange(next);
		} catch (e) {
			failure = e instanceof Error ? e.message : String(e);
		} finally {
			undoing = false;
		}
	}
</script>

<section class="flex flex-col gap-4 rounded-lg border p-4" data-slot="award-panel" data-state={publication.state} aria-label="The award">
	<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<h2 class="text-base font-semibold">{title}</h2>
		<p class="text-muted-foreground text-sm">
			{publication.state === 'published' ? 'Published' : 'Last run'}
			{when.format(new Date(publication.updatedAt))} by {by}.
		</p>
	</div>

	{#if publication.state === 'partial'}
		<Notice tone="warning">
			In Flow PT now: {left.bids} Bids, {left.lines} Bid Lines, {left.groups} Groups added. {publication.error ? `It stopped at: ${publication.error}` : ''}
			{publication.problems.length ? `${publication.problems.length} writes read back different from what was sent.` : ''} Publish again to finish it, or undo what landed.
		</Notice>
	{:else if publication.state === 'undo_partial'}
		<Notice tone="warning">
			Still in Flow PT: {left.bids} Bids, {left.lines} Bid Lines, {left.groups} Groups. {publication.error ?? ''} Undo again to take them back.
		</Notice>
	{/if}

	{#if sum && publication.state !== 'undo_partial'}
		<table class="w-full max-w-3xl text-sm" data-slot="award-summary">
			<thead>
				<tr class="text-muted-foreground border-b text-left text-xs">
					<th class="py-1.5 pr-3 font-medium">Vendor</th>
					<th class="px-3 py-1.5 text-right font-medium">Shots</th>
					<th class="px-3 py-1.5 text-right font-medium">Assets</th>
					<th class="px-3 py-1.5 text-right font-medium">Split</th>
					<th class="py-1.5 pl-3 text-right font-medium">Awarded, {sum.baseCurrency}</th>
				</tr>
			</thead>
			<tbody class="tabular-nums">
				{#each sum.vendors as v (v.vendorId)}
					<tr class="border-b">
						<td class="py-2 pr-3 font-medium">{v.name}</td>
						<td class="px-3 py-2 text-right">{v.shots}</td>
						<td class="px-3 py-2 text-right">{v.assets}</td>
						<td class="text-muted-foreground px-3 py-2 text-right">{v.split || ''}</td>
						<td class="py-2 pl-3 text-right">{formatAmount(v.total, undefined, false)}</td>
					</tr>
				{/each}
				<tr>
					<td class="py-2 pr-3 font-semibold">All</td>
					<td class="px-3 py-2 text-right">{sum.shots}</td>
					<td class="px-3 py-2 text-right">{sum.assets}</td>
					<td class="text-muted-foreground px-3 py-2 text-right">{sum.split || ''}</td>
					<td class="py-2 pl-3 text-right font-semibold">{formatAmount(sum.total, undefined, false)}</td>
				</tr>
			</tbody>
		</table>
		<p class="text-muted-foreground text-xs">The awarded shots and assets at their shares. Non-shot costs stay on each Bid's total in Flow PT.</p>
	{/if}

	{#if links.length}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-slot="bid-links">
			<span class="text-muted-foreground">Bids in Flow PT:</span>
			{#each links as link (link.id)}
				<a class="hover:text-foreground text-info inline-flex items-center gap-1 underline-offset-4 hover:underline" href={link.url} target="_blank" rel="noreferrer">
					{link.name}<ExternalLink class="size-3" aria-hidden="true" />
				</a>
			{/each}
		</div>
	{/if}

	{#if publication.exposure}
		<p class="text-muted-foreground text-xs" data-slot="exposure-recorded">
			Published anyway while the Vendor role {publication.exposure.state === 'exposed' ? 'could read Bid or Bid Line' : 'had rights the app could not read'}. Recorded {when.format(
				new Date(publication.exposure.acceptedAt)
			)}.
		</p>
	{/if}

	{#if failure}<Notice tone="destructive">{failure}</Notice>{/if}

	{#if confirming}
		<div class="bg-muted/40 flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm" role="group" aria-label="Undo the award">
			<p class="min-w-0 flex-1">{undoLine(publication.written)}</p>
			<Button variant="outline" size="sm" disabled={undoing} onclick={() => (confirming = false)}>Keep the award</Button>
			<Button variant="destructive" size="sm" disabled={undoing} onclick={() => void undo()} data-slot="undo-confirm">
				{undoing ? 'Undoing…' : 'Undo award'}
			</Button>
		</div>
	{:else}
		<div class="flex flex-wrap gap-2">
			<Button variant="outline" size="sm" onclick={() => (confirming = true)} data-slot="undo">
				<Undo2 class="size-3.5" />{publication.state === 'undo_partial' ? 'Undo again' : 'Undo award'}
			</Button>
			{#if resume && publication.state === 'partial'}
				<Button size="sm" href={`/bids/${request.id}/publish`}>Publish again</Button>
			{/if}
		</div>
	{/if}
</section>
