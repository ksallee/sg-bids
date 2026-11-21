<!--
	The main work: the Shots and the Assets of the bid, filling the rest of the page. One bar: a tab
	per kind with its count, two buttons that add (from Flow PT, from a breakdown), then the bid's
	counts. The table under it is the bid's own rows, edited in place and in bulk, live to Flow PT
	where a field feeds the column (`request-table`). It is the only table: Add from Flow PT opens a
	dialog with a plain list (`fpt-add-dialog.svelte`), and the rows it adds come back here marked and
	in view. Add from a breakdown opens its dialog. The section carries `f-items`.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import FptAddDialog from './fpt-add-dialog.svelte';
	import RequestTable from './request-table.svelte';
	import BreakdownDialog from './breakdown-dialog.svelte';
	import MatchLine from './match-line.svelte';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import ListPlus from '@lucide/svelte/icons/list-plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { ItemKind } from '$lib/pure/field-map';
	import { bidSummary } from '$lib/pure/production-bid';
	import { controlId } from '$lib/pure/readiness';
	import type { Builder } from '$lib/app/builder.svelte';
	import type { Target } from '$lib/pure/model';

	let {
		builder,
		kind = $bindable('shot'),
		adding = $bindable(null),
		onFields,
		onSendRows
	}: {
		builder: Builder;
		kind?: ItemKind;
		/** The kind the Add from Flow PT dialog is open for, or null when it is closed. */
		adding?: ItemKind | null;
		onFields: () => void;
		/** Move or copy the selected rows to another bid. Absent: the bid is not stored yet. */
		onSendRows?: (rows: Target[], move: boolean) => void;
	} = $props();

	const ids = (k: ItemKind) => (k === 'shot' ? builder.state.shots : builder.state.assets).map((row) => row.id);
	const count = (k: ItemKind) => (k === 'shot' ? builder.state.shots.length : builder.state.assets.length);
	let breakdownOpen = $state(false);

	/** The rows there were when the dialog opened, and the rows it added, marked once it closes. */
	let before = $state<ReadonlySet<string>>(new Set());
	let fresh = $state<ReadonlySet<string>>(new Set());

	$effect.pre(() => {
		const k = adding;
		if (!k) return;
		untrack(() => {
			before = new Set(ids(k));
			fresh = new Set();
		});
	});

	function openPicker(): void {
		adding = kind;
	}

	async function done(): Promise<void> {
		const k = adding;
		if (!k) return;
		fresh = new Set(ids(k).filter((id) => !before.has(id)));
		adding = null;
		await tick();
		document.getElementById('add-from-fpt')?.focus();
	}

	function tabKey(e: KeyboardEvent): void {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		e.preventDefault();
		kind = kind === 'shot' ? 'asset' : 'shot';
		document.getElementById(`tab-${kind}`)?.focus();
	}

	const counts = $derived(bidSummary(builder.state.shots, builder.state.assets));
	const number = new Intl.NumberFormat();
	const facts = $derived([
		{ label: counts.shots === 1 ? 'shot' : 'shots', value: counts.shots, title: counts.shotsWithoutFrames > 0 ? `${counts.shotsWithoutFrames} without a frame count` : undefined },
		{ label: counts.frames === 1 ? 'frame' : 'frames', value: counts.frames, title: undefined },
		{ label: counts.assets === 1 ? 'asset' : 'assets', value: counts.assets, title: undefined }
	]);
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
					onclick={() => ((kind = k as ItemKind), (fresh = new Set()))}
					onkeydown={tabKey}
				>
					{label}
					<span class={cn('rounded-md border px-1.5 text-xs leading-5 font-medium tabular-nums', count(k as ItemKind) === 0 && 'text-muted-foreground font-normal')}>{count(k as ItemKind)}</span>
				</button>
			{/each}
		</div>
		<div class="flex items-center gap-2">
			<Button id="add-from-fpt" size="sm" variant="secondary" onclick={openPicker} data-slot="fpt-open"><ListPlus data-icon="inline-start" />Add from Flow PT</Button>
			<Button size="sm" variant="secondary" onclick={() => (breakdownOpen = true)} data-slot="breakdown-open"><FileSpreadsheet data-icon="inline-start" />Add from a breakdown</Button>
		</div>
		<p class="text-muted-foreground ml-auto hidden items-baseline gap-3 py-2 text-sm whitespace-nowrap lg:flex" aria-label="In the bid" data-slot="bid-counts">
			{#each facts as fact (fact.label)}
				<span title={fact.title}><span class={cn('font-semibold tabular-nums', fact.value === 0 ? 'text-muted-foreground' : 'text-foreground')}>{number.format(fact.value)}</span> {fact.label}</span>
			{/each}
			{#if counts.omitted > 0}<span>{counts.omitted} omitted</span>{/if}
		</p>
	</div>
	<MatchLine {builder} />
	<div id="items-tabpanel" role="tabpanel" aria-labelledby={`tab-${kind}`} class="flex min-h-0 min-w-0 flex-1 flex-col">
		{#key kind}
			<RequestTable {builder} {kind} {fresh} onAdd={openPicker} onBreakdown={() => (breakdownOpen = true)} {onFields} {onSendRows} />
		{/key}
	</div>
	{#if adding}<FptAddDialog {builder} kind={adding} onclose={() => void done()} />{/if}
	<BreakdownDialog {builder} {kind} bind:open={breakdownOpen} />
</section>
