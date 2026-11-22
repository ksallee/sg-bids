<!--
	Duplicate several requests from the Requests list: one new draft for each, named after it with
	` copy`, with its details, its vendors and its bids, with the rows or without. One server call
	each, the same as Duplicate for one. The list stays; `ondone` says which went and which did not.
	Names in `$lib/pure/request-select`.
-->
<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { api } from '$lib/api';
	import { copies, type Missed } from '$lib/pure/request-select';
	import DuplicateRows from './duplicate-rows.svelte';

	type Row = { id: string; projectId: number; title: string | null; code: string };

	let {
		open = $bindable(false),
		rows,
		ondone
	}: {
		open?: boolean;
		rows: readonly Row[];
		ondone: (outcome: { went: string[]; missed: Missed[] }) => void;
	} = $props();

	let withRows = $state<'with' | 'without'>('with');
	let busy = $state(false);
	let done = $state(0);
	const list = $derived(copies(rows));

	$effect(() => {
		if (!open) return;
		withRows = 'with';
		done = 0;
	});

	async function duplicate(): Promise<void> {
		busy = true;
		const went: string[] = [];
		const missed: Missed[] = [];
		for (const each of list) {
			try {
				await api.duplicate(each.projectId, { id: each.id, name: each.copy, rows: withRows === 'with' });
				went.push(each.id);
			} catch (error) {
				missed.push({ id: each.id, name: each.name, reason: error instanceof Error ? error.message : String(error) });
			}
			done++;
		}
		busy = false;
		open = false;
		ondone({ went, missed });
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md" data-slot="bulk-duplicate">
		<Dialog.Header>
			<Dialog.Title>Duplicate {list.length} {list.length === 1 ? 'request' : 'requests'}</Dialog.Title>
			<Dialog.Description>Each gets a new draft with its details, its vendors and its bids. Nothing is sent.</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-4" onsubmit={(e) => (e.preventDefault(), void duplicate())}>
			<div class="flex flex-col gap-1.5">
				<p class="text-sm font-semibold">The new drafts</p>
				<ul class="border-border max-h-40 overflow-y-auto rounded-md border text-sm" data-slot="bulk-duplicate-names">
					{#each list as each (each.id)}
						<li class="border-border truncate border-b px-3 py-1.5 last:border-b-0" title={each.copy}>{each.copy}</li>
					{/each}
				</ul>
			</div>
			<DuplicateRows bind:value={withRows} />
			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
				<Button type="submit" disabled={busy || list.length === 0} data-slot="bulk-duplicate-now">
					{busy ? `Duplicating ${done + 1} of ${list.length}…` : `Duplicate ${list.length}`}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
