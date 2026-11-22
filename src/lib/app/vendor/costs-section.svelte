<!--
	Costs outside the shots and assets (overhead, supervision, on set, contingency, others), then
	the discount and the local tax, each an amount or a percent. "Counts as labour" feeds a labour
	based rebate; it is the vendor's call, never guessed.
-->
<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { vendorControlId, type AdjustmentForm, type BidForm } from '$lib/pure/bid-form';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { cn } from '$lib/utils.js';

	let { form = $bindable(), errors, readOnly }: { form: BidForm; errors: Readonly<Record<string, string>>; readOnly: boolean } = $props();
</script>

{#snippet adjustment(label: string, key: 'discount' | 'tax', value: AdjustmentForm, hint: string)}
	<div class="flex flex-col gap-1">
		<span class="text-xs font-medium" id={`${key}-label`}>{label}</span>
		<div class="flex items-center gap-2" role="group" aria-labelledby={`${key}-label`}>
			{#if readOnly}
				<span class="text-sm tabular-nums">{value.value ? `${value.value}${value.kind === 'percent' ? '%' : ` ${form.currency}`}` : 'None'}</span>
			{:else}
				<Input id={vendorControlId(key)} bind:value={value.value} inputmode="decimal" aria-label={label} aria-invalid={!!errors[key]} class="w-32 text-right tabular-nums" />
				<div class="bg-muted flex items-center gap-0.5 rounded-lg border p-0.5">
					{#each [{ kind: 'percent', label: '%' }, { kind: 'amount', label: form.currency }] as option (option.kind)}
						<button
							type="button"
							class={cn(
								'focus-visible:ring-ring/50 h-7 rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-3',
								value.kind === option.kind ? 'bg-card text-foreground ring-border shadow-xs ring-1' : 'text-muted-foreground hover:text-foreground'
							)}
							aria-pressed={value.kind === option.kind}
							onclick={() => (value.kind = option.kind as AdjustmentForm['kind'])}>{option.label}</button
						>
					{/each}
				</div>
			{/if}
		</div>
		{#if errors[key]}<p class="text-destructive text-xs">{errors[key]}</p>{:else}<p class="text-muted-foreground text-xs">{hint}</p>{/if}
	</div>
{/snippet}

<div class="flex flex-col gap-6">
	<div class="bg-card overflow-hidden rounded-lg border">
		{#each form.costs as cost, i (i)}
			<div class="grid grid-cols-[minmax(0,1fr)_9.5rem] items-start gap-x-3 gap-y-1 border-b px-3 py-1.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_9.5rem_9rem_2rem]">
				<div class="flex min-w-0 flex-col pt-1">
					{#if cost.kind === 'other' && !readOnly}
						<Input id={vendorControlId(`cost:${i}:label`)} bind:value={cost.label} placeholder="What it is" aria-label="What the cost is" aria-invalid={!!errors[`cost:${i}:label`]} class="h-7" />
						{#if errors[`cost:${i}:label`]}<p class="text-destructive text-xs">{errors[`cost:${i}:label`]}</p>{/if}
					{:else}
						<span class="text-sm">{cost.label}</span>
						{#if cost.kind === 'on_set'}<span class="text-muted-foreground text-xs">Supervisor, wrangler, lidar, element shoots.</span>{/if}
					{/if}
				</div>
				<div class="flex flex-col items-end">
					{#if readOnly}
						<span class="pt-1 text-sm tabular-nums">{cost.amount || 'None'}</span>
					{:else}
						<Input id={vendorControlId(`cost:${i}:amount`)} bind:value={cost.amount} inputmode="decimal" aria-label={`${cost.label || 'Cost'}, ${form.currency}`} aria-invalid={!!errors[`cost:${i}:amount`]} class="text-right tabular-nums" />
						{#if errors[`cost:${i}:amount`]}<p class="text-destructive text-xs">{errors[`cost:${i}:amount`]}</p>{/if}
					{/if}
				</div>
				<label class="text-muted-foreground col-span-2 flex items-center gap-2 pt-1.5 text-xs sm:col-span-1">
					<input type="checkbox" bind:checked={cost.labour} disabled={readOnly} class="accent-primary size-4" />
					Counts as labour
				</label>
				{#if cost.kind === 'other' && !readOnly}
					<Button variant="ghost" size="icon-sm" class="hidden sm:inline-flex" aria-label="Remove this cost" onclick={() => form.costs.splice(i, 1)}><X aria-hidden="true" /></Button>
				{/if}
			</div>
		{/each}
	</div>
	{#if !readOnly}
		<Button variant="ghost" size="sm" class="-mt-4 w-fit" onclick={() => form.costs.push({ kind: 'other', label: '', amount: '', labour: false })}
			><Plus aria-hidden="true" />Add a cost</Button
		>
	{/if}

	<div class="flex flex-wrap gap-x-10 gap-y-4">
		{@render adjustment('Discount', 'discount', form.discount, 'Taken off the subtotal.')}
		{@render adjustment('Local tax', 'tax', form.tax, 'Added after the discount.')}
	</div>
</div>
