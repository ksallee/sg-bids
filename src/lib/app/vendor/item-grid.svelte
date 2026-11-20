<!--
	The shots and assets with a price each. Built for a few hundred rows from the keyboard:

	- Arrow up and down, Enter and Shift+Enter move between price cells, in the order shown.
	- Pasting several cells into a price cell fills down from there, or matches rows by code when
	  each starts with one (`$lib/pure/paste`). What landed and what did not is said above the grid.
	- Search, a filter by state, and grouping by sequence or episode when the shots carry them.

	"Exclude" is apart from a zero price: an excluded item is one you will not do.
-->
<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Search from '@lucide/svelte/icons/search';
	import { SvelteSet } from 'svelte/reactivity';
	import type { DecimalMark } from '$lib/pure/amount';
	import type { BidForm } from '$lib/pure/bid-form';
	import { targetKey } from '$lib/pure/model';
	import { format, sum, type Money } from '$lib/pure/money';
	import { planPaste, type PastePlan } from '$lib/pure/paste';
	import { groupings, groupItems, itemMatches, type Grouping, type VendorRequestView } from '$lib/pure/vendor-view';
	import { cn } from '$lib/utils.js';
	import LineDetail from './line-detail.svelte';

	let {
		form = $bindable(),
		request,
		errors,
		prices,
		mark,
		locale,
		readOnly
	}: {
		form: BidForm;
		request: VendorRequestView;
		errors: Readonly<Record<string, string>>;
		/** Each priced line's amount by key, as the draft read it. */
		prices: ReadonlyMap<string, Money>;
		mark: DecimalMark;
		locale: string;
		readOnly: boolean;
	} = $props();

	type Filter = 'all' | 'open' | 'excluded';

	const DEPARTMENTS = ['Matchmove', 'Roto', 'Paint', 'Layout', 'Animation', 'FX', 'Lighting', 'Comp', 'Modelling', 'Rigging', 'Texturing'];

	let query = $state('');
	let filter = $state<Filter>('all');
	const offered = $derived(groupings(request.shots));
	// svelte-ignore state_referenced_locally
	let grouping = $state<Grouping | null>(offered.includes('sequence') ? 'sequence' : (offered[0] ?? null));
	const open = new SvelteSet<string>();
	let pasted = $state<PastePlan | null>(null);
	let grid = $state<HTMLElement | null>(null);

	const indexOf = $derived(new Map(form.lines.map((line, index) => [line.key, index])));
	const shotByKey = $derived(new Map(request.shots.map((s) => [targetKey({ kind: 'shot', id: s.id }), s])));
	const assetByKey = $derived(new Map(request.assets.map((a) => [targetKey({ kind: 'asset', id: a.id }), a])));
	const codes = $derived(
		new Map<string, string>([
			...request.shots.map((s) => [s.code, targetKey({ kind: 'shot', id: s.id })] as [string, string]),
			...request.assets.map((a) => [a.name, targetKey({ kind: 'asset', id: a.id })] as [string, string])
		])
	);
	const departments = $derived([...new Set([...DEPARTMENTS, ...form.lines.flatMap((l) => l.departments.map((d) => d.department.trim()).filter(Boolean))])]);

	// A filter keeps the rows it found when picked, so a row does not vanish while you type in it.
	let kept = $state<ReadonlySet<string> | null>(null);

	function pick(next: Filter): void {
		filter = next;
		kept =
			next === 'all'
				? null
				: new Set(form.lines.filter((l) => (next === 'excluded' ? l.excluded : !l.excluded && !prices.has(l.key))).map((l) => l.key));
	}

	function shows(key: string): boolean {
		if (kept && !kept.has(key)) return false;
		return itemMatches(shotByKey.get(key) ?? assetByKey.get(key) ?? {}, query);
	}

	const sections = $derived.by(() => {
		const shotGroups = groupItems(request.shots, grouping).map((group) => ({
			label: group.label ?? 'Shots',
			keys: group.ids.map((id) => targetKey({ kind: 'shot', id })).filter(shows)
		}));
		const assets = { label: 'Assets', keys: request.assets.map((a) => targetKey({ kind: 'asset', id: a.id })).filter(shows) };
		return [...shotGroups, assets].filter((section) => section.keys.length > 0);
	});
	const order = $derived(sections.flatMap((section) => section.keys));

	const counts = $derived({
		all: form.lines.length,
		open: form.lines.filter((l) => !l.excluded && !prices.has(l.key)).length,
		excluded: form.lines.filter((l) => l.excluded).length
	});

	function subtotal(keys: readonly string[]): Money | null {
		const amounts = keys.filter((k) => !form.lines[indexOf.get(k)!].excluded).flatMap((k) => (prices.has(k) ? [prices.get(k)!] : []));
		return amounts.length === 0 ? null : sum(amounts, form.currency);
	}

	/** Focuses the next price cell that takes input, from `at` in `step`. */
	function focusPrice(at: number, step: 1 | -1): void {
		if (!grid) return;
		for (let i = at + step; i >= 0 && i < order.length; i += step) {
			const input = grid.querySelector<HTMLInputElement>(`[data-price="${CSS.escape(order[i])}"]`);
			if (input && !input.disabled) {
				input.focus();
				input.select();
				input.closest('[role=row]')?.scrollIntoView({ block: 'nearest' });
				return;
			}
		}
	}

	function onPriceKey(event: KeyboardEvent, key: string): void {
		const down = event.key === 'ArrowDown' || (event.key === 'Enter' && !event.shiftKey);
		const up = event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey);
		if (!down && !up) return;
		event.preventDefault();
		focusPrice(order.indexOf(key), down ? 1 : -1);
	}

	function onPricePaste(event: ClipboardEvent, key: string): void {
		const text = event.clipboardData?.getData('text/plain') ?? '';
		const plan = planPaste(text, { start: key, order, codes, currency: form.currency, mark });
		if (!plan) return;
		event.preventDefault();
		for (const update of plan.updates) {
			const line = form.lines[indexOf.get(update.key)!];
			if ('excluded' in update) line.excluded = true;
			else line.price = update.price;
		}
		pasted = plan;
	}

	function meta(key: string): string {
		const shot = shotByKey.get(key);
		if (shot) return [shot.type, shot.difficulty].filter(Boolean).join(', ');
		const item = assetByKey.get(key);
		return [item?.type, item?.difficulty].filter(Boolean).join(', ');
	}

	// One line per item. Below sm the description goes; from xl the kind of work and frames come in.
	const COLS =
		'grid-cols-[2rem_minmax(0,1fr)_7.5rem_2.5rem] sm:grid-cols-[2rem_7.5rem_minmax(0,1fr)_9.5rem_4rem] xl:grid-cols-[2rem_7.5rem_minmax(0,1fr)_8rem_3.5rem_9.5rem_4rem]';

	const FILTERS: { value: Filter; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'open', label: 'No price yet' },
		{ value: 'excluded', label: 'Excluded' }
	];
