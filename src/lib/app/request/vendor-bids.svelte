<!--
	The bids an invited vendor answers, changed on an issued request until it submits an answer: every
	bid, or some, one at least. The server refuses it once the vendor has answered, with the reason.
-->
<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Notice from '$lib/app/notice.svelte';
	import type { Id, RequestPackage } from '$lib/pure/model';

	let {
		open = $bindable(false),
		vendor,
		packages,
		value,
		busy,
		error,
		onSave
	}: {
		open?: boolean;
		vendor: string;
		packages: readonly RequestPackage[];
		/** The bids it answers now. Null: every bid. */
		value: readonly Id[] | null;
		busy: boolean;
		error: string | null;
		onSave: (next: Id[] | null) => void;
	} = $props();

	let picked = $state<Id[]>([]);
	$effect(() => {
		if (open) picked = value ? [...value] : packages.map((p) => p.id);
	});

	function toggle(id: Id): void {
		picked = picked.includes(id) ? (picked.length > 1 ? picked.filter((p) => p !== id) : picked) : [...picked, id];
	}
	const every = $derived(picked.length === packages.length);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-sm" data-slot="vendor-bids-dialog">
		<Dialog.Header>
			<Dialog.Title>The bids {vendor} answers</Dialog.Title>
			<Dialog.Description>One at least. It sees and prices those alone.</Dialog.Description>
		</Dialog.Header>
		<ul class="flex flex-col gap-1">
			{#each packages as p (p.id)}
				<li>
					<label class="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm">
						<input type="checkbox" checked={picked.includes(p.id)} onchange={() => toggle(p.id)} />{p.name}
					</label>
				</li>
			{/each}
		</ul>
		{#if error}<Notice tone="destructive">{error}</Notice>{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
			<Button onclick={() => onSave(every ? null : [...picked])} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
