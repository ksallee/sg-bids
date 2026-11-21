<!--
	The award scenario beside the grid: which scenario, its live summary (total, each vendor's share
	and rows, the non-shot costs line per vendor, against the lowest per row, rows left), the bulk
	picks, a second scenario side by side, the chosen mark, and the way to publish the chosen one.
-->
<script lang="ts">
	import Star from '@lucide/svelte/icons/star';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Plus from '@lucide/svelte/icons/plus';
	import Send from '@lucide/svelte/icons/send';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import Notice from '$lib/app/notice.svelte';
	import { formatAmount, formatShare } from '$lib/pure/display';
	import type { Money } from '$lib/pure/money';
	import { differingRows, picksFromList, summarize, type ScenarioSummary } from '$lib/pure/scenario';
	import { cn } from '$lib/utils.js';
	import { PUBLISH_CONNECTED, publishLine } from './publish';
	import type { CompareState } from './state.svelte';
	import { vendorTone } from './tones';

	let { state: s }: { state: CompareState } = $props();

	const grid = $derived(s.grid!);
	const chosen = $derived(s.scenarios.some((x) => x.chosen));
	const line = $derived(publishLine(chosen, s.data?.publication?.state === 'published'));
	const summary = $derived(s.summary!);
	let renaming = $state(false);
	let name = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let otherId = $state<string>('');

	async function run(work: () => Promise<void>): Promise<void> {
		busy = true;
		error = null;
		try {
			await work();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const known = (m: Money | null) => (m ? formatAmount(m, undefined, false) : 'Needs a rate');
	const short = (m: Money | null) => (m ? formatAmount(m) : 'Needs a rate');

	const other = $derived(s.scenarios.find((x) => x.id === otherId && x.id !== s.activeId) ?? null);
	const otherPicks = $derived(other ? picksFromList(other.picks) : null);
	const otherSummary = $derived<ScenarioSummary | null>(other && otherPicks ? summarize(grid, otherPicks, new Set(other.costsLeftOut)) : null);

	function vendorAmount(sum: ScenarioSummary, column: number): string {
		const part = sum.vendors.find((v) => v.column === column);
		return part ? short(part.total) : '';
	}

	const saveLine = $derived(
		s.saveState === 'saved' ? 'Saved' : s.saveState === 'saving' ? 'Saving' : s.saveState === 'waiting' ? 'Changes waiting' : 'Not saved'
	);
	const difference = $derived(s.lowest?.difference ?? null);
	const awardedPct = $derived(summary.live ? Math.round((summary.awarded / summary.live) * 100) : 0);
</script>

<aside class="bg-card flex min-h-0 w-80 shrink-0 flex-col border-l" aria-label="Award scenario" data-slot="scenario-rail">
	<div class="flex flex-col gap-2 border-b px-4 py-3">
		<div class="flex items-center gap-2">
			<h2 class="text-sm font-semibold">Award scenario</h2>
			{#if s.active}<span class={cn('ml-auto text-xs', s.saveState === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{saveLine}</span>{/if}
		</div>
		{#if s.scenarios.length > 0}
			{#if renaming}
				<form
					class="flex gap-2"
					onsubmit={(e) => {
						e.preventDefault();
						void run(async () => {
							await s.rename(name);
							renaming = false;
						});
					}}
				>
					<Input bind:value={name} aria-label="Scenario name" maxlength={200} class="h-8" />
					<Button type="submit" size="sm" disabled={busy || name.trim() === ''}>Rename</Button>
				</form>
			{:else}
				<div class="flex items-center gap-1">
					<select
						class="border-input bg-background focus-visible:ring-ring/50 h-8 min-w-0 flex-1 rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
						aria-label="Scenario"
						value={s.activeId ?? ''}
						onchange={(e) => {
							const next = s.scenarios.find((x) => x.id === e.currentTarget.value);
							if (next) s.open(next);
						}}
					>
						{#each s.scenarios as sc (sc.id)}
							<option value={sc.id}>{sc.name}{sc.chosen ? ' (chosen)' : ''}</option>
						{/each}
					</select>
					<Button size="icon" variant="ghost" class="size-8" aria-label="New scenario" title="New scenario" onclick={() => void run(() => s.create())} disabled={busy}><Plus class="size-4" /></Button>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger class="hover:bg-accent inline-flex size-8 items-center justify-center rounded-md" aria-label="More for this scenario"><Ellipsis class="size-4" /></DropdownMenu.Trigger>
						<DropdownMenu.Content align="end">
							<DropdownMenu.Item
								onSelect={() => {
									name = s.active?.name ?? '';
									renaming = true;
								}}>Rename</DropdownMenu.Item
							>
							<DropdownMenu.Item onSelect={() => void run(() => s.duplicate())}>Duplicate</DropdownMenu.Item>
							<DropdownMenu.Separator />
							<DropdownMenu.Item class="text-destructive" onSelect={() => void run(() => s.remove())}>Delete</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
			{/if}
		{/if}
		{#if s.saveError}<p class="text-destructive text-xs" role="alert">{s.saveError}</p>{/if}
		{#if error}<p class="text-destructive text-xs" role="alert">{error}</p>{/if}
	</div>

	<div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
		{#if !s.active}
			<div class="flex flex-col gap-3">
				<p class="text-sm">Pick a vendor for each shot and asset, and see what it costs as you go.</p>
				<p class="text-muted-foreground text-xs">Click a price in the grid to start. Or start from a whole pick:</p>
				<div class="flex flex-col gap-2">
					<Button variant="outline" disabled={busy} onclick={() => void run(() => s.awardLowest())}>Start from the lowest per row</Button>
					<Button variant="ghost" disabled={busy} onclick={() => void run(() => s.create())}>Start an empty scenario</Button>
				</div>
			</div>
		{:else}
			<section class="flex flex-col gap-2" aria-label="Summary" data-slot="summary">
				<div class="flex items-baseline justify-between gap-2">
					<span class="text-muted-foreground text-xs">Total in {grid.baseCurrency}</span>
					{#if s.active.chosen}<span class="text-primary inline-flex items-center gap-1 text-xs font-medium"><Star class="size-3 fill-current" />Chosen</span>{/if}
				</div>
				<p class={cn('text-2xl font-semibold tabular-nums', !summary.total && 'text-warning-foreground dark:text-warning text-lg')} data-slot="scenario-total">{known(summary.total)}</p>
				<dl class="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs tabular-nums">
					<dt class="text-muted-foreground">Shots and assets</dt><dd class="text-right">{known(summary.lines)}</dd>
					<dt class="text-muted-foreground">Non-shot costs counted</dt><dd class="text-right">{known(summary.costs)}</dd>
					<dt class="text-muted-foreground">Against the lowest per row</dt>
					<dd class={cn('text-right', difference && difference.minor > 0 && 'text-warning-foreground dark:text-warning', difference && difference.minor < 0 && 'text-success')} data-slot="against-lowest">
						{#if difference === null}Unknown{:else if difference.minor === 0}Same{:else}{difference.minor > 0 ? '+' : '−'}{formatAmount({ ...difference, minor: Math.abs(difference.minor) })}{/if}
					</dd>
				</dl>
				<div class="flex flex-col gap-1 pt-1">
					<div class="flex items-center justify-between text-xs">
						<span>{summary.awarded} of {summary.live} rows awarded</span>
						{#if summary.unawarded.length > 0}
							<button type="button" class="text-primary text-xs hover:underline" onclick={() => (s.onlyUnawarded = !s.onlyUnawarded)}>
								{s.onlyUnawarded ? 'Show every row' : `Show the ${summary.unawarded.length} left`}
							</button>
						{/if}
					</div>
					<div class="bg-muted h-1.5 overflow-hidden rounded-full" role="progressbar" aria-valuenow={awardedPct} aria-valuemin={0} aria-valuemax={100} aria-label="Rows awarded">
						<div class="bg-primary h-full" style:width="{awardedPct}%"></div>
					</div>
				</div>
				{#each summary.partial as part (`${part.bidId}|${part.package}`)}
					{@const column = grid.columns.findIndex((c) => c.bidId === part.bidId)}
					<Notice tone="warning" title={`Part of ${part.name}.`}>
						{' '}{s.names[column] ?? 'A vendor'} priced {part.name} as one figure. It is awarded whole or not at all, so these rows count as unawarded. Give it the whole bid, or none of it.
					</Notice>
				{/each}
				{#if summary.invalid.length > summary.partial.length && summary.partial.length === 0}
					<Notice tone="warning">{summary.invalid.length} {summary.invalid.length === 1 ? 'pick no longer fits' : 'picks no longer fit'} the answers shown. They count as unawarded.</Notice>
				{/if}
				{#if summary.needsRate.length > 0}
					<Notice tone="warning">A vendor in this scenario needs a rate. The total waits for it.</Notice>
				{/if}
				{#if s.note}<p class="text-muted-foreground text-xs">{s.note}</p>{/if}
			</section>

			{#if summary.vendors.length > 0}
				<section class="flex flex-col gap-2" aria-label="Vendors in this scenario" data-slot="vendors">
					<h3 class="text-xs font-medium">Vendors</h3>
					<div class="bg-muted flex h-2 overflow-hidden rounded-full" aria-hidden="true">
						{#each summary.vendors as v (v.bidId)}
							<div class={vendorTone(v.column)} style:width="{(v.shareBp ?? 0) / 100}%"></div>
						{/each}
					</div>
					<ul class="flex flex-col gap-3">
						{#each summary.vendors as v (v.bidId)}
							<li class="flex flex-col gap-1">
								<div class="flex items-center gap-2 text-sm">
									<span class={cn('size-2 shrink-0 rounded-full', vendorTone(v.column))}></span>
									<span class="min-w-0 flex-1 truncate">{s.names[v.column]}</span>
									<span class="tabular-nums">{short(v.total)}</span>
									<span class="text-muted-foreground w-9 text-right text-xs tabular-nums">{formatShare(v.shareBp)}</span>
								</div>
								<div class="text-muted-foreground pl-4 text-xs">{v.rows} {v.rows === 1 ? 'row' : 'rows'}{v.splitRows ? `, ${v.splitRows} split` : ''}</div>
								{#if v.costs.bid.minor !== 0}
									<label class="flex items-center gap-2 pl-4 text-xs">
										<Switch checked={v.costsIncluded} onCheckedChange={(on) => s.toggleCosts(v.bidId, on)} aria-label={`Count ${s.names[v.column]} non-shot costs`} />
										<span class={cn('flex-1', !v.costsIncluded && 'text-muted-foreground line-through')}>Non-shot costs</span>
										<span class={cn('tabular-nums', !v.costsIncluded && 'text-muted-foreground line-through')}>{short(v.costs.base)}</span>
									</label>
								{/if}
							</li>
						{/each}
					</ul>
					<p class="text-muted-foreground text-xs">A vendor's non-shot costs count once it has a row, unless you switch them off. Discount and tax stay with each answer's grand total.</p>
				</section>
			{/if}

			<section class="flex flex-col gap-2" aria-label="Pick in bulk">
				<h3 class="text-xs font-medium">Pick in bulk</h3>
				<Button variant="outline" size="sm" onclick={() => void s.awardLowest()}>Give each row to the lowest</Button>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger class="border-input hover:bg-accent inline-flex h-7 items-center justify-center rounded-md border px-2.5 text-xs font-medium">Give everything to</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start">
						{#each grid.columns as column, c (column.bidId)}
							<DropdownMenu.Item onSelect={() => void s.awardAllTo(c)}><span class={cn('size-2 rounded-full', vendorTone(c))}></span>{s.names[c]}</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				<Button variant="ghost" size="sm" onclick={() => s.clearAll()} disabled={summary.awarded === 0 && summary.invalid.length === 0}>Unaward every row</Button>
				<p class="text-muted-foreground text-xs">To give a sequence to one vendor, use Give to on its row in the grid.</p>
			</section>

			{#if s.scenarios.length > 1}
				<section class="flex flex-col gap-2" aria-label="Compare two scenarios" data-slot="compare-two">
					<h3 class="text-xs font-medium">Side by side</h3>
					<select class="border-input bg-background h-8 rounded-md border px-2 text-sm" aria-label="Scenario to compare with" bind:value={otherId}>
						<option value="">Compare with</option>
						{#each s.scenarios.filter((x) => x.id !== s.activeId) as sc (sc.id)}<option value={sc.id}>{sc.name}</option>{/each}
					</select>
					{#if other && otherSummary && otherPicks}
						<table class="w-full text-xs tabular-nums">
							<thead>
								<tr class="text-muted-foreground"><th class="py-1 text-left font-normal"></th><th class="truncate py-1 text-right font-medium">{s.active.name}</th><th class="truncate py-1 text-right font-medium">{other.name}</th></tr>
							</thead>
							<tbody>
								<tr class="border-t"><td class="py-1">Total</td><td class="text-right font-semibold">{short(summary.total)}</td><td class="text-right font-semibold">{short(otherSummary.total)}</td></tr>
								<tr class="border-t"><td class="py-1">Non-shot costs</td><td class="text-right">{short(summary.costs)}</td><td class="text-right">{short(otherSummary.costs)}</td></tr>
								{#each grid.columns as column, c (column.bidId)}
									{@const a = vendorAmount(summary, c)}
									{@const b = vendorAmount(otherSummary, c)}
									{#if a || b}
										<tr class="border-t"><td class="truncate py-1"><span class={cn('mr-1 inline-block size-1.5 rounded-full', vendorTone(c))}></span>{s.names[c]}</td><td class="text-right">{a}</td><td class="text-right">{b}</td></tr>
									{/if}
								{/each}
								<tr class="border-t"><td class="py-1">Rows left</td><td class="text-right">{summary.unawarded.length}</td><td class="text-right">{otherSummary.unawarded.length}</td></tr>
							</tbody>
						</table>
						<p class="text-muted-foreground text-xs">{differingRows(s.picks, otherPicks)} rows are picked differently.</p>
					{/if}
				</section>
			{/if}
		{/if}
	</div>

	<div class="flex flex-col gap-2 border-t px-4 py-3">
		{#if s.active}
			<Button variant="outline" size="sm" disabled={busy} onclick={() => void run(() => s.choose(!s.active?.chosen))}>
				<Star class={cn('size-3.5', s.active.chosen && 'fill-current')} />{s.active.chosen ? 'Chosen. Unmark it' : 'Mark as the chosen scenario'}
			</Button>
		{/if}
		{#if PUBLISH_CONNECTED && chosen}
			<Button href={`/requests/${s.requestId}/publish`} title={line} data-slot="publish">
				<Send class="size-3.5" />{s.data?.publication ? 'Publish again' : 'Publish the award'}
			</Button>
		{:else}
			<Button disabled title={line} data-slot="publish"><Send class="size-3.5" />Publish the award</Button>
		{/if}
		<p class="text-muted-foreground text-xs">{line}</p>
	</div>
</aside>
