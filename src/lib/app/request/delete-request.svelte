<!--
	Deleting a request, from the list, the request page or the builder. It reads what would go first
	(`delete-check`), then asks: a draft once, naming it; an issued or closed request with the list
	of what goes and its code typed to enable the button. While an award is in Flow PT it refuses
	and links to the award, to undo it first. The words are `$lib/pure/request-delete`. Deleting
	never writes to Flow PT.
-->
<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import FieldLabel from '$lib/app/field-label.svelte';
	import Notice from '$lib/app/notice.svelte';
	import { api } from '$lib/api';
	import { codeMatches, deletionPlan, type Deleted, type DeletionFacts } from '$lib/pure/request-delete';
	import { requestHref } from '$lib/pure/routes';

	let {
		open = $bindable(false),
		projectId,
		requestId,
		ondeleted
	}: {
		open?: boolean;
		projectId: number;
		requestId: string;
		ondeleted: (deleted: Deleted) => void;
	} = $props();

	let facts = $state<DeletionFacts | null>(null);
	let readError = $state<string | null>(null);
	let typed = $state('');
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	const uid = $props.id();

	const plan = $derived(facts ? deletionPlan(facts) : null);
	const ready = $derived(plan !== null && plan.kind !== 'refused' && (!plan.typed || codeMatches(typed, facts!.code)));

	$effect(() => {
		if (!open) return;
		const id = requestId;
		facts = null;
		readError = null;
		deleteError = null;
		typed = '';
		api.deleteCheck(projectId, id).then(
			(answer) => {
				if (open && id === requestId) facts = answer.facts;
			},
			(error) => (readError = error instanceof Error ? error.message : String(error))
		);
	});

	async function remove(): Promise<void> {
		if (!facts || !ready) return;
		deleting = true;
		deleteError = null;
		try {
			const { deleted } = await api.deleteRequest(projectId, facts.id, plan?.kind === 'issued' ? typed : facts.code);
			open = false;
			ondeleted(deleted);
		} catch (error) {
			deleteError = error instanceof Error ? error.message : String(error);
		} finally {
			deleting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg" data-slot="delete-request" data-kind={plan?.kind ?? 'loading'}>
		{#if readError}
			<Dialog.Header>
				<Dialog.Title>Could not read the request</Dialog.Title>
			</Dialog.Header>
			<Notice tone="destructive" title="Nothing deleted.">{' '}{readError}</Notice>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (open = false)}>Close</Button>
			</Dialog.Footer>
		{:else if !facts || !plan}
			<Dialog.Header>
				<Dialog.Title>Delete the request</Dialog.Title>
				<Dialog.Description>Reading what it holds…</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (open = false)}>Keep it</Button>
				<Button variant="destructive" disabled>Delete</Button>
			</Dialog.Footer>
		{:else if plan.kind === 'refused'}
			<Dialog.Header>
				<Dialog.Title>{facts.code} cannot be deleted yet</Dialog.Title>
				<Dialog.Description>{facts.title ?? 'Untitled request'}, round {facts.round}.</Dialog.Description>
			</Dialog.Header>
			<Notice tone="warning" data-slot="delete-refused">{plan.reason}</Notice>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (open = false)}>Close</Button>
				<Button href={`${requestHref({ id: facts.id, status: facts.status, projectId })}#award`} onclick={() => (open = false)} data-slot="open-award">Open the award</Button>
			</Dialog.Footer>
		{:else}
			<Dialog.Header>
				<Dialog.Title>{plan.title}</Dialog.Title>
				<Dialog.Description>{facts.title ?? 'Untitled request'}. {plan.kind === 'draft' ? 'This goes:' : 'This goes, for good:'}</Dialog.Description>
			</Dialog.Header>
			<ul class="flex list-disc flex-col gap-1 pl-5 text-sm" data-slot="delete-lines">
				{#each plan.lines as line (line)}<li>{line}</li>{/each}
			</ul>
			<p class="text-muted-foreground text-sm">This cannot be undone. Nothing in Flow PT changes.</p>
			{#if plan.typed}
				<div class="flex flex-col gap-1.5">
					<FieldLabel for={`${uid}-code`} required>Type <span class="font-mono">{facts.code}</span> to delete it</FieldLabel>
					<Input
						id={`${uid}-code`}
						bind:value={typed}
						autocomplete="off"
						spellcheck={false}
						aria-required="true"
						class="font-mono"
						onkeydown={(e) => e.key === 'Enter' && ready && void remove()}
						data-slot="delete-code"
					/>
				</div>
			{/if}
			{#if deleteError}<Notice tone="destructive" title="Not deleted.">{' '}{deleteError}</Notice>{/if}
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (open = false)} disabled={deleting}>Keep it</Button>
				<Button variant="destructive" onclick={() => void remove()} disabled={!ready || deleting} data-slot="delete-now">{deleting ? 'Deleting…' : plan.confirm}</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
