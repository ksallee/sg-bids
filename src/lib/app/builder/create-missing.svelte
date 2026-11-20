<!--
	Create the missing Shot and Asset fields in one go, from the mapping. Every concept with no field
	is a row: ticked to create it (unticked stays unmapped), its display name, data type and a list's
	values editable, and the API name the site will give it. That the site changes for everyone, and
	whether the person may create fields (132), are said once. One confirm creates the ticked ones in
	order; each row then says what happened (created and mapped, name taken, refused, not tried), and
	the created ones are mapped. Rules in `$lib/pure/field-create-many`, calls in `createMany`.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Info from '@lucide/svelte/icons/info';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Minus from '@lucide/svelte/icons/minus';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Notice from '$lib/app/notice.svelte';
	import FieldLabel from '$lib/app/field-label.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import type { CreateRight } from '$lib/pure/field-create';
	import { manySummary, missingConcepts, outcomeOf, planMany, rowKey, startRows, type ManyOutcome, type ManyRow, type ManyState } from '$lib/pure/field-create-many';
	import { fieldName } from '$lib/pure/fpt-fields';
	import { cn } from '$lib/utils.js';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, onBack, onDone }: { builder: Builder; onBack: () => void; onDone: (line: string) => void } = $props();

	const missing = untrack(() => (builder.mapping ? missingConcepts(builder.mapping) : []));
	let rows = $state<ManyRow[]>(startRows(missing));
	let right = $state<CreateRight | null>(null);
	let running = $state<number | null>(null);
	let outcomes = $state<Record<string, ManyOutcome | 'skipped'>>({});
	let failure = $state<string | null>(null);

	$effect(() => {
		void builder.createRight().then((r) => (right = r));
	});

	const plan = $derived(planMany(rows, { shot: builder.schemaOf('shot'), asset: builder.schemaOf('asset') }));
	const ticked = $derived(rows.filter((r) => r.checked).length);
	const done = $derived(Object.keys(outcomes).length > 0 && running === null);
	const links = missing.filter((m) => !m.creatable);
	const TYPE_WORDS = { text: 'Text', number: 'Number', list: 'List' } as const;
	const conceptOf = (row: ManyRow) => missing.find((m) => m.kind === row.kind && m.slot === row.slot)!;

	function patch(index: number, next: Partial<ManyRow>): void {
		rows = rows.map((r, i) => (i === index ? { ...r, ...next } : r));
	}

	const problemsOf = (row: ManyRow) => plan.problems[rowKey(row)] ?? [];

	async function create(): Promise<void> {
		if (!plan.ready || right?.state === 'no') return;
		failure = null;
		const creates = plan.creates;
		outcomes = {};
		running = 0;
		try {
			const answers = await builder.createFields(creates, (index, answer) => {
				outcomes = { ...outcomes, [rowKey(creates[index])]: outcomeOf(answer) };
				running = index + 1;
			});
			for (const c of creates.slice(answers.length)) outcomes = { ...outcomes, [rowKey(c)]: 'skipped' };
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			running = null;
		}
	}

	const states = $derived(Object.values(outcomes).map((o): ManyState => (o === 'skipped' ? 'skipped' : o.state)));
</script>

