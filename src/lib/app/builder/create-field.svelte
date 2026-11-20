<!--
	Create a missing Shot or Asset field in Flow PT, from the mapping. It shows exactly what is sent:
	the entity type, the display name, the API name the site will give it, the data type, a list's
	values, all editable before the create. It says the field is for everyone on the site, and
	whether the person may create fields (132). When they may not, it says so and points to the way
	that needs no field: set it per item in the request. Plan and answer in `$lib/pure/field-create`.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import Info from '@lucide/svelte/icons/info';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Notice from '$lib/app/notice.svelte';
	import FormField from './form-field.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { answerWords, createDraft, planCreate, type CreateAnswer, type CreateRight } from '$lib/pure/field-create';
	import { slotsFor, type ItemKind, type Slot } from '$lib/pure/field-map';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, kind, slot, onBack, onCreated }: { builder: Builder; kind: ItemKind; slot: Slot; onBack: () => void; onCreated: (line: string) => void } = $props();

	const spec = $derived(slotsFor(kind).find((s) => s.slot === slot));
	const entityType = $derived(kind === 'shot' ? 'Shot' : 'Asset');
	const first = untrack(() => createDraft(kind, slot)) ?? { display: '', values: [] };
	let display = $state(first.display);
	let valuesText = $state(first.values.join('\n'));
	let tried = $state(false);
	let creating = $state(false);
	let answer = $state<CreateAnswer | null>(null);
	let right = $state<CreateRight | null>(null);

	$effect(() => {
		void builder.createRight().then((r) => (right = r));
	});

	const plan = $derived(planCreate(kind, slot, { display, values: valuesText.split(/\r?\n/) }, builder.schemaOf(kind)));
	const problemOf = (field: 'display' | 'values') => (plan.ok ? undefined : plan.problems.find((p) => p.field === field));
	const shownProblem = (field: 'display' | 'values') => {
		const p = problemOf(field);
		return p && (tried || (field === 'display' ? display.trim() !== '' : false)) ? { tone: 'error' as const, message: p.message } : undefined;
	};
	const TYPE_WORDS = { text: 'Text', number: 'Number', list: 'List' } as const;

	async function create(): Promise<void> {
		tried = true;
		if (!plan.ok || right?.state === 'no') return;
		creating = true;
		answer = null;
		try {
			const result = await builder.createField(plan);
			if (result.state === 'created' || result.state === 'renamed') onCreated(answerWords(result, entityType));
			else answer = result;
		} catch (error) {
			answer = { state: 'failed', status: 0, title: error instanceof Error ? error.message : String(error) };
		} finally {
			creating = false;
		}
	}
</script>

<Dialog.Header class="border-border border-b px-5 pt-5 pb-4">
	<Dialog.Title>Create a {spec?.label.toLowerCase()} field on {entityType}</Dialog.Title>
	<Dialog.Description>This is what Flow PT receives. Change the name or the values before you create it.</Dialog.Description>
</Dialog.Header>

<form class="flex min-h-0 flex-col gap-5 overflow-y-auto px-5 py-4" onsubmit={(e) => (e.preventDefault(), void create())} id="create-field-form" data-slot="create-field">
	<dl class="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
		<dt class="text-muted-foreground">Entity type</dt>
		<dd class="font-medium">{entityType}</dd>
		<dt class="text-muted-foreground">Data type</dt>
		<dd class="font-medium">{spec?.create ? TYPE_WORDS[spec.create.dataType] : ''}</dd>
		<dt class="text-muted-foreground">API name</dt>
		<dd>
			{#if plan.ok}
				<span class="font-mono text-xs font-medium" data-slot="api-name">{plan.name}</span>
				<span class="text-muted-foreground text-xs">Flow PT makes it from the display name.</span>
			{:else}
				<span class="text-muted-foreground text-xs">Made from the display name once it is valid.</span>
			{/if}
		</dd>
	</dl>

	<FormField id="create-display" label="Display name" mark="required" hint="What people see in Flow PT. Plain letters, digits and spaces." problem={shownProblem('display')}>
		{#snippet children({ id, describedBy, invalid })}
			<Input {id} bind:value={display} aria-invalid={invalid ? 'true' : undefined} aria-describedby={describedBy} autocomplete="off" />
		{/snippet}
	</FormField>

	{#if spec?.create?.dataType === 'list'}
		<FormField id="create-values" label="Values" mark="required" hint="One per line, in the order Flow PT lists them." problem={shownProblem('values')}>
			{#snippet children({ id, describedBy, invalid })}
				<Textarea {id} class="min-h-28 font-mono text-sm" bind:value={valuesText} aria-invalid={invalid ? 'true' : undefined} aria-describedby={describedBy} />
			{/snippet}
		</FormField>
	{/if}

	<Notice tone="warning" title="This changes the site for everyone.">
		{' '}It adds a field to every {entityType} on the site, shown in every project. It starts empty. Fill it in Flow PT, and {entityType === 'Shot' ? 'shots' : 'assets'} you add after read it. This app never writes to it.
	</Notice>

	<div class="flex items-start gap-2 text-sm" data-slot="create-right" data-state={right?.state ?? 'reading'} role="status">
		{#if !right}
			<LoaderCircle class="text-muted-foreground mt-0.5 size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
			<span class="text-muted-foreground">Checking who may create fields…</span>
		{:else if right.state === 'yes'}
			<Check class="text-success mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<span>It needs the right to create fields. {right.reason}</span>
		{:else if right.state === 'unknown'}
			<Info class="text-info mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<span>It needs the right to create fields. {right.reason}</span>
		{/if}
	</div>
	{#if right?.state === 'no'}
		<Notice tone="destructive" title="You cannot create this field.">
			{' '}{right.reason} Until then, set {spec?.label.toLowerCase()} per item in the request. It stays in the request only.
		</Notice>
	{/if}
	{#if answer}
		<Notice tone="destructive" data-slot="create-answer">{answerWords(answer, entityType)}</Notice>
	{/if}
</form>

<Dialog.Footer class="border-border mx-0 mb-0 rounded-b-xl border-t px-5 py-3">
	<Button variant="outline" onclick={onBack} disabled={creating}>Back to the fields</Button>
	<Button type="submit" form="create-field-form" disabled={creating || right?.state === 'no' || !right} data-slot="create-confirm">
		{creating ? 'Creating…' : 'Create in Flow PT'}
	</Button>
</Dialog.Footer>
