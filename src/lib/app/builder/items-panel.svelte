<!--
	The main work: the request's rows, in one table grouped by bid, filling the rest of the page. One
	bar: Shots, and Assets once there is one (else a quiet way to add some), the two buttons that add
	(from Flow PT, from a breakdown, a row typed by hand) to the bid picked, and the counts: shots as
	the sum of the rows' counts, with the rows beside it where they differ. Under it the bids, one chip each
	(`bids-bar`). The table is the request's own rows, edited in place and in bulk, live to Flow PT
	where a field feeds the column (`request-table`). Add from Flow PT opens a dialog with a plain list
	(`fpt-add-dialog.svelte`); the rows it adds come back here marked and in view. The section carries
	`f-items`.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import FptAddDialog from './fpt-add-dialog.svelte';
	import RequestTable from './request-table.svelte';
	import BreakdownDialog from './breakdown-dialog.svelte';
	import BidsBar from './bids-bar.svelte';
	import DeleteBid from './delete-bid.svelte';
	import MatchLine from './match-line.svelte';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import ListPlus from '@lucide/svelte/icons/list-plus';
	import Plus from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { ItemKind } from '$lib/pure/field-map';
	import type { Id } from '$lib/pure/model';
	import { controlId } from '$lib/pure/readiness';
	import { unitsLine } from '$lib/pure/count';
	import type { Builder } from '$lib/app/builder.svelte';

	let {
		builder,
		marked,
		onFields
	}: {
		builder: Builder;
		/** The bids the issue marked: they hold no rows. */
		marked: ReadonlySet<Id>;
		onFields: () => void;
	} = $props();

	const count = (k: ItemKind) => (k === 'shot' ? builder.state.shots.length : builder.state.assets.length);
	// svelte-ignore state_referenced_locally
	let kind = $state<ItemKind>(count('shot') === 0 && count('asset') > 0 ? 'asset' : 'shot');
	/** The kind the Add from Flow PT dialog is open for, or null when it is closed. */
	let adding = $state<ItemKind | null>(null);
	let breakdownOpen = $state(false);
	let deleting = $state<Id | null>(null);
	let deleteOpen = $state(false);
	const ids = (k: ItemKind) => (k === 'shot' ? builder.state.shots : builder.state.assets).map((row) => row.id);

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

	// The cursor the page asks for may be on the other kind: its tab opens.
	$effect(() => {
		const cursor = builder.cursor;
		if (cursor && cursor.kind !== untrack(() => kind)) kind = cursor.kind;
	});

	/** Add from Flow PT, to the bid named or the one picked. */
	function openPicker(bid?: Id, k: ItemKind = kind): void {
		if (bid) builder.current = bid;
		kind = k;
		adding = k;
	}

	function openBreakdown(bid?: Id): void {
		if (bid) builder.current = bid;
		breakdownOpen = true;
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

	/** A kind shows as a tab when it holds a row, or is the one on screen. */
	const tabs = $derived((['shot', 'asset'] as const).filter((k) => count(k) > 0 || k === kind));
	const other = $derived<ItemKind>(kind === 'shot' ? 'asset' : 'shot');

	const number = new Intl.NumberFormat();
	const totals = $derived.by(() => {
		let shots = 0;
		let shotRows = 0;
		let frames = 0;
		let assets = 0;
		let assetRows = 0;
		for (const s of builder.stats.values()) {
			shots += s.shots;
			shotRows += s.shotRows;
			frames += s.frames;
			assets += s.assets;
			assetRows += s.assetRows;
		}
		return { shots, shotRows, frames, assets, assetRows };
	});
	const format = (n: number) => number.format(n);
</script>

<section id={controlId('items')} class="flex min-h-0 min-w-0 flex-1 flex-col outline-none" aria-label="Bids and rows" tabindex="-1" data-slot="items-panel">
	<BidsBar {builder} {kind} {marked} onAdd={(bid) => openPicker(bid)} onBreakdown={(bid) => openBreakdown(bid)} onDelete={(bid) => ((deleting = bid), (deleteOpen = true))} />
	<div class="border-border flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-b px-6">
		<div class="-mb-px flex items-end gap-5 self-stretch" role="tablist" aria-label="Kind">
			{#each tabs as k (k)}
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
					onclick={() => ((kind = k), (fresh = new Set()))}
					onkeydown={tabKey}
					data-slot={`tab-${k}`}
				>
					{k === 'shot' ? 'Shots' : 'Assets'}
					<span class={cn('rounded-md border px-1.5 text-xs leading-5 font-medium tabular-nums', count(k) === 0 && 'text-muted-foreground font-normal')}>{count(k)}</span>
				</button>
			{/each}
			{#if !tabs.includes(other)}
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex h-11 items-center gap-1 px-0.5 text-sm outline-none focus-visible:ring-[3px]"
					onclick={() => openPicker(undefined, other)}
					data-slot={`add-${other}s`}
				>
					<Plus class="size-3.5" aria-hidden="true" />{other === 'shot' ? 'Shots' : 'Assets'}
				</button>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<Button id="add-from-fpt" size="sm" variant="outline" onclick={() => openPicker()} data-slot="fpt-open"><ListPlus data-icon="inline-start" />Add from Flow PT</Button>
			<Button size="sm" variant="outline" onclick={() => openBreakdown()} data-slot="breakdown-open"><FileSpreadsheet data-icon="inline-start" />Add from a breakdown</Button>
			<Button size="sm" variant="outline" onclick={() => builder.addRow(kind)} title="An empty row in this request only. Type its code, then how many it stands for." data-slot="add-row"><Plus data-icon="inline-start" />Add row</Button>
			<span class="text-muted-foreground text-xs">to <span class="text-foreground font-medium">{builder.bidName(builder.current)}</span></span>
		</div>
		<p class="text-muted-foreground ml-auto hidden items-baseline gap-3 py-2 text-sm whitespace-nowrap lg:flex" aria-label="In the request" data-slot="request-counts">
			<span title={unitsLine(totals.shots, totals.shotRows, 'shot', format)}><span class="text-foreground font-semibold tabular-nums">{number.format(totals.shots)}</span> {totals.shots === 1 ? 'shot' : 'shots'}{#if totals.shots !== totals.shotRows}{' '}in <span class="tabular-nums">{number.format(totals.shotRows)}</span> {totals.shotRows === 1 ? 'row' : 'rows'}{/if}</span>
			<span><span class="text-foreground font-semibold tabular-nums">{number.format(totals.frames)}</span> {totals.frames === 1 ? 'frame' : 'frames'}</span>
			{#if totals.assets > 0 || kind === 'asset'}<span><span class="text-foreground font-semibold tabular-nums">{number.format(totals.assets)}</span> {totals.assets === 1 ? 'asset' : 'assets'}{#if totals.assets !== totals.assetRows}{' '}in <span class="tabular-nums">{number.format(totals.assetRows)}</span> {totals.assetRows === 1 ? 'row' : 'rows'}{/if}</span>{/if}
		</p>
	</div>
	<MatchLine {builder} />
	<div id="items-tabpanel" role="tabpanel" aria-labelledby={`tab-${kind}`} class="flex min-h-0 min-w-0 flex-1 flex-col">
		{#key kind}
			<RequestTable {builder} {kind} {fresh} onAdd={(bid) => openPicker(bid)} onBreakdown={(bid) => openBreakdown(bid)} {onFields} />
		{/key}
	</div>
	{#if adding}<FptAddDialog {builder} kind={adding} onclose={() => void done()} />{/if}
	<BreakdownDialog {builder} {kind} bind:open={breakdownOpen} />
	{#if deleting}<DeleteBid {builder} bid={deleting} bind:open={deleteOpen} />{/if}
</section>
