<!--
	The bid's totals beside the form, live as you type: the total large, how many items carry a
	price, the breakdown, the rebate estimate, whether your work is saved, and the one next step.
-->
<script lang="ts" module>
	export type SaveState = { kind: 'idle' | 'saved' | 'saving' | 'unsaved' | 'error'; message?: string };
	export type Stage = 'draft' | 'submitted' | 'withdrawn' | 'closed';
</script>

<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CloudOff from '@lucide/svelte/icons/cloud-off';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import type { FormResult, FormTotals } from '$lib/pure/bid-form';
	import { format, type Money } from '$lib/pure/money';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	let {
		totals,
		result,
		baseCurrency,
		locale,
		save,
		stage,
		stamp,
		busy,
		onsubmit,
		onrevise,
		onwithdraw,
		class: className
	}: {
		totals: FormTotals;
		result: FormResult;
		baseCurrency: string;
		locale: string;
		save: SaveState;
		stage: Stage;
		/** When it was submitted or withdrawn, ready to read. */
		stamp: string | null;
		busy: boolean;
		onsubmit: () => void;
		onrevise: () => void;
		onwithdraw: () => void;
		class?: string;
	} = $props();

	const money = (amount: Money) => format(amount, locale);
	const all = $derived(result.counts.priced + result.counts.excluded + result.counts.open);
	const done = $derived(all === 0 ? 0 : Math.round(((result.counts.priced + result.counts.excluded) / all) * 100));
	const rows = $derived([
		{ label: 'Shots and assets', amount: totals.totals.lines.bid },
		{ label: 'Other costs', amount: totals.totals.costs.bid },
		{ label: 'Subtotal', amount: totals.totals.subtotal.bid, strong: true },
		...(totals.totals.discount.bid.minor !== 0 ? [{ label: 'Discount', amount: { ...totals.totals.discount.bid, minor: -totals.totals.discount.bid.minor } }] : []),
		...(totals.totals.tax.bid.minor !== 0 ? [{ label: 'Tax', amount: totals.totals.tax.bid }] : [])
	]);
</script>

<div class={cn('flex flex-col gap-6 p-5', className)} data-slot="totals-rail">
	{#if stage === 'draft'}
		<p class="text-muted-foreground flex items-center gap-1.5 text-xs" role="status" aria-live="polite" data-save={save.kind}>
			{#if save.kind === 'saving'}
				<LoaderCircle class="size-3.5 motion-safe:animate-spin" aria-hidden="true" />Saving
			{:else if save.kind === 'idle'}
				Your work saves as you go.
			{:else if save.kind === 'saved'}
				<CircleCheck class="text-success size-3.5" aria-hidden="true" />All changes saved
			{:else if save.kind === 'error'}
				<CloudOff class="text-destructive size-3.5" aria-hidden="true" /><span class="text-destructive">{save.message ?? 'Not saved.'} Trying again.</span>
			{:else}
				<span class="bg-warning size-2 rounded-full" aria-hidden="true"></span>Changes not saved yet
			{/if}
		</p>
	{/if}

	<div class="flex flex-col gap-1">
		<p class="text-muted-foreground text-sm">Your total</p>
		<p class="text-3xl leading-none font-semibold tracking-tight tabular-nums" data-slot="grand-total">{money(totals.totals.grand.bid)}</p>
		{#if totals.totals.grand.bid.currency !== baseCurrency}
			<p class="text-muted-foreground mt-1 text-xs">Production converts it to {baseCurrency} at a rate it sets. You are not asked for one.</p>
		{/if}
	</div>

	<div class="flex flex-col gap-1.5">
		<div class="bg-muted h-1.5 overflow-hidden rounded-full border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={done} aria-label="Items answered">
			<div class="bg-primary h-full rounded-full transition-[width] motion-reduce:transition-none" style:width={`${done}%`}></div>
		</div>
		<p class="text-muted-foreground text-xs">
			{result.counts.priced} of {all} priced{#if result.counts.excluded > 0}, {result.counts.excluded} excluded{/if}.
		</p>
	</div>

	<dl class="flex flex-col text-sm">
		{#each rows as row (row.label)}
			<div class={cn('flex items-baseline justify-between gap-3 py-1', row.strong && 'border-t pt-2 font-medium')}>
				<dt class={row.strong ? '' : 'text-muted-foreground'}>{row.label}</dt>
				<dd class="tabular-nums">{money(row.amount)}</dd>
			</div>
		{/each}
		<div class="flex items-baseline justify-between gap-3 border-t pt-2 font-semibold">
			<dt>Total</dt>
			<dd class="tabular-nums">{money(totals.totals.grand.bid)}</dd>
		</div>
	</dl>

	{#if totals.rebate}
		<div class="flex flex-col gap-1 text-sm" data-slot="rebate-estimate">
			<div class="flex items-baseline justify-between gap-3">
				<span class="text-muted-foreground">Rebate, estimated</span>
				<span class="tabular-nums">{totals.rebate.rebate ? money(totals.rebate.rebate.bid) : 'Unknown'}</span>
			</div>
			<div class="flex items-baseline justify-between gap-3">
				<span class="text-muted-foreground">After rebate</span>
				<span class="tabular-nums">{totals.rebate.afterRebate ? money(totals.rebate.afterRebate.bid) : 'Unknown'}</span>
			</div>
			<p class="text-muted-foreground text-xs">An estimate. You quote gross. Rates change.</p>
		</div>
	{/if}

	<div class="flex flex-col gap-2">
		{#if stage === 'draft'}
			<Button size="lg" class="w-full" disabled={busy || result.blockers.length > 0} onclick={onsubmit}>Review and submit</Button>
			{#each result.blockers as blocker (blocker)}<p class="text-muted-foreground text-xs">{blocker}</p>{/each}
		{:else if stage === 'submitted'}
			<p class="text-sm"><span class="font-medium">Submitted</span>{stamp ? ` ${stamp}` : ''}. Production can see it.</p>
			<Button size="lg" class="w-full" disabled={busy} onclick={onrevise}>Revise</Button>
			<Button variant="outline" class="w-full" disabled={busy} onclick={onwithdraw}>Withdraw</Button>
			<p class="text-muted-foreground text-xs">Revise opens a copy to change. Production sees this one until you submit the next.</p>
		{:else if stage === 'withdrawn'}
			<p class="text-sm"><span class="font-medium">Withdrawn</span>{stamp ? ` ${stamp}` : ''}. Production sees it as withdrawn.</p>
			<Button size="lg" class="w-full" disabled={busy} onclick={onrevise}>Start a new version</Button>
		{:else}
			<p class="text-sm">This request is closed. The bid can no longer change.</p>
		{/if}
	</div>
</div>
