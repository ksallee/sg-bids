<!--
	Where the work is done, for a tax rebate estimate. Several places per bid, each with its share of
	the work and its rate. Picking a place fills its usual rate and base from
	`$lib/pure/rebate-defaults`, shown with the source and the day it was checked. Stacked rates are
	listed, never added. Every figure is an estimate: you quote gross.
-->
<script lang="ts">
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { vendorControlId, type BidForm, type SplitForm } from '$lib/pure/bid-form';
	import { format } from '$lib/pure/money';
	import type { RebateEstimate } from '$lib/pure/rebate';
	import { REBATE_DEFAULTS, rebateDefault } from '$lib/pure/rebate-defaults';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	let {
		form = $bindable(),
		errors,
		estimate,
		locale,
		day,
		readOnly
	}: {
		form: BidForm;
		errors: Readonly<Record<string, string>>;
		estimate: RebateEstimate | null;
		locale: string;
		day: (text: string) => string;
		readOnly: boolean;
	} = $props();

	const select =
		'border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2 text-sm outline-none focus-visible:ring-3';
	const CLAIMED = { production: 'Usually claimed by production.', vendor: 'Usually claimed by the vendor.', either: 'Claimed by production or the vendor.' };

	function place(split: SplitForm, code: string): void {
		split.jurisdiction = code;
		const known = rebateDefault(code);
		if (!known) return;
		split.rate = known.rates.find((r) => r.kind === 'base')?.rate ?? split.rate;
		split.base = known.base.kind;
		split.contractPercent = known.base.kind === 'contract' ? known.base.percent : '';
	}

	function add(): void {
		const covered = form.rebate.reduce((total, s) => total + (Number(s.workPercent.replace(',', '.')) || 0), 0);
		form.rebate.push({ jurisdiction: '', workPercent: String(Math.max(0, 100 - covered)), rate: '', base: 'all', contractPercent: '' });
	}

	const custom = (code: string) => code !== '' && !rebateDefault(code);
	const perSplit = $derived(estimate && estimate.splits.length === form.rebate.length ? estimate.splits : null);
</script>

