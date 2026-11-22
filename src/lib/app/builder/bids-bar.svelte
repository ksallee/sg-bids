<!--
	The request's bids, one chip each, above the table: the name, what it holds, and a menu. A press
	picks the bid new rows go to; a double press, or Rename in the menu, renames it in place. The menu
	adds rows to that bid (from Flow PT, from a breakdown) or deletes it. Add bid makes the next one,
	named after the request with the next number, picked and ready to rename. A bid with no rows says so, and is marked when the
	issue asks for it (`f-bid-<key>`). Rules in `$lib/pure/request-draft`.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Plus from '@lucide/svelte/icons/plus';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { ItemKind } from '$lib/pure/field-map';
	import type { Id } from '$lib/pure/model';
	import { controlId } from '$lib/pure/readiness';
	import { MAX_BID_NAME } from '$lib/pure/request-draft';
	import { unitsLine } from '$lib/pure/count';
	import type { Builder } from '$lib/app/builder.svelte';

	let {
		builder,
		kind,
		marked,
		onAdd,
		onBreakdown,
		onDelete
	}: {
		builder: Builder;
		kind: ItemKind;
		/** The bids the issue marked: they hold no rows. */
		marked: ReadonlySet<Id>;
		onAdd: (bid: Id) => void;
		onBreakdown: (bid: Id) => void;
		onDelete: (bid: Id) => void;
	} = $props();

	let renaming = $state<Id | null>(null);
	let typed = $state('');
	let problem = $state<string | null>(null);
	const number = new Intl.NumberFormat();

	async function rename(key: Id): Promise<void> {
		renaming = key;
		typed = builder.bidName(key);
		problem = null;
		await tick();
		const input = document.getElementById(`rename-${key}`) as HTMLInputElement | null;
		input?.focus();
		input?.select();
	}

	function commit(): void {
		if (!renaming) return;
		problem = builder.renameBid(renaming, typed);
		if (!problem) renaming = null;
	}

	function cancel(): void {
		renaming = null;
		problem = null;
	}

	async function add(): Promise<void> {
		const key = builder.addBid();
		await rename(key);
	}

	function summary(key: Id): string {
		const s = builder.stats.get(key);
		if (!s || s.rows === 0) return 'No rows yet';
		const parts: string[] = [];
		const format = (n: number) => number.format(n);
		if (s.shots > 0) parts.push(unitsLine(s.shots, s.shotRows, 'shot', format));
		if (s.frames > 0) parts.push(`${number.format(s.frames)} fr`);
		if (s.assets > 0) parts.push(unitsLine(s.assets, s.assetRows, 'asset', format));
		if (parts.length === 0) parts.push(`${s.omitted} omitted`);
		return parts.join(' · ');
	}

	const noun = $derived(kind === 'shot' ? 'shots' : 'assets');
</script>

<div class="flex flex-wrap items-center gap-2 px-6 py-2.5" role="group" aria-label="Bids" data-slot="bids-bar">
	<span class="text-muted-foreground mr-1 text-xs font-medium tracking-wide uppercase">Bids</span>
	{#each builder.bids as bid (bid.key)}
		{@const on = builder.current === bid.key}
		{@const empty = (builder.stats.get(bid.key)?.rows ?? 0) === 0}
		<div
			id={controlId(`bid:${bid.key}`)}
			class={cn(
				'group/bid flex h-9 items-center rounded-md border text-sm transition-colors',
				on ? 'border-primary bg-primary/5 ring-primary/20 ring-2' : 'bg-background hover:bg-muted/60',
				marked.has(bid.key) && 'border-destructive ring-destructive/25 ring-2'
			)}
			data-slot="bid-chip"
			data-bid={bid.name}
			data-current={on}
		>
			{#if renaming === bid.key}
				<div class="flex items-center gap-1 pr-1 pl-1.5">
					<label class="sr-only" for={`rename-${bid.key}`}>Bid name</label>
					<input
						id={`rename-${bid.key}`}
						class="focus-visible:ring-ring/50 h-7 w-44 rounded-sm border bg-transparent px-1.5 text-sm font-medium outline-none focus-visible:ring-2"
						bind:value={typed}
						maxlength={MAX_BID_NAME}
						aria-invalid={problem ? 'true' : undefined}
						aria-describedby={problem ? `rename-${bid.key}-problem` : undefined}
						onkeydown={(e) => {
							if (e.key === 'Enter') commit();
							if (e.key === 'Escape') cancel();
						}}
						onblur={commit}
						data-slot="bid-rename"
					/>
				</div>
			{:else}
				<button
					type="button"
					class="focus-visible:ring-ring/50 flex h-full min-w-0 items-center gap-2 rounded-l-md pr-1 pl-3 text-left outline-none focus-visible:ring-2"
					aria-pressed={on}
					title={on ? `New ${noun} go to ${bid.name}. Double click to rename.` : `Add new ${noun} to ${bid.name}. Double click to rename.`}
					onclick={() => (builder.current = bid.key)}
					ondblclick={() => void rename(bid.key)}
					data-slot="bid-pick"
				>
					<span class={cn('max-w-56 truncate', on ? 'font-semibold' : 'font-medium')}>{bid.name}</span>
					<span class={cn('text-xs whitespace-nowrap tabular-nums', empty ? (marked.has(bid.key) ? 'text-destructive' : 'text-muted-foreground italic') : 'text-muted-foreground')}>{summary(bid.key)}</span>
				</button>
			{/if}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="hover:bg-accent focus-visible:ring-ring/50 text-muted-foreground hover:text-foreground mr-1 inline-flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
					aria-label={`More for ${bid.name}`}
					data-slot="bid-menu"
				>
					<Ellipsis class="size-4" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start">
					<DropdownMenu.Item onSelect={() => onAdd(bid.key)} data-slot="bid-add-fpt">Add {noun} from Flow PT</DropdownMenu.Item>
					<DropdownMenu.Item onSelect={() => onBreakdown(bid.key)} data-slot="bid-add-breakdown">Add from a breakdown</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Item onSelect={() => void rename(bid.key)} data-slot="bid-rename-open">Rename</DropdownMenu.Item>
					<DropdownMenu.Item class="text-destructive" disabled={builder.bids.length <= 1} onSelect={() => onDelete(bid.key)} data-slot="bid-delete">
						{builder.bids.length <= 1 ? 'Delete bid (a request keeps one)' : 'Delete bid…'}
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	{/each}
	<Button size="sm" variant="outline" class="h-9" onclick={() => void add()} data-slot="add-bid"><Plus data-icon="inline-start" />Add bid</Button>
	{#if problem}
		<p id={`rename-${renaming}-problem`} class="text-destructive w-full text-xs" role="alert" data-slot="bid-rename-problem">{problem}</p>
	{/if}
	<p class="text-muted-foreground ml-auto hidden text-xs xl:block">Pick a bid: new {noun} go to it. Each vendor answers each bid on its own.</p>
</div>
