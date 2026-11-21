<!--
	Delete several requests from the Requests list. It reads what each would take first
	(`delete-check`), then asks once: drafts alone on a press, a request sent to vendors in it with
	the word typed. A request whose award is in Flow PT is skipped and named. Then each goes with the
	server's own delete, one call each, and `ondone` says which went and which did not. The words are
	`$lib/pure/request-select`. Deleting never writes to Flow PT.
-->
<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import FieldLabel from '$lib/app/field-label.svelte';
	import Notice from '$lib/app/notice.svelte';
	import { api } from '$lib/api';
	import { requestName } from '$lib/pure/request-delete';
	import { bulkDeletePlan, DELETE_WORD, splitDelete, wordMatches, type DeleteCheck, type DeleteSplit, type Missed } from '$lib/pure/request-select';

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

	let split = $state<DeleteSplit | null>(null);
	let typed = $state('');
	let busy = $state(false);
	let done = $state(0);
	const uid = $props.id();

	const plan = $derived(split ? bulkDeletePlan(split) : null);
	const ready = $derived(plan !== null && plan.confirm !== null && (!plan.typed || wordMatches(typed)));
	const going = $derived(split ? split.drafts.length + split.sent.length : 0);

	$effect(() => {
		if (!open) return;
		const asked = rows;
		split = null;
		typed = '';
		done = 0;
		Promise.all(
			asked.map((row) =>
				api.deleteCheck(row.projectId, row.id).then(
					(answer): DeleteCheck => ({ facts: answer.facts }),
					(error): DeleteCheck => ({ id: row.id, name: requestName(row), reason: error instanceof Error ? error.message : String(error) })
				)
			)
		).then((checks) => {
			if (open && asked === rows) split = splitDelete(checks);
		});
	});

	async function remove(): Promise<void> {
		if (!split || !ready) return;
		busy = true;
		const projectOf = new Map(rows.map((r) => [r.id, r.projectId]));
		const went: string[] = [];
		const missed: Missed[] = [...split.skipped];
		for (const facts of [...split.drafts, ...split.sent]) {
			try {
				await api.deleteRequest(projectOf.get(facts.id) ?? 0, facts.id, requestName(facts));
				went.push(facts.id);
			} catch (error) {
				missed.push({ id: facts.id, name: requestName(facts), reason: error instanceof Error ? error.message : String(error) });
			}
			done++;
		}
		busy = false;
		open = false;
		ondone({ went, missed });
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg" data-slot="bulk-delete" data-typed={plan?.typed ?? undefined}>
		{#if !plan}
			<Dialog.Header>
				<Dialog.Title>Delete {rows.length} {rows.length === 1 ? 'request' : 'requests'}</Dialog.Title>
				<Dialog.Description>Reading what they hold…</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (open = false)}>Keep them</Button>
				<Button variant="destructive" disabled>Delete</Button>
			</Dialog.Footer>
		{:else}
			<Dialog.Header>
				<Dialog.Title>{plan.title}</Dialog.Title>
				{#if plan.confirm}<Dialog.Description>{plan.typed ? 'This goes, for good:' : 'This goes:'}</Dialog.Description>{/if}
			</Dialog.Header>
			{#if plan.lines.length > 0}
				<ul class="flex list-disc flex-col gap-1 pl-5 text-sm" data-slot="bulk-delete-lines">
					{#each plan.lines as line (line)}<li>{line}</li>{/each}
				</ul>
			{/if}
			{#each plan.skipped as line (line)}
				<Notice tone="warning" data-slot="bulk-delete-skipped">{line}</Notice>
			{/each}
			{#if plan.confirm}
				<p class="text-muted-foreground text-sm">This cannot be undone. Nothing in Flow PT changes.</p>
			{/if}
			{#if plan.typed}
				<div class="flex flex-col gap-1.5">
					<FieldLabel for={`${uid}-word`} required>Type <span class="font-semibold">{DELETE_WORD}</span> to delete them</FieldLabel>
					<Input
						id={`${uid}-word`}
						bind:value={typed}
						autocomplete="off"
						data-lpignore="true"
						data-1p-ignore
						data-form-type="other"
						spellcheck={false}
						aria-required="true"
						onkeydown={(e) => e.key === 'Enter' && ready && !busy && void remove()}
						data-slot="bulk-delete-word"
					/>
				</div>
			{/if}
			<Dialog.Footer>
				{#if plan.confirm}
					<Button variant="outline" onclick={() => (open = false)} disabled={busy}>Keep them</Button>
					<Button variant="destructive" onclick={() => void remove()} disabled={!ready || busy} data-slot="bulk-delete-now">
						{busy ? `Deleting ${Math.min(done + 1, going)} of ${going}…` : plan.confirm}
					</Button>
				{:else}
					<Button variant="outline" onclick={() => (open = false)}>Close</Button>
				{/if}
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