{#snippet outcomeLine(o: ManyOutcome | 'skipped')}
	{#if o === 'skipped'}
		<p class="text-muted-foreground flex items-start gap-1.5 text-xs" data-outcome="skipped"><Minus class="mt-px size-3.5 shrink-0" aria-hidden="true" />Not tried. Flow PT refused an earlier one.</p>
	{:else}
		<p class={cn('flex items-start gap-1.5 text-xs', o.state === 'created' ? 'text-foreground' : o.state === 'taken' ? 'text-foreground' : 'text-destructive')} data-outcome={o.state}>
			{#if o.state === 'created'}
				<Check class="text-success mt-px size-3.5 shrink-0" aria-hidden="true" />
			{:else if o.state === 'taken'}
				<TriangleAlert class="text-warning mt-px size-3.5 shrink-0" aria-hidden="true" />
			{:else}
				<CircleAlert class="mt-px size-3.5 shrink-0" aria-hidden="true" />
			{/if}
			<span>{o.words}</span>
		</p>
	{/if}
{/snippet}

<Dialog.Header class="border-border border-b px-5 pt-5 pb-4">
	<Dialog.Title>Create the missing fields</Dialog.Title>
	<Dialog.Description>Tick the ones to create. Each row is what Flow PT receives. The ones you leave stay unmapped and can still be set per item in the request.</Dialog.Description>
</Dialog.Header>

<form class="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4" onsubmit={(e) => (e.preventDefault(), void create())} id="create-missing-form" data-slot="create-missing">
	<Notice tone="warning" title="This changes the site for everyone.">
		{' '}Each field is added to every Shot or Asset on the site, in every project. It starts empty. Fill it in Flow PT; items you add after read it. This app never writes to it.
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
		<Notice tone="destructive" title="You cannot create fields.">{' '}{right.reason} Until then, set these per item in the request. They stay in the request only.</Notice>
	{/if}

	<div class="border-border overflow-hidden rounded-lg border">
		<div class="text-muted-foreground bg-muted/40 border-border grid grid-cols-[1.5rem_minmax(0,9rem)_minmax(0,1fr)_4.5rem_minmax(0,9rem)] items-center gap-x-3 border-b px-3 py-2 text-xs">
			<span><span class="sr-only">Create</span></span>
			<span>Concept</span>
			<FieldLabel required class="text-xs font-medium">Display name</FieldLabel>
			<span>Type</span>
			<span>API name</span>
		</div>
		<ul class="divide-border flex flex-col divide-y">
			{#each rows as row, i (rowKey(row))}
				{@const concept = conceptOf(row)}
				{@const problems = row.checked ? problemsOf(row) : []}
				{@const outcome = outcomes[rowKey(row)]}
				{@const name = row.display.trim() ? fieldName(row.display.trim()) : null}
				<li class={cn('flex flex-col gap-2 px-3 py-2.5', !row.checked && 'bg-muted/30')} data-row={rowKey(row)}>
					<div class="grid grid-cols-[1.5rem_minmax(0,9rem)_minmax(0,1fr)_4.5rem_minmax(0,9rem)] items-center gap-x-3">
						<Checkbox
							checked={row.checked}
							disabled={running !== null || done}
							aria-label={`Create ${concept.label.toLowerCase()} on ${concept.entityType}`}
							onCheckedChange={(v) => patch(i, { checked: v === true })}
						/>
						<div class="flex min-w-0 flex-col">
							<span class="truncate text-sm font-medium">{concept.label}</span>
							<span class="text-muted-foreground text-xs">{concept.entityType}</span>
						</div>
						<Input
							class="h-8"
							value={row.display}
							disabled={!row.checked || running !== null || done}
							aria-label={`Display name of the ${concept.label.toLowerCase()} field on ${concept.entityType}`}
							aria-required="true"
							aria-invalid={problems.some((p) => p.field === 'display') ? 'true' : undefined}
							oninput={(e) => patch(i, { display: e.currentTarget.value })}
						/>
						<span class="text-sm">{concept.dataType ? TYPE_WORDS[concept.dataType] : ''}</span>
						<span class={cn('truncate font-mono text-xs', !row.checked && 'text-muted-foreground')} title={name ?? undefined} data-slot="api-name">{name ?? 'From the name'}</span>
					</div>
					{#if concept.dataType === 'list' && row.checked && !done}
						<div class="grid grid-cols-[1.5rem_minmax(0,9rem)_minmax(0,1fr)_4.5rem_minmax(0,9rem)] gap-x-3">
							<span></span>
							<FieldLabel required class="pt-1.5 text-xs" for={`values-${rowKey(row)}`}>Values</FieldLabel>
							<Textarea
								id={`values-${rowKey(row)}`}
								class="col-span-3 min-h-16 font-mono text-xs"
								rows={3}
								value={row.values}
								placeholder="One per line"
								disabled={running !== null}
								aria-required="true"
								aria-invalid={problems.some((p) => p.field === 'values') ? 'true' : undefined}
								oninput={(e) => patch(i, { values: e.currentTarget.value })}
							/>
						</div>
					{/if}
					{#each problems as p (p.message)}
						<p class="text-destructive flex items-start gap-1.5 pl-9 text-xs" data-slot="field-problem"><CircleAlert class="mt-px size-3.5 shrink-0" aria-hidden="true" />{p.message}</p>
					{/each}
					{#if outcome}<div class="pl-9">{@render outcomeLine(outcome)}</div>{/if}
				</li>
			{/each}
		</ul>
	</div>

	{#if links.length > 0}
		<p class="text-muted-foreground text-xs" data-slot="link-concepts">
			Not created here: {links.map((l) => `${l.label} on ${l.entityType}`).join(', ')}. A link field also adds a field to the type it links, so an admin adds it in Flow PT.
		</p>
	{/if}
	{#if failure}<Notice tone="destructive" title="The run stopped.">{' '}{failure}</Notice>{/if}
	{#if done}<Notice tone="info" data-slot="create-summary">{manySummary(states)}</Notice>{/if}
</form>

<Dialog.Footer class="border-border mx-0 mb-0 rounded-b-xl border-t px-5 py-3">
	{#if done}
		<Button onclick={() => onDone(manySummary(states))} data-slot="create-missing-done">Back to the fields</Button>
	{:else}
		<Button variant="outline" onclick={onBack} disabled={running !== null}>Back to the fields</Button>
		<Button type="submit" form="create-missing-form" disabled={running !== null || !plan.ready || right?.state === 'no' || !right} data-slot="create-missing-confirm">
			{#if running !== null}Creating {Math.min(running + 1, plan.creates.length)} of {plan.creates.length}…{:else}Create {ticked} {ticked === 1 ? 'field' : 'fields'} in Flow PT{/if}
		</Button>
	{/if}
</Dialog.Footer>
