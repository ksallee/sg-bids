<!--
	Your rates: a price per difficulty that appears in the vendor's rows, and one for rows with none.
	A rate fills every row of its difficulty in the bids priced row by row, at once; a row the vendor
	typed keeps its own price. Shown when some bid is priced row by row and a row can take a rate.
	Rules in `$lib/pure/rate-card`.
-->
<script lang="ts">
	import Tags from '@lucide/svelte/icons/tags';
	import { vendorControlId, type BidForm } from '$lib/pure/bid-form';
	import { hasPlainRows, rateable, setRate } from '$lib/pure/rate-card';
	import { cn } from '$lib/utils.js';

	let { form = $bindable(), errors, readOnly }: { form: BidForm; errors: Readonly<Record<string, string>>; readOnly: boolean } = $props();

	const lines = $derived(form.lines.filter((l) => rateable(form, l)));
	const plain = $derived(hasPlainRows(lines));
	const tiers = $derived(form.rates.tiers.map((t, i) => ({ ...t, index: i, rows: lines.filter((l) => l.difficulty === t.difficulty).length })).filter((t) => t.rows > 0));
	const plainRows = $derived(lines.filter((l) => !l.difficulty?.trim()).length);
	const shown = $derived(tiers.length > 0 || plain);
	const INPUT =
		'border-input dark:bg-input/30 bg-card focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 h-8 w-32 rounded-lg border px-2.5 text-right tabular-nums outline-none focus-visible:ring-3';
</script>

{#if shown}
	<section class="bg-muted/30 flex flex-col gap-3 rounded-lg border px-4 py-3" aria-labelledby="rates-heading" data-slot="rate-card">
		<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<h3 id="rates-heading" class="flex items-center gap-2 text-sm font-semibold"><Tags class="text-muted-foreground size-4" aria-hidden="true" />Your rates</h3>
			<p class="text-muted-foreground text-xs">A rate fills every row of its difficulty, in {form.currency}. A price you type on a row is yours: rates leave it alone.</p>
		</div>
		<div class="flex flex-wrap gap-x-6 gap-y-3">
			{#each tiers as tier (tier.difficulty)}
				{@const key = `rate:${tier.index}`}
				<label class="flex flex-col gap-1">
					<span class="text-xs"><span class="font-medium">{tier.difficulty}</span> <span class="text-muted-foreground tabular-nums">{tier.rows} {tier.rows === 1 ? 'row' : 'rows'}</span></span>
					{#if readOnly}
						<span class="tabular-nums">{tier.price || 'None'}</span>
					{:else}
						<input
							id={vendorControlId(key)}
							class={INPUT}
							value={tier.price}
							inputmode="decimal"
							autocomplete="off" data-lpignore="true" data-1p-ignore data-form-type="other"
							aria-invalid={errors[key] ? 'true' : undefined}
							oninput={(e) => (form = setRate(form, tier.difficulty, e.currentTarget.value))}
							data-slot="rate-input"
							data-difficulty={tier.difficulty}
						/>
						{#if errors[key]}<span class="text-destructive text-xs">{errors[key]}</span>{/if}
					{/if}
				</label>
			{/each}
			{#if plain}
				<label class="flex flex-col gap-1">
					<span class="text-xs"><span class="font-medium">No difficulty</span> <span class="text-muted-foreground tabular-nums">{plainRows} {plainRows === 1 ? 'row' : 'rows'}</span></span>
					{#if readOnly}
						<span class="tabular-nums">{form.rates.fallback || 'None'}</span>
					{:else}
						<input
							id={vendorControlId('rate:fallback')}
							class={cn(INPUT)}
							value={form.rates.fallback}
							inputmode="decimal"
							autocomplete="off" data-lpignore="true" data-1p-ignore data-form-type="other"
							aria-invalid={errors['rate:fallback'] ? 'true' : undefined}
							oninput={(e) => (form = setRate(form, null, e.currentTarget.value))}
							data-slot="rate-input"
							data-difficulty=""
						/>
						{#if errors['rate:fallback']}<span class="text-destructive text-xs">{errors['rate:fallback']}</span>{/if}
					{/if}
				</label>
			{/if}
		</div>
	</section>
{/if}
