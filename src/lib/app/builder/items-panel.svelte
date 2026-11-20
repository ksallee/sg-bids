<!--
	The main work: the Shots and the Assets of the request, filling the rest of the page. One bar: a
	tab per kind with its count, the two views of one list (what is in the request, edited in place,
	and the project's rows to add from), then what the vendor gets and what is left before the issue.
	A kind with nothing in it opens on adding. The section carries `f-items`, the id the readiness
	list points at for "nothing picked".
-->
<script lang="ts" module>
	export type ItemsView = 'picked' | 'add';
</script>

<script lang="ts">
	import Segmented from '$lib/app/segmented.svelte';
	import PickTable from './pick-table.svelte';
	import PickedList from './picked-list.svelte';
	import SummaryBar from './summary-bar.svelte';
	import BreakdownDialog from './breakdown-dialog.svelte';
	import MatchLine from './match-line.svelte';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { ItemKind } from '$lib/pure/field-map';
	import { controlId, type Target } from '$lib/pure/readiness';
	import type { Builder } from '$lib/app/builder.svelte';

	let {
		builder,
		kind = $bindable('shot'),
		views = $bindable({ shot: 'picked', asset: 'picked' }),
		onFields,
		onFocus
	}: {
		builder: Builder;
		kind?: ItemKind;
		views?: Record<ItemKind, ItemsView>;
		onFields: () => void;
		onFocus: (target: Target) => void;
	} = $props();

	const count = (k: ItemKind) => (k === 'shot' ? builder.state.shots.length : builder.state.assets.length);
	const view = $derived(count(kind) === 0 && views[kind] === 'picked' ? 'add' : views[kind]);
	const setView = (next: ItemsView) => (views = { ...views, [kind]: next });
	let breakdownOpen = $state(false);

	function tabKey(e: KeyboardEvent): void {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		e.preventDefault();
		kind = kind === 'shot' ? 'asset' : 'shot';
		document.getElementById(`tab-${kind}`)?.focus();
	}
</script>

<section id={controlId('items')} class="flex min-h-0 min-w-0 flex-1 flex-col outline-none" aria-label="Shots and assets" tabindex="-1" data-slot="items-panel">
	<div class="border-border flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-6">
		<div class="-mb-px flex items-end gap-5 self-stretch" role="tablist" aria-label="Kind">
			{#each [['shot', 'Shots'], ['asset', 'Assets']] as [k, label] (k)}
				{@const on = kind === k}
				<button
					type="button"
					role="tab"
					id={`tab-${k}`}
					aria-selected={on}
					aria-controls="items-tabpanel"
					tabindex={on ? 0 : -1}
					class={cn(
						'focus-visible:ring-ring/50 flex h-11 items-center gap-2 border-b-2 px-0.5 text-sm outline-none focus-visible:ring-[3px]',
						on ? 'border-primary text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground border-transparent'
					)}
					onclick={() => (kind = k as ItemKind)}
					onkeydown={tabKey}
				>
					{label}
					<span class={cn('rounded-md border px-1.5 text-xs leading-5 font-medium tabular-nums', count(k as ItemKind) === 0 && 'text-muted-foreground font-normal')}>{count(k as ItemKind)}</span>
				</button>
			{/each}
		</div>
		<Segmented
			label="Show"
			value={view}
			options={[
				{ value: 'picked', label: `In the request ${count(kind)}` },
				{ value: 'add', label: 'Add from Flow PT' }
			]}
			onChange={(v) => setView(v as ItemsView)}
		/>
		<Button size="sm" variant="ghost" onclick={() => (breakdownOpen = true)} data-slot="breakdown-open"><FileSpreadsheet data-icon="inline-start" />Add from a breakdown</Button>
		<div class="ml-auto flex min-w-0 items-center py-2"><SummaryBar {builder} {onFocus} /></div>
	</div>
	<MatchLine {builder} />
	<div id="items-tabpanel" role="tabpanel" aria-labelledby={`tab-${kind}`} class="flex min-h-0 min-w-0 flex-1 flex-col">
		{#key kind}
			{#if view === 'add'}
				<PickTable {builder} {kind} />
			{:else}
				<PickedList {builder} {kind} onAdd={() => setView('add')} onBreakdown={() => (breakdownOpen = true)} {onFields} />
			{/if}
		{/key}
	</div>
	<BreakdownDialog {builder} {kind} bind:open={breakdownOpen} />
</section>