<div class="flex flex-col gap-3">
	{#each form.rebate as split, i (i)}
		{@const known = rebateDefault(split.jurisdiction)}
		{@const at = `split:${i}`}
		<div class="bg-card flex flex-col gap-3 rounded-lg border p-3" data-slot="rebate-split">
			<div class="grid grid-cols-2 items-start gap-3 sm:grid-cols-[minmax(0,1.4fr)_7rem_7rem_minmax(0,1.2fr)_2rem]">
				<label class="col-span-2 flex flex-col gap-1 sm:col-span-1">
					<span class="text-xs font-medium">Where</span>
					{#if readOnly}
						<span class="text-sm">{known?.label ?? split.jurisdiction}</span>
					{:else}
						<select id={vendorControlId(`${at}:jurisdiction`)} class={select} value={custom(split.jurisdiction) ? 'other' : split.jurisdiction} onchange={(e) => place(split, e.currentTarget.value === 'other' ? ' ' : e.currentTarget.value)} aria-invalid={!!errors[`${at}:jurisdiction`]}>
							<option value="" disabled>Pick a place</option>
							{#each REBATE_DEFAULTS as entry (entry.code)}<option value={entry.code}>{entry.label}</option>{/each}
							<option value="other">Somewhere else</option>
						</select>
						{#if custom(split.jurisdiction)}
							<Input bind:value={split.jurisdiction} placeholder="Country or region code, like DE or US-GA" aria-label="Country or region code" class="mt-1" />
						{/if}
						{#if errors[`${at}:jurisdiction`]}<p class="text-destructive text-xs">{errors[`${at}:jurisdiction`]}</p>{/if}
					{/if}
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-xs font-medium">Share of work</span>
					{#if readOnly}<span class="text-sm tabular-nums">{split.workPercent}%</span>{:else}
						<div class="relative">
							<Input id={vendorControlId(`${at}:workPercent`)} bind:value={split.workPercent} inputmode="decimal" aria-invalid={!!errors[`${at}:workPercent`]} class="pr-6 text-right tabular-nums" />
							<span class="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs">%</span>
						</div>
						{#if errors[`${at}:workPercent`]}<p class="text-destructive text-xs">{errors[`${at}:workPercent`]}</p>{/if}
					{/if}
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-xs font-medium">Rate</span>
					{#if readOnly}<span class="text-sm tabular-nums">{split.rate}%</span>{:else}
						<div class="relative">
							<Input id={vendorControlId(`${at}:rate`)} bind:value={split.rate} inputmode="decimal" aria-invalid={!!errors[`${at}:rate`]} class="pr-6 text-right tabular-nums" />
							<span class="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs">%</span>
						</div>
						{#if errors[`${at}:rate`]}<p class="text-destructive text-xs">{errors[`${at}:rate`]}</p>{/if}
					{/if}
				</label>
				<label class="col-span-2 flex flex-col gap-1 sm:col-span-1">
					<span class="text-xs font-medium">Applies to</span>
					{#if readOnly}
						<span class="text-sm">{split.base === 'all' ? 'The whole bid' : split.base === 'labour' ? 'Labour only' : `${split.contractPercent}% of the contract`}</span>
					{:else}
						<div class="flex items-center gap-2">
							<select class={select} bind:value={split.base}>
								<option value="all">The whole bid</option>
								<option value="labour">Labour only</option>
								<option value="contract">Share of the contract</option>
							</select>
							{#if split.base === 'contract'}
								<div class="relative w-20 shrink-0">
									<Input id={vendorControlId(`${at}:contractPercent`)} bind:value={split.contractPercent} inputmode="decimal" aria-label="Share of the contract" aria-invalid={!!errors[`${at}:contractPercent`]} class="pr-6 text-right tabular-nums" />
									<span class="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs">%</span>
								</div>
							{/if}
						</div>
						{#if errors[`${at}:contractPercent`]}<p class="text-destructive text-xs">{errors[`${at}:contractPercent`]}</p>{/if}
					{/if}
				</label>
				{#if !readOnly}
					<Button variant="ghost" size="icon-sm" class="mt-5" aria-label="Remove this place" onclick={() => form.rebate.splice(i, 1)}><X aria-hidden="true" /></Button>
				{/if}
			</div>
			<div class="text-muted-foreground flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
				{#if perSplit?.[i]}
					<span class="text-foreground">
						Estimated rebate
						<span class="font-medium tabular-nums">{perSplit[i].rebate ? format(perSplit[i].rebate!.bid, locale) : 'unknown'}</span>.
					</span>
				{/if}
				{#if known}
					<span>
						Usual rate:
						{known.rates.map((r) => `${r.label} ${r.rate}%${r.kind === 'uplift' ? ', on top' : r.kind === 'instead' ? `, instead when ${r.condition}` : ''}`).join('. ')}.
					</span>
					<span>{CLAIMED[known.claimedBy]}</span>
					<a class="inline-flex items-center gap-1 underline-offset-2 hover:underline" href={known.source} target="_blank" rel="noopener noreferrer"
						>Source, checked {day(known.checked)} <ExternalLink class="size-3" aria-hidden="true" /></a
					>
				{/if}
			</div>
		</div>
	{/each}

	{#if errors.splits}<p class="text-destructive text-sm">{errors.splits}</p>{/if}
	{#if estimate?.labourDetailMissing}
		<p class="text-muted-foreground text-sm">
			A labour rebate needs days and cost on every priced item. {estimate.linesWithoutDetail.length === 1 ? '1 item has none.' : `${estimate.linesWithoutDetail.length} items have none.`}
		</p>
	{/if}

	{#if !readOnly}
		<Button variant="ghost" size="sm" class="w-fit" onclick={add}><Plus aria-hidden="true" />Add a place</Button>
	{/if}
	{#if form.rebate.length === 0 && readOnly}<p class="text-muted-foreground text-sm">No rebate given.</p>{/if}
</div>
