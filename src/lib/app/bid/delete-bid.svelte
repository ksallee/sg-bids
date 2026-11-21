<!--
	Deleting a bid, from the Bids list or the bid's page. It reads what would happen first
	(`bid-delete-check`), then asks once: the draft requests it leaves, with each vendor's choice of
	it, and the requests it went out in, which keep what was issued. Refused, it says why: a vendor of
	a draft is invited to this bid alone. Deleting never writes to Flow PT.
-->
<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Notice from '$lib/app/notice.svelte';
	import { bidsApi, type BidDeleted, type BidDeletionFacts } from '$lib/api';
	import { wentOutIn } from '$lib/pure/request-bids';

	let {
		open = $bindable(false),
		projectId,
		bidId,
		ondeleted
	}: {
		open?: boolean;
		projectId: number;
		bidId: string;
		ondeleted: (deleted: BidDeleted) => void;
	} = $props();

	let facts = $state<BidDeletionFacts | null>(null);
	let readError = $state<string | null>(null);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);

	$effect(() => {
		if (!open) return;
		const id = bidId;
		facts = null;
		readError = null;
		deleteError = null;
		bidsApi.deleteCheck(projectId, id).then(
			(answer) => {
				if (open && id === bidId) facts = answer.facts;
			},
			(error) => (readError = error instanceof Error ? error.message : String(error))
		);
	});

	async function remove(): Promise<void> {
		if (!facts) return;
		deleting = true;
		deleteError = null;
		try {
			const { deleted } = await bidsApi.delete(projectId, bidId);
			open = false;
			ondeleted(deleted);
		} catch (error) {
			deleteError = error instanceof Error ? error.message : String(error);
		} finally {
			deleting = false;
		}
	}

	const list = (rows: BidDeletionFacts['drafts']) => wentOutIn(rows).map((r) => r.label).join(', ');
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md" data-slot="bid-delete">
		<Dialog.Header>
			<Dialog.Title>{facts ? `Delete ${facts.name}?` : 'Delete the bid?'}</Dialog.Title>
			<Dialog.Description>Its rows go with it. Flow PT is not changed.</Dialog.Description>
		</Dialog.Header>
		{#if readError}
			<Notice tone="destructive">{readError}</Notice>
		{:else if !facts}
			<p class="text-muted-foreground text-sm">Reading where it is used…</p>
		{:else}
			<ul class="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
				{#if facts.drafts.length > 0}
					<li>It leaves the draft {facts.drafts.length === 1 ? 'request' : 'requests'} <span class="text-foreground">{list(facts.drafts)}</span>, and each vendor's choice of it there.</li>
				{/if}
				{#if facts.issued.length > 0}
					<li><span class="text-foreground">{list(facts.issued)}</span> {facts.issued.length === 1 ? 'keeps' : 'keep'} what was issued. Vendors see no change.</li>
				{/if}
				{#if facts.drafts.length === 0 && facts.issued.length === 0}
					<li>It is in no request.</li>
				{/if}
				<li>This cannot be undone.</li>
			</ul>
		{/if}
		{#if deleteError}<Notice tone="destructive" title="Not deleted.">{' '}{deleteError}</Notice>{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={deleting}>Keep it</Button>
			<Button variant="destructive" onclick={() => void remove()} disabled={!facts || deleting} data-slot="bid-delete-now">{deleting ? 'Deleting…' : 'Delete bid'}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
