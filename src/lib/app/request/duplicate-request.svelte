<!--
	Duplicate a request, draft or issued, from the Requests list or its page: a new draft named after
	it, ` copy`, with its details, its vendors and its bids by name. It asks one thing: with the rows,
	or without. Then the new draft opens. Words in `$lib/pure/issue-words`.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import FieldLabel from '$lib/app/field-label.svelte';
	import Notice from '$lib/app/notice.svelte';
	import DuplicateRows from './duplicate-rows.svelte';
	import { api } from '$lib/api';
	import { copyName } from '$lib/pure/issue-words';
	import { requestHref } from '$lib/pure/routes';
	import { MAX_REQUEST_NAME } from '$lib/pure/wire';

	let {
		open = $bindable(false),
		projectId,
		requestId,
		name
	}: {
		open?: boolean;
		projectId: number;
		requestId: string;
		/** The request's name, which the copy's starts from. */
		name: string;
	} = $props();

	let typed = $state('');
	let rows = $state<'with' | 'without'>('with');
	let busy = $state(false);
	let failure = $state<string | null>(null);
	const uid = $props.id();

	$effect(() => {
		if (!open) return;
		typed = copyName(name || 'Request');
		rows = 'with';
		failure = null;
	});

	async function duplicate(): Promise<void> {
		if (!typed.trim()) return;
		busy = true;
		failure = null;
		try {
			const { request } = await api.duplicate(projectId, { id: requestId, name: typed.trim(), rows: rows === 'with' });
			open = false;
			await goto(requestHref({ id: request.id, projectId }));
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md" data-slot="duplicate-request">
		<Dialog.Header>
			<Dialog.Title>Duplicate {name || 'the request'}</Dialog.Title>
			<Dialog.Description>A new draft with its details, its vendors and its bids. Nothing is sent.</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-4" onsubmit={(e) => (e.preventDefault(), void duplicate())}>
			<div class="flex flex-col gap-1.5">
				<FieldLabel for={`${uid}-name`} required>Name</FieldLabel>
				<Input id={`${uid}-name`} bind:value={typed} maxlength={MAX_REQUEST_NAME} autocomplete="off" data-lpignore="true" data-1p-ignore data-form-type="other" aria-required="true" data-slot="duplicate-name" />
			</div>
			<DuplicateRows bind:value={rows} />
			{#if failure}<Notice tone="destructive" title="Not duplicated.">{' '}{failure}</Notice>{/if}
			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
				<Button type="submit" disabled={busy || !typed.trim()} data-slot="duplicate-now">{busy ? 'Duplicating…' : 'Duplicate'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
