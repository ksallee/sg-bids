<!--
	The bid's terms: your own reference, the date, how long the price holds, when you get paid, and
	what the whole bid assumes and leaves out.
-->
<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { vendorControlId, type BidForm } from '$lib/pure/bid-form';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	let { form = $bindable(), errors, readOnly, day }: { form: BidForm; errors: Readonly<Record<string, string>>; readOnly: boolean; day: (text: string) => string } = $props();

	const area =
		'border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 min-h-24 rounded-lg border bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:ring-3';
</script>

<div class="flex flex-col gap-6">
	<div class="grid max-w-2xl gap-4 sm:grid-cols-3">
		<label class="flex flex-col gap-1">
			<span class="text-xs font-medium">Your reference</span>
			{#if readOnly}<span class="text-sm">{form.number || 'None'}</span>{:else}<Input bind:value={form.number} placeholder="Quote number" />{/if}
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-xs font-medium">Bid date</span>
			{#if readOnly}<span class="text-sm">{form.date ? day(form.date) : 'None'}</span>{:else}<Input id={vendorControlId('date')} type="date" bind:value={form.date} aria-invalid={!!errors.date} />{/if}
			{#if errors.date}<p class="text-destructive text-xs">{errors.date}</p>{/if}
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-xs font-medium">Price holds until</span>
			{#if readOnly}<span class="text-sm">{form.validUntil ? day(form.validUntil) : 'Not given'}</span>{:else}<Input id={vendorControlId('validUntil')} type="date" bind:value={form.validUntil} aria-invalid={!!errors.validUntil} />{/if}
			{#if errors.validUntil}<p class="text-destructive text-xs">{errors.validUntil}</p>{/if}
		</label>
	</div>

	<div class="flex flex-col gap-2">
		<div class="flex flex-wrap items-baseline gap-x-2">
			<p class="text-xs font-medium">Payment milestones</p>
			<p class="text-muted-foreground text-xs">A share of the total each, 100% in all.</p>
		</div>
		{#if form.milestones.length > 0}
			<div class="grid max-w-2xl grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)_2rem] items-start gap-x-2 gap-y-1.5">
				<span class="text-muted-foreground text-xs">Milestone</span>
				<span class="text-muted-foreground text-right text-xs">Share</span>
				<span class="text-muted-foreground text-xs">When</span>
				<span></span>
				{#each form.milestones as row, i (i)}
					{#if readOnly}
						<span class="text-sm">{row.label}</span>
						<span class="text-right text-sm tabular-nums">{row.percent}%</span>
						<span class="text-sm">{row.due}</span>
						<span></span>
					{:else}
						<div class="flex flex-col">
							<Input id={vendorControlId(`milestone:${i}:label`)} bind:value={row.label} placeholder="On award" aria-label="Milestone" aria-invalid={!!errors[`milestone:${i}:label`]} />
							{#if errors[`milestone:${i}:label`]}<p class="text-destructive text-xs">{errors[`milestone:${i}:label`]}</p>{/if}
						</div>
						<div class="flex flex-col">
							<div class="relative">
								<Input id={vendorControlId(`milestone:${i}:percent`)} bind:value={row.percent} inputmode="decimal" aria-label="Share" aria-invalid={!!errors[`milestone:${i}:percent`]} class="pr-6 text-right tabular-nums" />
								<span class="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs">%</span>
							</div>
							{#if errors[`milestone:${i}:percent`]}<p class="text-destructive text-xs">{errors[`milestone:${i}:percent`]}</p>{/if}
						</div>
						<Input bind:value={row.due} placeholder="A day or an event" aria-label="When" />
						<Button variant="ghost" size="icon-sm" aria-label="Remove this milestone" onclick={() => form.milestones.splice(i, 1)}><X aria-hidden="true" /></Button>
					{/if}
				{/each}
			</div>
		{:else if readOnly}
			<p class="text-muted-foreground text-sm">None given.</p>
		{/if}
		{#if errors.milestones}<p class="text-destructive text-xs">{errors.milestones}</p>{/if}
		{#if !readOnly}
			<Button variant="ghost" size="sm" class="w-fit" onclick={() => form.milestones.push({ label: '', percent: '', due: '' })}><Plus aria-hidden="true" />Add a milestone</Button>
		{/if}
	</div>

	<div class="grid gap-4 md:grid-cols-2">
		<label class="flex flex-col gap-1">
			<span class="text-xs font-medium">What the bid assumes</span>
			<span class="text-muted-foreground text-xs">One per line.</span>
			{#if readOnly}<p class="text-sm whitespace-pre-wrap">{form.assumptions || 'Nothing written.'}</p>{:else}<textarea bind:value={form.assumptions} rows="4" class={area}></textarea>{/if}
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-xs font-medium">What the bid leaves out</span>
			<span class="text-muted-foreground text-xs">One per line.</span>
			{#if readOnly}<p class="text-sm whitespace-pre-wrap">{form.exclusions || 'Nothing written.'}</p>{:else}<textarea bind:value={form.exclusions} rows="4" class={area}></textarea>{/if}
		</label>
	</div>
</div>
