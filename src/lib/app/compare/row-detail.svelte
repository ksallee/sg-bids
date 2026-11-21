<!--
	One shot or asset, every vendor side by side: the price, the methodology, the line's assumptions
	and notes, what the vendor needs, the start week, and the department breakdown when the vendor
	gave one. Below, the split: a share per vendor that priced the row, summing to 100.
-->
<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { Row } from '$lib/pure/compare';
	import { formatAmount, formatSpread } from '$lib/pure/display';
	import type { BidLine, RequestShot, RequestAsset } from '$lib/pure/model';
	import { targetKey } from '$lib/pure/model';
	import { add, money } from '$lib/pure/money';
	import { isPercent, sumPercents } from '$lib/pure/percent';
	import { cn } from '$lib/utils.js';
	import type { CompareState } from './state.svelte';
	import { vendorTone } from './tones';

	let { state: s, row, onClose }: { state: CompareState; row: Row | null; onClose: () => void } = $props();

	const grid = $derived(s.grid!);
	const item = $derived.by<RequestShot | RequestAsset | undefined>(() => {
		if (!row || !s.data) return undefined;
		const list: readonly (RequestShot | RequestAsset)[] = row.target.kind === 'shot' ? s.data.request.shots : s.data.request.assets;
		return list.find((x) => x.id === row.target.id);
	});
	const lines = $derived.by<(BidLine | undefined)[]>(() => {
		if (!row || !s.data) return [];
		const key = targetKey(row.target);
		return s.data.bids.map((bid) => bid.lines.find((l) => targetKey(l.target) === key));
	});

	let shares = $state<string[]>([]);
	let error = $state<string | null>(null);

	$effect(() => {
		if (!row) return;
		const current = s.picks.get(targetKey(row.target)) ?? [];
		shares = grid.columns.map((c) => current.find((x) => x.bidId === c.bidId)?.percent ?? '');
		error = null;
	});

	const priced = $derived(row ? row.cells.map((c) => c.kind === 'price') : []);
	const sum = $derived.by(() => {
		const typed = shares.filter((v, i) => priced[i] && v.trim() !== '');
		if (!typed.every((v) => isPercent(v.trim()))) return null;
		return typed.length ? sumPercents(typed.map((v) => v.trim())) : '0';
	});

	function apply(): void {
		if (!row) return;
		const message = s.split(
			row,
			grid.columns.flatMap((c, i) => (priced[i] && shares[i].trim() !== '' ? [{ bidId: c.bidId, percent: shares[i] }] : []))
		);
		error = message;
		if (!message) onClose();
	}

	function departmentTotal(line: BidLine) {
		const costs = [...(line.departments ?? []).flatMap((d) => (d.cost ? [d.cost] : [])), ...(line.compute ? [line.compute] : [])];
		return costs.reduce((a, b) => add(a, b), money(0, line.total.currency));
	}

	const fields: { key: keyof BidLine; label: string }[] = [
		{ key: 'methodology', label: 'Methodology' },
		{ key: 'assumptions', label: 'Assumptions' },
		{ key: 'notes', label: 'Notes' },
		{ key: 'elementsNeeded', label: 'Elements needed' },
		{ key: 'startWeek', label: 'Start week' }
	];
</script>

