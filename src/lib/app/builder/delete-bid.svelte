<!--
	Deleting a bid of the draft. It asks first and says what happens: a bid with no rows just goes; a
	bid with rows moves them to another bid, picked here, or deletes them too. A vendor that answers
	only this bid answers every bid after. A request keeps one bid: the last one cannot go. Nothing is
	written to Flow PT. Rules in `$lib/pure/request-draft`.
-->
<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { Id } from '$lib/pure/model';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, bid, open = $bindable(false) }: { builder: Builder; bid: Id; open?: boolean } = $props();

	const name = $derived(builder.bidName(bid));
	const rows = $derived(builder.stats.get(bid)?.rows ?? 0);
	const others = $derived(builder.bids.filter((b) => b.key !== bid));
	const alone = $derived(builder.namedVendors.filter((v) => v.bids !== null && v.bids.length === 1 && v.bids[0] === bid).map((v) => v.name.trim() || 'A vendor'));
	let choice = $state<'move' | 'delete'>('move');
	let to = $state<Id>('');
	const uid = $props.id();

	$effect(() => {
		if (!open) return;
		choice = 'move';
		to = others[0]?.key ?? '';
	});

	function remove(): void {
		builder.deleteBid(bid, rows === 0 || choice === 'delete' ? null : to);
		open = false;
	}

	const plural = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`;
	const RADIO = 'flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5';
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md" data-slot="delete-bid">
		<Dialog.Header>
			<Dialog.Title>Delete {name}?</Dialog.Title>
			<Dialog.Description>
				{rows === 0 ? 'It holds no rows. Nothing else changes.' : `It holds ${plural(rows)}. Say where they go.`}
			</Dialog.Description>
		</Dialog.Header>
		{#if rows > 0}
			<fieldset class="flex flex-col gap-2" data-slot="delete-bid-rows">
				<legend class="sr-only">Its rows</legend>
				<label class={RADIO}>
					<input type="radio" name={`${uid}-rows`} value="move" bind:group={choice} class="mt-0.5" />
					<span class="flex min-w-0 flex-1 flex-col gap-1.5">
						<span class="font-medium">Move its {plural(rows)} to another bid</span>
						{#if others.length > 1}
							<select
								class="border-input bg-background h-8 rounded-md border px-2 text-sm"
								bind:value={to}
								aria-label="The bid they go to"
								onfocus={() => (choice = 'move')}
								data-slot="delete-bid-to"
							>
								{#each others as b (b.key)}<option value={b.key}>{b.name}</option>{/each}
							</select>
						{:else}
							<span class="text-muted-foreground">They go to {others[0]?.name}.</span>
						{/if}
					</span>
				</label>
				<label class={RADIO}>
					<input type="radio" name={`${uid}-rows`} value="delete" bind:group={choice} class="mt-0.5" />
					<span class="font-medium">Delete its {plural(rows)} too</span>
				</label>
			</fieldset>
		{/if}
		{#if alone.length > 0}
			<p class="text-muted-foreground text-sm">{alone.join(', ')} {alone.length === 1 ? 'answers' : 'answer'} only this bid. After, {alone.length === 1 ? 'it answers' : 'they answer'} every bid.</p>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Keep it</Button>
			<Button variant="destructive" class={cn()} onclick={remove} data-slot="delete-bid-now">
				{rows === 0 ? 'Delete bid' : choice === 'delete' ? `Delete bid and ${plural(rows)}` : 'Delete bid, move rows'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
