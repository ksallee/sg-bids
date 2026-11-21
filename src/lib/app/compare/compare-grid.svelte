<!--
	The comparison grid: a row per shot or asset in groups with subtotals, a column per vendor. The
	header holds each vendor's bid, version, rate and totals; it and the first column stay put while
	the body scrolls. Rows have fixed heights, so only those in view are drawn
	(`$lib/pure/grid-view`: offsetsOf, visibleRange).

	A cell is a price in the base currency over the vendor's own, the lowest marked, a thin bar for how
	far it sits over the lowest. Excluded is hatched; not bid is an empty dashed box; a price waiting
	for a rate shows in its currency and says so. A pick in the scenario is outlined in the primary.
	A row of a package the vendor priced as one figure says "In package price", never a zero or a
	gap; a click on it picks, or takes off, the whole package. Grouped by package, each group's row
	compares the package as a unit: each vendor's one figure, or its row prices summed, the lowest
	marked (`$lib/pure/compare`, `PackageView`).

	Keyboard: the grid is one tab stop. Arrows move, Home and End go to the row's ends, Page Up and
	Page Down move a screen. Space picks the vendor of the cell. Enter opens the row's detail, or folds
	a group. Left and Right fold and unfold a group.
-->
<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Check from '@lucide/svelte/icons/check';
	import Package from '@lucide/svelte/icons/package';
	import PanelRightOpen from '@lucide/svelte/icons/panel-right-open';
	import Info from '@lucide/svelte/icons/info';
	import UserRoundCheck from '@lucide/svelte/icons/user-round-check';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import type { Cell, PackageCell, Row } from '$lib/pure/compare';
	import { formatAmount, formatDay, formatSpread } from '$lib/pure/display';
	import { offsetsOf, scrollToShow, visibleRange, type DisplayRow, type Subtotal } from '$lib/pure/grid-view';
	import type { Money } from '$lib/pure/money';
	import { rowShares } from '$lib/pure/scenario';
	import { cn } from '$lib/utils.js';
	import RateEditor from './rate-editor.svelte';
	import type { CompareState } from './state.svelte';
	import { vendorTone } from './tones';

	let { state: s, onDetail }: { state: CompareState; onDetail: (row: Row) => void } = $props();

	const ROW = 52;
	/** The cursor shows while the grid has the keyboard. */
	const CURSOR = 'group-focus-visible/grid:ring-ring group-focus-visible/grid:ring-2 ring-inset';
	const GROUP = 40;
	const LABEL_W = 264;
	const COL_W = 184;
	/** A vendor column grows to this, so a price stays near its shot on a wide screen; the item column takes the rest. */
	const COL_MAX = 360;

	const grid = $derived(s.grid!);
	const data = $derived(s.data!);
	const display = $derived(s.view?.display ?? []);
	const offsets = $derived(offsetsOf(display, { group: GROUP, row: ROW }));
	const columns = $derived(grid.columns);
	const template = $derived(`minmax(${LABEL_W}px, 1fr) repeat(${columns.length}, minmax(${COL_W}px, ${COL_MAX}px))`);
	const minWidth = $derived(LABEL_W + columns.length * COL_W);

	let scroller = $state<HTMLDivElement | null>(null);
	let top = $state(0);
	let height = $state(600);
	let headerH = $state(0);
	let frame = 0;

	function onScroll(): void {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			if (scroller) top = scroller.scrollTop;
		});
	}

	// The header is sticky: the body shows from `top` for `height - headerH`, in body coordinates.
	const range = $derived(visibleRange(offsets, top, Math.max(ROW, height - headerH), 8));
	const shown = $derived(display.slice(range.from, range.to + 1));

	// The cursor: a display row and a column, -1 for the label.
	let at = $state({ r: 0, c: 0 });
	const cursor = $derived({ r: Math.min(at.r, Math.max(0, display.length - 1)), c: Math.min(at.c, columns.length - 1) });

	const versionsOf = (vendorId: string) => data.versions.filter((v) => v.vendorId === vendorId).sort((a, b) => b.version - a.version);
	const versionOf = (bidId: string) => data.versions.find((v) => v.bidId === bidId);

	function reveal(r: number): void {
		if (!scroller) return;
		const target = scrollToShow(offsets, r, scroller.scrollTop, height, headerH);
		if (target !== null) scroller.scrollTop = target;
	}

	function move(r: number, c: number): void {
		const nr = Math.max(0, Math.min(display.length - 1, r));
		const nc = Math.max(-1, Math.min(columns.length - 1, c));
		at = { r: nr, c: nc };
		reveal(nr);
	}

	function onKey(e: KeyboardEvent): void {
		if (display.length === 0) return;
		const item = display[cursor.r];
		const page = Math.max(1, Math.floor((height - headerH) / ROW) - 1);
		switch (e.key) {
			case 'ArrowDown':
				move(cursor.r + 1, cursor.c);
				break;
			case 'ArrowUp':
				move(cursor.r - 1, cursor.c);
				break;
			case 'ArrowRight':
				if (item.kind === 'group' && item.collapsed) s.collapsed.delete(item.group.key);
				else move(cursor.r, cursor.c + 1);
				break;
			case 'ArrowLeft':
				if (item.kind === 'group' && !item.collapsed && cursor.c <= 0) s.collapsed.add(item.group.key);
				else move(cursor.r, cursor.c - 1);
				break;
			case 'Home':
				move(e.ctrlKey || e.metaKey ? 0 : cursor.r, e.ctrlKey || e.metaKey ? cursor.c : -1);
				break;
			case 'End':
				move(e.ctrlKey || e.metaKey ? display.length - 1 : cursor.r, e.ctrlKey || e.metaKey ? cursor.c : columns.length - 1);
				break;
			case 'PageDown':
				move(cursor.r + page, cursor.c);
				break;
			case 'PageUp':
				move(cursor.r - page, cursor.c);
				break;
			case ' ':
				if (item.kind === 'row' && cursor.c >= 0) void s.pick(item.row, cursor.c);
				else if (item.kind === 'group') toggle(item.group.key);
				break;
			case 'Enter':
				if (item.kind === 'row') onDetail(item.row);
				else toggle(item.group.key);
				break;
			default:
				return;
		}
		e.preventDefault();
	}

	function toggle(key: string): void {
		if (s.collapsed.has(key)) s.collapsed.delete(key);
		else s.collapsed.add(key);
	}

	const money = (m: Money) => formatAmount(m);
	const cellId = (r: number, c: number) => `cg-${r}-${c}`;

	function sharesOf(row: Row): Map<number, string> {
		return rowShares(grid, s.picks, row);
	}

	function cellLabel(row: Row, cell: Cell, column: number, share: string | undefined): string {
		const vendor = s.names[column];
		const picked = share ? `, picked${share !== '100' ? ` at ${share}%` : ''}` : '';
		if (cell.kind === 'excluded') return `${row.label}, ${vendor}: excluded`;
		if (cell.kind === 'missing') return `${row.label}, ${vendor}: not bid`;
		if (cell.kind === 'package') return `${row.label}, ${vendor}: in the package price${picked}`;
		if (cell.kind === 'declined') return `${row.label}, ${vendor}: not bidding on this package`;
		if (!cell.amount.base) return `${row.label}, ${vendor}: ${money(cell.amount.bid)}, needs a rate${picked}`;
		return `${row.label}, ${vendor}: ${money(cell.amount.base)}${cell.lowest ? ', lowest' : cell.spreadBp !== null ? `, ${formatSpread(cell.spreadBp)} over the lowest` : ''}${picked}`;
	}

	type TotalKey = 'items' | 'costs' | 'discount' | 'tax' | 'grand' | 'rebate' | 'afterRebate';
	const TOTALS: { key: TotalKey; label: string; strong?: boolean }[] = [
		{ key: 'items', label: 'Shots and assets' },
		{ key: 'costs', label: 'Non-shot costs' },
		{ key: 'discount', label: 'Discount' },
		{ key: 'tax', label: 'Tax' },
		{ key: 'grand', label: 'Grand total', strong: true },
		{ key: 'rebate', label: 'Rebate, an estimate' },
		{ key: 'afterRebate', label: 'After rebate', strong: true }
	];

	function subtotalText(sub: Subtotal): { main: string; warn: boolean } {
		if (sub.priced === 0) return { main: '', warn: false };
		if (sub.base) return { main: money(sub.base), warn: false };
		return { main: money(sub.bid), warn: true };
	}

	/** A package as a unit: the figure or the rows summed, in the base currency once known. */
	function unitText(cell: PackageCell): { main: string; warn: boolean; note: string } {
		if (cell.kind === 'none') return { main: '', warn: false, note: 'Not bid' };
		if (cell.kind === 'declined') return { main: '', warn: false, note: 'Not bidding' };
		const main = cell.amount.base ? money(cell.amount.base) : money(cell.amount.bid);
		const warn = cell.amount.base === null;
		if (cell.kind === 'package') return { main, warn, note: 'One figure' };
		if (!cell.complete) return { main, warn, note: `${cell.priced} of ${cell.priced + cell.excluded + cell.missing} priced` };
		return { main, warn, note: 'Rows summed' };
	}
