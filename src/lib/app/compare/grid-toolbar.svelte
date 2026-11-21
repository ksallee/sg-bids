<!--
	The grid's controls: group, sort, the filters, and the CSV exports. The keyboard line under it
	says what the keys do.
-->
<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import Download from '@lucide/svelte/icons/download';
	import ArrowDownWideNarrow from '@lucide/svelte/icons/arrow-down-wide-narrow';
	import ArrowUpNarrowWide from '@lucide/svelte/icons/arrow-up-narrow-wide';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Segmented from '$lib/app/segmented.svelte';
	import { gridCsv, scenarioCsv } from '$lib/pure/csv';
	import type { GroupBy, Only, SortKey } from '$lib/pure/grid-view';
	import type { CompareState } from './state.svelte';

	let { state: s, code }: { state: CompareState; code: string } = $props();

	const field = 'border-input bg-background focus-visible:ring-ring/50 h-7 rounded-md border px-2 text-xs outline-none focus-visible:ring-2';

	function download(name: string, text: string): void {
		const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	const slug = (text: string) => text.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'export';

	function exportGrid(): void {
		if (!s.grid || !s.view) return;
		download(`${slug(code)}-comparison.csv`, gridCsv(s.grid, s.view.groups, s.names));
	}

	function exportScenario(): void {
		if (!s.grid || !s.summary || !s.active) return;
		download(`${slug(code)}-${slug(s.active.name)}.csv`, scenarioCsv(s.grid, s.active.name, s.picks, s.summary, s.names));
	}
</script>

<div class="flex flex-col gap-2 border-b px-4 py-2" data-slot="grid-toolbar">
	<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
		<Segmented
			label="Group rows by"
			value={s.by}
			options={[
				{ value: 'package', label: 'Package' },
				{ value: 'sequence', label: 'Sequence' },
				{ value: 'episode', label: 'Episode' },
				{ value: 'none', label: 'No groups' }
			]}
			onChange={(v) => (s.by = v as GroupBy)}
		/>
		<label class="flex items-center gap-1.5 text-xs">
			<span class="text-muted-foreground">Sort</span>
			<select class={field} bind:value={() => s.sort, (v) => (s.sort = v as SortKey)}>
				<option value="order">Request order</option>
				<option value="code">Code</option>
				<option value="spread">Spread between bids</option>
				<option value="lowest">Lowest price</option>
				<option value="lowestVendor">Lowest vendor</option>
			</select>
			<Button
				variant="ghost"
				size="icon"
				class="size-7"
				aria-label={s.dir === 'asc' ? 'Ascending. Switch to descending' : 'Descending. Switch to ascending'}
				onclick={() => (s.dir = s.dir === 'asc' ? 'desc' : 'asc')}
			>
				{#if s.dir === 'asc'}<ArrowUpNarrowWide class="size-4" />{:else}<ArrowDownWideNarrow class="size-4" />{/if}
			</Button>
		</label>
		<label class="flex items-center gap-1.5 text-xs">
			<span class="text-muted-foreground">Show</span>
			<select class={field} bind:value={() => s.only, (v) => (s.only = v as Only)}>
				<option value="all">Every row</option>
				<option value="missing">Rows a vendor did not bid</option>
				<option value="excluded">Rows a vendor excluded</option>
				<option value="unconverted">Rows needing a rate</option>
			</select>
		</label>
		<label class="flex items-center gap-1.5 text-xs">
			<span class="text-muted-foreground">Bids differ by over</span>
			<span class="relative">
				<input class="{field} w-16 pr-5 tabular-nums" inputmode="decimal" placeholder="0" bind:value={s.differsOver} aria-label="Bids differ by over, percent" />
				<span class="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">%</span>
			</span>
		</label>
		<label class="flex items-center gap-1.5 text-xs">
			<span class="text-muted-foreground">Lowest is</span>
			<select class={field} bind:value={() => (s.lowestColumn === null ? '' : String(s.lowestColumn)), (v) => (s.lowestColumn = v === '' ? null : Number(v))}>
				<option value="">Anyone</option>
				{#each s.names as n, c (c)}<option value={String(c)}>{n}</option>{/each}
			</select>
		</label>
		<label class="flex items-center gap-1.5 text-xs">
			<input type="checkbox" class="accent-primary" bind:checked={s.hideOmitted} />
			<span>Hide omitted</span>
		</label>
		<div class="relative ml-auto">
			<Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" aria-hidden="true" />
			<input class="{field} w-48 pl-7" type="search" placeholder="Find a shot or asset" bind:value={s.text} aria-label="Find a shot or asset" />
		</div>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger class="border-input hover:bg-accent inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium">
				<Download class="size-3.5" />Export
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				<DropdownMenu.Item onSelect={exportGrid}>The grid as CSV</DropdownMenu.Item>
				<DropdownMenu.Item onSelect={exportScenario} disabled={!s.active}>This scenario as CSV</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>
	<div class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
		{#if s.view}
			<span class="tabular-nums">{s.view.shown === s.view.total ? `${s.view.total} rows` : `${s.view.shown} of ${s.view.total} rows`}</span>
		{/if}
		{#if s.filtering}<button type="button" class="text-primary hover:underline" onclick={() => s.clearFilters()}>Clear the filters</button>{/if}
		<span class="ml-auto hidden lg:inline">
			<kbd class="kbd">Arrows</kbd> move, <kbd class="kbd">Space</kbd> picks the vendor, <kbd class="kbd">Enter</kbd> opens the row, <kbd class="kbd">Left</kbd>
			<kbd class="kbd">Right</kbd> fold a group
		</span>
	</div>
</div>

<style>
	.kbd {
		border: 1px solid var(--border);
		border-radius: 0.25rem;
		padding: 0 0.25rem;
		font-family: var(--font-sans);
		font-size: 0.6875rem;
		background: var(--muted);
	}
</style>
