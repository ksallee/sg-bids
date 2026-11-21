<!--
	Move or copy the selected rows to another bid of the project. It lists the other bids, with what
	each holds; a row the other bid holds already stays as it is there. The rows go on the server in
	one write (`bid-move-rows`), after the bid on screen is saved.
-->
<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Notice from '$lib/app/notice.svelte';
	import { bidsApi, type BidOverview } from '$lib/api';
	import { cn } from '$lib/utils.js';

	let {
		open = $bindable(false),
		projectId,
		bidId,
		count,
		move,
		onSend
	}: {
		open?: boolean;
		projectId: number;
		bidId: string;
		/** How many rows are selected. */
		count: number;
		move: boolean;
		onSend: (to: BidOverview) => Promise<void>;
	} = $props();

	let others = $state<BidOverview[] | null>(null);
	let readError = $state<string | null>(null);
	let picked = $state<string | null>(null);
	let sending = $state(false);
	let sendError = $state<string | null>(null);

	$effect(() => {
		if (!open) return;
		others = null;
		picked = null;
		readError = null;
		sendError = null;
		bidsApi.list(projectId).then(
			(answer) => (others = answer.bids.filter((b) => b.id !== bidId)),
			(error) => (readError = error instanceof Error ? error.message : String(error))
		);
	});

	async function send(): Promise<void> {
		const to = others?.find((b) => b.id === picked);
		if (!to) return;
		sending = true;
		sendError = null;
		try {
			await onSend(to);
			open = false;
		} catch (error) {
			sendError = error instanceof Error ? error.message : String(error);
		} finally {
			sending = false;
		}
	}

	const rows = $derived(`${count} ${count === 1 ? 'row' : 'rows'}`);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md" data-slot="send-rows">
		<Dialog.Header>
			<Dialog.Title>{move ? `Move ${rows} to another bid` : `Copy ${rows} to another bid`}</Dialog.Title>
			<Dialog.Description>{move ? 'They leave this bid.' : 'They stay in this bid too.'} A row the other bid holds already stays as it is there.</Dialog.Description>
		</Dialog.Header>
		{#if readError}
			<Notice tone="destructive">{readError}</Notice>
		{:else if !others}
			<p class="text-muted-foreground text-sm">Reading the project's bids…</p>
		{:else if others.length === 0}
			<p class="text-muted-foreground text-sm">This project has no other bid. Make one from the Bids page first.</p>
		{:else}
			<ul class="flex max-h-72 flex-col overflow-y-auto rounded-lg border" role="radiogroup" aria-label="To which bid">
				{#each others as b (b.id)}
					<li class="border-b last:border-b-0">
						<label class={cn('hover:bg-muted/50 flex cursor-pointer items-center gap-3 px-3 py-2', picked === b.id && 'bg-primary/5')}>
							<input type="radio" name="send-to" class="accent-primary size-4" checked={picked === b.id} onchange={() => (picked = b.id)} />
							<span class="min-w-0 flex-1 truncate text-sm font-medium">{b.name}</span>
							<span class="text-muted-foreground shrink-0 text-xs tabular-nums">{b.shots} shots, {b.assets} assets</span>
						</label>
					</li>
				{/each}
			</ul>
		{/if}
		{#if sendError}<Notice tone="destructive" title={move ? 'Not moved.' : 'Not copied.'}>{' '}{sendError}</Notice>{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={sending}>Cancel</Button>
			<Button onclick={() => void send()} disabled={!picked || sending} data-slot="send-rows-now">{sending ? (move ? 'Moving…' : 'Copying…') : move ? 'Move' : 'Copy'}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