<Dialog.Root open={row !== null} onOpenChange={(open) => !open && onClose()}>
	<Dialog.Content class="flex max-h-[90vh] w-[min(96vw,72rem)] max-w-none flex-col gap-4 overflow-hidden sm:max-w-none" data-slot="row-detail">
		{#if row}
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2">
					<span class="font-mono">{row.label}</span>
					{#if row.omitted}<span class="text-muted-foreground rounded border px-1 text-xs font-normal">omitted</span>{/if}
				</Dialog.Title>
				<Dialog.Description class="flex flex-wrap gap-x-3">
					{#each [row.target.kind === 'shot' ? row.sequence : 'Asset', item?.description, item && 'frames' in item && item.frames ? `${item.frames} frames` : '', item?.difficulty].filter(Boolean) as part, i (i)}
						<span>{part}</span>
					{/each}
				</Dialog.Description>
			</Dialog.Header>

			<div class="min-h-0 flex-1 overflow-auto">
				<div class="grid gap-3" style:grid-template-columns="repeat({grid.columns.length}, minmax(14rem, 1fr))">
					{#each grid.columns as column, c (column.bidId)}
						{@const cell = row.cells[c]}
						{@const line = lines[c]}
						<section class="bg-card flex min-w-0 flex-col gap-3 rounded-lg border p-3" aria-label={s.names[c]}>
							<header class="flex flex-col gap-1">
								<span class="flex items-center gap-2 text-sm font-semibold"><span class={cn('size-2 rounded-full', vendorTone(c))}></span>{s.names[c]}</span>
								{#if cell.kind === 'price'}
									<span class={cn('text-lg tabular-nums', cell.lowest && 'font-semibold')}>
										{cell.amount.base ? formatAmount(cell.amount.base, undefined, false) : formatAmount(cell.amount.bid, undefined, false)}
									</span>
									<span class="text-muted-foreground text-xs tabular-nums">
										{#if !cell.amount.base}<span class="text-warning-foreground dark:text-warning">Needs a rate. </span>{:else if cell.amount.bid.currency !== grid.baseCurrency}{formatAmount(cell.amount.bid, undefined, false)} in {cell.amount.bid.currency}. {/if}
										{#if cell.lowest}<span class="text-success font-medium">Lowest.</span>{:else if cell.spreadBp !== null}{formatSpread(cell.spreadBp)} over the lowest.{/if}
									</span>
								{:else if cell.kind === 'package'}
									{@const unit = grid.packages.find((p) => p.id === cell.package)}
									{@const figure = unit?.cells[c]}
									<span class="text-sm">In the figure for {unit?.name ?? 'its bid'}.</span>
									{#if figure && figure.kind === 'package'}
										<span class="text-muted-foreground text-xs tabular-nums">
											One figure for the bid: {figure.amount.base ? formatAmount(figure.amount.base, undefined, false) : formatAmount(figure.amount.bid, undefined, false)}. Awarded whole or not at all.
										</span>
									{/if}
								{:else if cell.kind === 'declined'}
									<span class="text-muted-foreground text-sm">Not bidding on this bid.</span>
								{:else if cell.kind === 'excluded'}
									<span class="text-muted-foreground text-sm">Excluded. The vendor will not do it.</span>
								{:else}
									<span class="text-muted-foreground text-sm">Not bid.</span>
								{/if}
							</header>
							{#if line}
								{#each fields as f (f.key)}
									{#if line[f.key]}
										<div class="flex flex-col gap-0.5">
											<span class="text-muted-foreground text-xs font-medium">{f.label}</span>
											<p class="text-sm whitespace-pre-line">{line[f.key]}</p>
										</div>
									{/if}
								{/each}
								<div class="flex flex-col gap-1">
									<span class="text-muted-foreground text-xs font-medium">Departments</span>
									{#if line.departments?.length}
										<table class="w-full text-xs tabular-nums">
											<thead>
												<tr class="text-muted-foreground"><th class="py-0.5 text-left font-normal">Department</th><th class="py-0.5 text-right font-normal">Days</th><th class="py-0.5 text-right font-normal">Cost</th></tr>
											</thead>
											<tbody>
												{#each line.departments as d, i (i)}
													<tr class="border-t"><td class="py-0.5">{d.department}</td><td class="py-0.5 text-right">{d.days ?? ''}</td><td class="py-0.5 text-right">{d.cost ? formatAmount(d.cost) : ''}</td></tr>
												{/each}
												{#if line.compute}<tr class="border-t"><td class="py-0.5">Compute</td><td></td><td class="py-0.5 text-right">{formatAmount(line.compute)}</td></tr>{/if}
												<tr class="border-t font-medium"><td class="py-0.5">Total</td><td></td><td class="py-0.5 text-right">{formatAmount(departmentTotal(line))}</td></tr>
											</tbody>
										</table>
									{:else}
										<p class="text-muted-foreground text-xs">No breakdown. The vendor gave a total only.</p>
									{/if}
								</div>
							{/if}
						</section>
					{/each}
				</div>
			</div>

			{#if !row.omitted}
				<form
					class="flex flex-col gap-2 border-t pt-3"
					onsubmit={(e) => {
						e.preventDefault();
						apply();
					}}
					data-slot="split"
				>
					<div class="flex flex-wrap items-baseline gap-x-2">
						<h3 class="text-sm font-semibold">Split between vendors</h3>
						<span class="text-muted-foreground text-xs">A share per vendor, in percent, summing to 100. Leave a vendor empty to leave it out. A vendor that priced the row's bid as one figure takes no share: click its cell to give it the whole bid.</span>
					</div>
					<div class="flex flex-wrap items-end gap-3">
						{#each grid.columns as column, c (column.bidId)}
							{#if priced[c]}
								<label class="flex w-32 flex-col gap-1 text-xs">
									<span class="text-muted-foreground truncate">{s.names[c]}</span>
									<span class="relative">
										<Input inputmode="decimal" bind:value={shares[c]} class="pr-6 tabular-nums" aria-label={`${s.names[c]} share, percent`} />
										<span class="text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2">%</span>
									</span>
								</label>
							{/if}
						{/each}
						<span class={cn('pb-2 text-xs tabular-nums', sum === '100' ? 'text-success' : 'text-muted-foreground')}>{sum === null ? 'Not a percent' : `${sum}% of 100%`}</span>
						<div class="ml-auto flex gap-2">
							<Button type="button" variant="ghost" onclick={() => (s.clear(row), onClose())}>Unaward the row</Button>
							<Button type="submit" disabled={sum !== '100'}>Apply the split</Button>
						</div>
					</div>
					{#if error}<p class="text-destructive text-xs" role="alert">{error}</p>{/if}
				</form>
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>