</script>

<div
	bind:this={scroller}
	bind:clientHeight={height}
	class="group/grid relative min-h-0 flex-1 overflow-auto outline-none"
	role="grid"
	tabindex="0"
	aria-label="Bids side by side"
	aria-rowcount={display.length}
	aria-colcount={columns.length + 1}
	aria-activedescendant={display.length ? cellId(cursor.r, cursor.c) : undefined}
	onscroll={onScroll}
	onkeydown={onKey}
	data-slot="compare-grid"
>
	<div style:min-width="{minWidth}px">
		<!-- Header: vendor, version, rate; then the totals. -->
		<div class="bg-card sticky top-0 z-20 border-b shadow-[0_1px_0_var(--border)]" bind:clientHeight={headerH} role="rowgroup">
			<div class="grid" style:grid-template-columns={template} role="row">
				<div class="bg-card sticky left-0 z-10 flex flex-col justify-end gap-1 border-r px-3 py-2" role="columnheader">
					<span class="text-muted-foreground text-xs">{grid.rows.length} rows, prices in {grid.baseCurrency}</span>
					<button type="button" class="text-muted-foreground hover:text-foreground w-fit text-xs underline-offset-2 hover:underline" onclick={() => (s.showTotals = !s.showTotals)}>
						{s.showTotals ? 'Hide the totals' : 'Show the totals'}
					</button>
				</div>
				{#each columns as column, c (column.bidId)}
					{@const version = versionOf(column.bidId)}
					{@const versions = versionsOf(column.vendorId)}
					<div class="flex min-w-0 flex-col gap-1 border-r px-3 py-2 last:border-r-0" role="columnheader" data-slot="vendor-head">
						<div class="flex min-w-0 items-center gap-2">
							<span class={cn('size-2 shrink-0 rounded-full', vendorTone(c))} aria-hidden="true"></span>
							<span class="truncate text-sm font-semibold" title={s.names[c]}>{s.names[c]}</span>
						</div>
						<div class="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
							{#if versions.length > 1}
								<DropdownMenu.Root>
									<DropdownMenu.Trigger class="hover:text-foreground -mx-1 rounded px-1 underline decoration-dotted underline-offset-2" title="Show another version">
										Version {version?.version},
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="start">
										{#each versions as v (v.bidId)}
											<DropdownMenu.Item onSelect={() => void s.showVersion(column.vendorId, v.bidId)}>
												<span class="flex w-full items-center gap-2">
													{#if v.bidId === column.bidId}<Check class="size-3.5" />{:else}<span class="size-3.5"></span>{/if}
													Version {v.version}
													<span class="text-muted-foreground ml-auto text-xs">{v.status === 'withdrawn' ? 'withdrawn' : v.date ? formatDay(v.date) : ''}</span>
												</span>
											</DropdownMenu.Item>
										{/each}
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							{:else}
								<span>Version {version?.version ?? 1}{version?.date ? ',' : ''}</span>
							{/if}
							{#if version?.date}<span class="truncate">{formatDay(version.date)}</span>{/if}
							{#if version?.status === 'withdrawn'}<span class="text-warning-foreground bg-warning/20 rounded px-1">withdrawn</span>{/if}
						</div>
						<div class="text-xs">
							<RateEditor currency={column.currency} base={grid.baseCurrency} rate={column.rate} locked={data.awarded} onSave={(value) => s.setRate(column.bidId, value)} />
						</div>
					</div>
				{/each}
			</div>
			{#if s.showTotals}
				<div class="border-t py-1" data-slot="totals">
					{#each TOTALS as t (t.key)}
						<div class="grid h-6 items-center" style:grid-template-columns={template} role="row">
							<div class={cn('bg-card sticky left-0 z-10 h-full truncate border-r px-3 text-xs leading-6', t.strong ? 'font-medium' : 'text-muted-foreground')} role="rowheader">{t.label}</div>
							{#each grid.totals as total, c (total.bidId)}
								{@const value = total[t.key]}
								{@const noRebate = (t.key === 'rebate' || t.key === 'afterRebate') && total.splits === 0}
								<div class={cn('border-r px-3 text-right text-xs tabular-nums last:border-r-0', t.strong && 'font-semibold')} role="gridcell">
									{#if t.key === 'rebate' && noRebate}
										<span class="text-muted-foreground font-normal">No rebate</span>
									{:else if noRebate}
										{total.grand.base ? money(total.grand.base) : money(total.grand.bid)}
									{:else if value === null}
										<span
											class="text-muted-foreground inline-flex items-center gap-1 font-normal"
											title={`Labour split unknown: ${total.linesWithoutDetail} lines have no department detail, so the labour base of the rebate is unknown. The vendor quotes gross.`}
										>
											<Info class="size-3" aria-hidden="true" />Labour split unknown
										</span>
									{:else if value.base}
										{t.key === 'discount' && value.base.minor > 0 ? `−${money(value.base)}` : money(value.base)}
									{:else}
										<span class="text-warning-foreground dark:text-warning font-normal" title="Needs a rate">{t.key === 'discount' && value.bid.minor > 0 ? `−${money(value.bid)}` : money(value.bid)}</span>
									{/if}
								</div>
							{/each}
						</div>
					{/each}
					{#if grid.totals.some((t) => t.splits > 0)}
						<p class="bg-card text-muted-foreground sticky left-0 w-fit px-3 pt-1 text-[11px]">
							Rebates are estimates from the rates each vendor typed. The vendor quotes gross.
						</p>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Body. -->
		<div style:height="{offsets[range.from] ?? 0}px" aria-hidden="true"></div>
		{#each shown as item, i (item.key)}
			{@const r = range.from + i}
			{#if item.kind === 'group'}
				{@const g = item.group}
				<div
					class="bg-muted/60 hover:bg-muted grid border-b"
					style:grid-template-columns={template}
					style:height="{GROUP}px"
					role="row"
					aria-rowindex={r + 1}
					aria-expanded={!item.collapsed}
					data-slot="group-row"
				>
					<div
						id={cellId(r, -1)}
						class={cn('bg-muted sticky left-0 z-10 flex items-center gap-1.5 border-r px-2', cursor.r === r && CURSOR)}
						role="rowheader"
					>
						<button type="button" class="hover:bg-accent rounded p-0.5" tabindex="-1" aria-label={item.collapsed ? `Unfold ${g.label}` : `Fold ${g.label}`} onclick={() => toggle(g.key)}>
							{#if item.collapsed}<ChevronRight class="size-4" />{:else}<ChevronDown class="size-4" />{/if}
						</button>
						<span class="min-w-0 truncate text-sm font-semibold" title={g.label}>{g.label}</span>
						<span class="text-muted-foreground shrink-0 text-xs whitespace-nowrap tabular-nums">{item.shown === g.rows.length ? g.rows.length : `${item.shown} of ${g.rows.length}`}</span>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="text-muted-foreground hover:text-foreground hover:bg-accent ml-auto shrink-0 rounded p-1"
								tabindex={-1}
								aria-label={`Give ${g.label} to a vendor`}
								title={`Give ${g.label} to a vendor`}
							>
								<UserRoundCheck class="size-3.5" />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start">
								<DropdownMenu.Label>Give {g.label} to</DropdownMenu.Label>
								{#each columns as column, c (column.bidId)}
									<DropdownMenu.Item onSelect={() => void s.awardGroupTo(g.key, c)}>
										<span class={cn('size-2 rounded-full', vendorTone(c))}></span>{s.names[c]}
									</DropdownMenu.Item>
								{/each}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
					{#each g.subtotals as sub, c (c)}
						{@const unit = g.unit?.cells[c]}
						{#if unit}
							{@const text = unitText(unit)}
							{@const lowest = (unit.kind === 'package' || unit.kind === 'rows') && unit.lowest}
							<div
								id={cellId(r, c)}
								class={cn('flex flex-col items-end justify-center border-r px-3 last:border-r-0', cursor.r === r && cursor.c === c && CURSOR)}
								role="gridcell"
								aria-label={`${g.label}, ${s.names[c]}: ${text.main || 'not bid'}${text.note ? `, ${text.note.toLowerCase()}` : ''}${lowest ? ', lowest' : ''}`}
								data-slot="package-unit"
								data-kind={unit.kind}
								data-lowest={lowest ? '' : undefined}
							>
								<span class={cn('text-xs font-semibold tabular-nums', text.warn && 'text-warning-foreground dark:text-warning')} title={text.warn ? 'Needs a rate' : undefined}>{text.main}</span>
								<span class="text-muted-foreground flex items-center gap-1.5 text-[11px] tabular-nums">
									{#if unit.kind === 'package'}<Package class="size-3" aria-hidden="true" />{/if}
									<span>{text.note}</span>
									{#if lowest}
										<span class="text-success inline-flex items-center gap-1 font-medium"><span class="bg-success size-1.5 rounded-full"></span>Lowest</span>
									{:else if (unit.kind === 'package' || unit.kind === 'rows') && unit.spreadBp !== null}
										<span>{formatSpread(unit.spreadBp)}</span>
									{/if}
								</span>
							</div>
						{:else}
							{@const text = subtotalText(sub)}
							<div
								id={cellId(r, c)}
								class={cn('flex flex-col items-end justify-center border-r px-3 last:border-r-0', cursor.r === r && cursor.c === c && CURSOR)}
								role="gridcell"
							>
								<span class={cn('text-xs font-semibold tabular-nums', text.warn && 'text-warning-foreground dark:text-warning')} title={text.warn ? 'Needs a rate' : undefined}>{text.main}</span>
								{#if sub.excluded || sub.missing || sub.inPackage || sub.declined}
									<span class="text-muted-foreground text-[11px] tabular-nums">
										{[sub.inPackage ? `${sub.inPackage} in a package price` : '', sub.declined ? `${sub.declined} not bidding` : '', sub.excluded ? `${sub.excluded} excluded` : '', sub.missing ? `${sub.missing} not bid` : ''].filter(Boolean).join(', ')}
									</span>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{:else}
				{@const row = item.row}
				{@const shares = sharesOf(row)}
				<div
					class={cn('hover:bg-accent/40 group/row grid border-b', row.omitted && 'opacity-60')}
					style:grid-template-columns={template}
					style:height="{ROW}px"
					role="row"
					aria-rowindex={r + 1}
					data-slot="item-row"
					data-key={item.key}
				>
					<div
						id={cellId(r, -1)}
						class={cn('bg-card sticky left-0 z-10 flex min-w-0 items-center gap-2 border-r pr-1 pl-7', cursor.r === r && cursor.c === -1 && CURSOR)}
						role="rowheader"
					>
						<button type="button" class="flex min-w-0 flex-1 flex-col items-start text-left" tabindex="-1" onclick={() => onDetail(row)} title="Open the detail">
							<span class="flex items-center gap-1.5">
								<span class="font-mono text-xs font-medium">{row.label}</span>
								{#if row.omitted}<span class="text-muted-foreground rounded border px-1 text-[10px]">omitted</span>{/if}
							</span>
							{#if row.description}<span class="text-muted-foreground w-full truncate text-xs">{row.description}</span>{/if}
						</button>
						<button
							type="button"
							class="text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 rounded p-1 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
							tabindex="-1"
							aria-label={`Open ${row.label}`}
							onclick={() => onDetail(row)}
						>
							<PanelRightOpen class="size-3.5" />
						</button>
					</div>
					{#each row.cells as cell, c (c)}
						{@const share = shares.get(c)}
						{@const active = cursor.r === r && cursor.c === c}
						{@const clickable = (cell.kind === 'price' || cell.kind === 'package') && !row.omitted}
						<!-- The grid takes the keys (Space picks); a click is the pointer's way to the same pick. -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							id={cellId(r, c)}
							tabindex={-1}
							role="gridcell"
							aria-selected={share !== undefined}
							aria-label={cellLabel(row, cell, c, share)}
							class={cn(
								'relative flex min-w-0 flex-col items-end justify-center border-r px-3 last:border-r-0',
								clickable && 'cursor-pointer',
								cell.kind === 'excluded' && 'cell-hatch',
								share !== undefined && 'bg-primary/10 ring-primary ring-1 ring-inset',
								active && CURSOR
							)}
							onclick={() => {
								at = { r, c };
								if (clickable) void s.pick(row, c);
							}}
							data-kind={cell.kind}
							data-lowest={cell.kind === 'price' && cell.lowest ? '' : undefined}
							data-picked={share !== undefined ? share : undefined}
						>
							{#if cell.kind === 'price'}
								{#if cell.amount.base}
									<span class={cn('text-sm tabular-nums', cell.lowest && 'font-semibold')}>{money(cell.amount.base)}</span>
									<span class="text-muted-foreground flex items-center gap-1.5 text-[11px] tabular-nums">
										{#if cell.amount.bid.currency !== grid.baseCurrency}<span>{money(cell.amount.bid)}</span>{/if}
										{#if cell.lowest}
											<span class="text-success inline-flex items-center gap-1 font-medium"><span class="bg-success size-1.5 rounded-full"></span>Lowest</span>
										{:else if cell.spreadBp !== null}
											<span>{formatSpread(cell.spreadBp)}</span>
										{/if}
									</span>
									{#if !cell.lowest && cell.spreadBp !== null && row.rangeBp}
										<span class="bg-border absolute right-3 bottom-1 left-3 h-0.5 overflow-hidden rounded-full" aria-hidden="true">
											<span
												class="bg-muted-foreground/50 absolute inset-y-0 left-0 rounded-full"
												style:width="{Number.isFinite(cell.spreadBp) && Number.isFinite(row.rangeBp) ? Math.max(4, (cell.spreadBp / row.rangeBp) * 100) : 100}%"
											></span>
										</span>
									{/if}
								{:else}
									<span class="text-muted-foreground text-sm tabular-nums">{money(cell.amount.bid)}</span>
									<span class="text-warning-foreground dark:text-warning text-[11px]">needs a rate</span>
								{/if}
								{#if share !== undefined}
									<span class="bg-primary text-primary-foreground absolute top-1 left-1.5 inline-flex h-4 items-center gap-0.5 rounded px-1 text-[10px] font-medium">
										<Check class="size-2.5" />{share !== '100' ? `${share}%` : ''}
									</span>
								{/if}
							{:else if cell.kind === 'package'}
								<span class="text-muted-foreground flex items-center gap-1.5 text-xs" title="This vendor priced the whole package as one figure. It is awarded whole or not at all.">
									<Package class="size-3.5" aria-hidden="true" />In package price
								</span>
								{#if share !== undefined}
									<span class="bg-primary text-primary-foreground absolute top-1 left-1.5 inline-flex h-4 items-center gap-0.5 rounded px-1 text-[10px] font-medium">
										<Check class="size-2.5" />
									</span>
								{/if}
							{:else if cell.kind === 'declined'}
								<span class="text-muted-foreground text-xs" title="This vendor is not bidding on this package. It cannot be awarded to it.">Not bidding</span>
							{:else if cell.kind === 'excluded'}
								<span class="bg-card/80 text-muted-foreground rounded px-1 text-xs">Excluded</span>
							{:else}
								<span class="text-muted-foreground/80 border-border flex h-7 w-full items-center justify-center rounded border border-dashed text-xs">Not bid</span>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		{/each}
		<div style:height="{(offsets[offsets.length - 1] ?? 0) - (offsets[range.to + 1] ?? 0)}px" aria-hidden="true"></div>
	</div>
</div>

<style>
	.cell-hatch {
		background-image: repeating-linear-gradient(-45deg, transparent 0 6px, color-mix(in oklab, var(--muted-foreground) 14%, transparent) 6px 7px);
	}
</style>
