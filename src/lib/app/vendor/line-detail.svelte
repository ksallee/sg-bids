<!--
	One item's detail, under its row: days and cost per department, compute, and the vendor's
	method, assumptions and notes. All optional. The price stays what the vendor typed; the detail
	sum is shown beside it, and flagged when the two differ.
-->
<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import X from '@lucide/svelte/icons/x';
	import type { DecimalMark } from '$lib/pure/amount';
	import { lineDetailTotal, vendorControlId, type LineForm } from '$lib/pure/bid-form';
	import { format, type Money } from '$lib/pure/money';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	let {
		line = $bindable(),
		errors,
		currency,
		mark,
		locale,
		price,
		readOnly,
		listId
	}: {
		line: LineForm;
		errors: Readonly<Record<string, string>>;
		currency: string;
		mark: DecimalMark;
		locale: string;
		/** The line's price as read, null when blank or wrong. */
		price: Money | null;
		readOnly: boolean;
		/** The datalist of department names. */
		listId: string;
	} = $props();

	const at = $derived(`line:${line.key}`);
	const detail = $derived(lineDetailTotal(line, currency, mark));
	const differs = $derived(detail !== null && price !== null && detail.minor !== price.minor);

	function addDepartment(): void {
		line.departments.push({ department: '', days: '', cost: '' });
	}
</script>

<div class="bg-muted/60 flex flex-col gap-4 border-b px-3 py-4 sm:pl-10" data-slot="line-detail">
	<div class="flex flex-col gap-2">
		<div class="flex flex-wrap items-baseline gap-x-2">
			<p class="text-xs font-medium">Days and cost by department</p>
			<p class="text-muted-foreground text-xs">Optional. {#if (line.count ?? 1) > 1}For the whole row, all {line.count?.toLocaleString()}. {/if}Your price stays the price.</p>
		</div>
		{#if line.departments.length > 0}
			<div class="grid max-w-xl grid-cols-[minmax(0,1fr)_5rem_8rem_2rem] items-start gap-x-2 gap-y-1.5">
				<span class="text-muted-foreground text-xs">Department</span>
				<span class="text-muted-foreground text-right text-xs">Days</span>
				<span class="text-muted-foreground text-right text-xs">Cost, {currency}</span>
				<span></span>
				{#each line.departments as row, i (i)}
					{#if readOnly}
						<span class="text-sm">{row.department}</span>
						<span class="text-right text-sm tabular-nums">{row.days}</span>
						<span class="text-right text-sm tabular-nums">{row.cost}</span>
						<span></span>
					{:else}
						<div class="flex flex-col">
							<Input id={vendorControlId(`${at}:dept:${i}:department`)} bind:value={row.department} list={listId} aria-label="Department" aria-invalid={!!errors[`${at}:dept:${i}:department`]} class="h-7" />
							{#if errors[`${at}:dept:${i}:department`]}<p class="text-destructive text-xs">{errors[`${at}:dept:${i}:department`]}</p>{/if}
						</div>
						<div class="flex flex-col">
							<Input id={vendorControlId(`${at}:dept:${i}:days`)} bind:value={row.days} inputmode="decimal" aria-label="Days" aria-invalid={!!errors[`${at}:dept:${i}:days`]} class="h-7 text-right tabular-nums" />
							{#if errors[`${at}:dept:${i}:days`]}<p class="text-destructive text-xs">{errors[`${at}:dept:${i}:days`]}</p>{/if}
						</div>
						<div class="flex flex-col">
							<Input id={vendorControlId(`${at}:dept:${i}:cost`)} bind:value={row.cost} inputmode="decimal" aria-label="Cost" aria-invalid={!!errors[`${at}:dept:${i}:cost`]} class="h-7 text-right tabular-nums" />
							{#if errors[`${at}:dept:${i}:cost`]}<p class="text-destructive text-xs">{errors[`${at}:dept:${i}:cost`]}</p>{/if}
						</div>
						<Button variant="ghost" size="icon-sm" aria-label="Remove this department" onclick={() => line.departments.splice(i, 1)}><X aria-hidden="true" /></Button>
					{/if}
				{/each}
			</div>
		{/if}
		{#if !readOnly}
			<Button variant="ghost" size="sm" class="w-fit" onclick={addDepartment}><Plus aria-hidden="true" />Add a department</Button>
		{/if}
	</div>

	<div class="flex max-w-xl flex-wrap items-end gap-x-6 gap-y-2">
		<label class="flex w-40 flex-col gap-1">
			<span class="text-xs font-medium">Compute, {currency}</span>
			{#if readOnly}
				<span class="text-sm tabular-nums">{line.compute || 'None'}</span>
			{:else}
				<Input id={vendorControlId(`${at}:compute`)} bind:value={line.compute} inputmode="decimal" aria-invalid={!!errors[`${at}:compute`]} class="h-7 text-right tabular-nums" />
			{/if}
		</label>
		<p class="text-muted-foreground pb-1 text-xs">Render and cloud cost. Part of the price, not labour.</p>
		{#if errors[`${at}:compute`]}<p class="text-destructive w-full text-xs">{errors[`${at}:compute`]}</p>{/if}
	</div>

	{#if detail}
		<p class={differs ? 'flex items-center gap-1.5 text-xs' : 'text-muted-foreground text-xs'} data-slot="detail-sum">
			{#if differs}<TriangleAlert class="text-warning size-3.5 shrink-0" aria-hidden="true" />{/if}
			The detail adds up to <span class="font-medium tabular-nums">{format(detail, locale)}</span>.
			{#if differs && price}Your price is <span class="font-medium tabular-nums">{format(price, locale)}</span>.{/if}
		</p>
	{/if}

	<div class="grid gap-3 md:grid-cols-3">
		{#each [{ key: 'methodology', label: 'How you will do it' }, { key: 'assumptions', label: 'What the price assumes' }, { key: 'notes', label: 'Notes' }] as field (field.key)}
			{@const name = field.key as 'methodology' | 'assumptions' | 'notes'}
			<label class="flex flex-col gap-1">
				<span class="text-xs font-medium">{field.label}</span>
				{#if readOnly}
					<p class="text-sm whitespace-pre-wrap">{line[name] || 'Nothing written.'}</p>
				{:else}
					<textarea
						bind:value={line[name]}
						rows="3"
						class="border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 min-h-16 rounded-lg border bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:ring-3"
					></textarea>
				{/if}
			</label>
		{/each}
	</div>
</div>