</script>

<datalist id="departments">
	{#each departments as name (name)}<option value={name}></option>{/each}
</datalist>

<div class="flex flex-col gap-3" data-slot="item-grid">
	<div class="flex flex-wrap items-center gap-2">
		<label class="relative w-full max-w-64">
			<span class="sr-only">Search shots and assets</span>
			<Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
			<input
				bind:value={query}
				type="search"
				placeholder="Search code, description, sequence"
				class="border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent pr-2.5 pl-8 text-sm outline-none focus-visible:ring-3"
			/>
		</label>
		<div class="bg-muted flex items-center gap-0.5 rounded-lg border p-0.5" role="group" aria-label="Show">
			{#each FILTERS as option (option.value)}
				<button
					type="button"
					class={cn(
						'focus-visible:ring-ring/50 h-7 rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-3',
						filter === option.value ? 'bg-card text-foreground ring-border shadow-xs ring-1' : 'text-muted-foreground hover:text-foreground'
					)}
					aria-pressed={filter === option.value}
					onclick={() => pick(option.value)}
				>
					{option.label} <span class="tabular-nums opacity-70">{counts[option.value]}</span>
				</button>
			{/each}
		</div>
		{#if offered.length > 0}
			<label class="text-muted-foreground flex items-center gap-2 text-xs">
				Group by
				<select
					class="border-input dark:bg-input/30 text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-lg border bg-transparent px-2 text-sm outline-none focus-visible:ring-3"
					value={grouping ?? ''}
					onchange={(e) => (grouping = (e.currentTarget.value || null) as Grouping | null)}
				>
					{#each offered as option (option)}<option value={option}>{option === 'sequence' ? 'Sequence' : 'Episode'}</option>{/each}
					<option value="">Nothing</option>
				</select>
			</label>
		{/if}
		{#if !readOnly}
			<p class="text-muted-foreground ml-auto hidden text-xs xl:block">Enter moves down. Paste a column into any price.</p>
		{/if}
	</div>

	{#if pasted}
		<div class="border-info/50 bg-info/10 flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm" role="status" data-slot="paste-report">
			<div class="flex min-w-0 flex-1 flex-col gap-0.5">
				<p>
					{pasted.updates.length === 1 ? 'Pasted 1 row' : `Pasted ${pasted.updates.length} rows`}{pasted.mode === 'codes' ? ', matched by code.' : '.'}
					{#if pasted.overflow > 0}{pasted.overflow === 1 ? '1 row had no item left to go to.' : `${pasted.overflow} rows had no item left to go to.`}{/if}
				</p>
				{#each pasted.errors as error (error.row)}
					<p class="text-destructive text-xs">Row {error.row}, "{error.text}": {error.message}</p>
				{/each}
				{#if pasted.unknown.length > 0}
					<p class="text-xs">Not in this request: {pasted.unknown.join(', ')}.</p>
				{/if}
			</div>
			<button type="button" class="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline" onclick={() => (pasted = null)}>Dismiss</button>
		</div>
	{/if}

	<div bind:this={grid} class="bg-card rounded-lg border" role="table" aria-label="Shots and assets" aria-rowcount={order.length}>
		<div
			class={cn('text-muted-foreground bg-card sticky top-0 z-10 grid items-center gap-x-3 rounded-t-lg border-b px-2 py-1.5 text-xs', COLS)}
			role="row"
		>
			<span role="columnheader"><span class="sr-only">Detail</span></span>
			<span role="columnheader">Code</span>
			<span role="columnheader" class="hidden sm:block">What it is</span>
			<span role="columnheader" class="hidden xl:block">Kind</span>
			<span role="columnheader" class="hidden text-right xl:block">Frames</span>
			<span role="columnheader" class="text-right">Price, {form.currency}</span>
			<span role="columnheader" class="text-center" title="Exclude what you will not do">Exclude</span>
		</div>

		{#each sections as section (section.label)}
			{@const total = subtotal(section.keys)}
			<div class="bg-background/60 flex items-baseline gap-2 border-b px-3 py-1.5" role="row">
				<span class="text-xs font-medium" role="rowheader">{section.label}</span>
				<span class="text-muted-foreground text-xs tabular-nums">{section.keys.length}</span>
				{#if total}<span class="text-muted-foreground ml-auto text-xs tabular-nums">{format(total, locale)}</span>{/if}
			</div>
			{#each section.keys as key (key)}
				{@const index = indexOf.get(key)!}
				{@const line = form.lines[index]}
				{@const shot = shotByKey.get(key)}
				{@const item = assetByKey.get(key)}
				{@const error = errors[`line:${key}:price`]}
				{@const detailOpen = open.has(key)}
				{@const hasDetail = line.departments.length > 0 || line.compute !== '' || line.methodology !== '' || line.assumptions !== '' || line.notes !== ''}
				<div
					class={cn(
						'grid items-center gap-x-3 border-b px-2 py-1 text-sm last:border-b-0',
						COLS,
						line.excluded && 'text-muted-foreground',
						detailOpen && 'bg-muted/60'
					)}
					role="row"
					data-row={key}
				>
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 relative flex size-6 items-center justify-center rounded-md outline-none focus-visible:ring-3"
						aria-expanded={detailOpen}
						aria-label={detailOpen ? 'Hide detail' : 'Show detail'}
						title="Days, cost, method and notes"
						onclick={() => (detailOpen ? open.delete(key) : open.add(key))}
					>
						<ChevronRight class={cn('size-4 transition-transform motion-reduce:transition-none', detailOpen && 'rotate-90')} aria-hidden="true" />
						{#if hasDetail && !detailOpen}<span class="bg-primary absolute top-0.5 right-0.5 size-1.5 rounded-full" aria-hidden="true"></span>{/if}
					</button>
					<span class="truncate font-mono text-xs" role="cell" title={shot?.code ?? item?.name}>{shot?.code ?? item?.name}</span>
					<span
						class={cn('hidden min-w-0 truncate sm:block', line.excluded && 'line-through decoration-current/40')}
						role="cell"
						title={[shot?.description ?? item?.description, meta(key)].filter(Boolean).join('. ')}
					>
						{shot?.description ?? item?.description ?? ''}
					</span>
					<span class="text-muted-foreground hidden truncate text-xs xl:block" role="cell">{meta(key)}</span>
					<span class="text-muted-foreground hidden text-right text-xs tabular-nums xl:block" role="cell">{shot?.frames ?? ''}</span>
					<span class="flex flex-col items-end" role="cell">
						{#if readOnly}
							<span class="py-1.5 tabular-nums">{line.excluded ? 'Excluded' : prices.has(key) ? format(prices.get(key)!, locale) : 'Not bid'}</span>
						{:else}
							<input
								bind:value={form.lines[index].price}
								data-price={key}
								inputmode="decimal"
								autocomplete="off"
								aria-label={`Price for ${shot?.code ?? item?.name}`}
								aria-invalid={!!error}
								disabled={line.excluded}
								placeholder={line.excluded ? 'Excluded' : ''}
								class="border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 h-8 w-full rounded-lg border bg-transparent px-2.5 text-right tabular-nums outline-none placeholder:text-xs focus-visible:ring-3 disabled:opacity-60"
								onfocus={(e) => e.currentTarget.select()}
								onkeydown={(e) => onPriceKey(e, key)}
								onpaste={(e) => onPricePaste(e, key)}
							/>
							{#if error}<span class="text-destructive pt-0.5 text-right text-xs">{error}</span>{/if}
						{/if}
					</span>
					<span class="flex justify-center" role="cell">
						<input
							type="checkbox"
							bind:checked={form.lines[index].excluded}
							disabled={readOnly}
							aria-label={`Exclude ${shot?.code ?? item?.name}`}
							class="accent-primary size-4"
						/>
					</span>
				</div>
				{#if detailOpen}
					<LineDetail bind:line={form.lines[index]} {errors} currency={form.currency} {mark} {locale} price={prices.get(key) ?? null} {readOnly} listId="departments" />
				{/if}
			{/each}
		{:else}
			<p class="text-muted-foreground px-3 py-8 text-center text-sm">Nothing matches. Clear the search or show all.</p>
		{/each}
	</div>
</div>
