<!--
	The project's field mapping, a setting out of the request's path: which Flow PT field fills each
	thing a vendor reads. Shots then Assets, one row per concept: its name and what it is for, the
	field, and for a concept with no field, what that means (it can still be set per item in the
	request). When concepts have no field, "Create missing fields" opens one form for all of them
	(`create-missing`); one concept can still be created on its own. A change reads the draft's rows
	again, so every live value follows the mapping. When Description reads the stock field, a line
	suggests a field of the bid's own. Closing keeps the mapping for this project in this browser.
	Defaults and options from `$lib/pure/field-map`.
-->
<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Notice from '$lib/app/notice.svelte';
	import CreateField from './create-field.svelte';
	import CreateMissing from './create-missing.svelte';
	import ListPicker from '$lib/components/list-picker.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { missingConcepts } from '$lib/pure/field-create-many';
	import { mappingWords, slotOptions, slotsFor, type ItemKind, type Slot } from '$lib/pure/field-map';
	import { descriptionAdvice } from '$lib/pure/live-columns';
	import { cn } from '$lib/utils.js';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, open = $bindable(false) }: { builder: Builder; open?: boolean } = $props();

	let creating = $state<{ kind: ItemKind; slot: Slot } | null>(null);
	let creatingMany = $state(false);
	let created = $state<string | null>(null);

	const status = $derived(builder.mappingStatus);
	const missing = $derived(builder.mapping ? missingConcepts(builder.mapping).filter((m) => m.creatable) : []);

	function changed(next: boolean): void {
		if (next) return;
		builder.keepMapping();
		creating = null;
		creatingMany = false;
		created = null;
	}
</script>

{#snippet kindBlock(kind: ItemKind, title: string)}
	{@const data = builder.data}
	{#if data.state === 'ready' && builder.mapping}
		{@const schema = kind === 'shot' ? data.value.shape.shot : data.value.shape.asset}
		<section class="flex flex-col gap-1" aria-labelledby={`map-${kind}`} data-slot={`mapping-${kind}`}>
			<div class="flex items-baseline gap-2">
				<h3 id={`map-${kind}`} class="text-sm font-semibold">{title}</h3>
				<span class="text-muted-foreground text-xs tabular-nums">{Object.keys(schema).length} fields on this site</span>
			</div>
			<dl class="divide-border flex flex-col divide-y">
				{#each slotsFor(kind) as spec (spec.slot)}
					{@const options = slotOptions(kind, spec.slot, schema, data.value.shape.site)}
					{@const value = builder.mapping[kind][spec.slot] ?? null}
					<div class="grid gap-x-6 gap-y-1.5 py-3 sm:grid-cols-[11rem_minmax(0,1fr)]" data-slot-row={`${kind}-${spec.slot}`}>
						<dt class="flex flex-col pt-1">
							<span class="text-sm font-medium">{spec.label}</span>
							<span class="text-muted-foreground text-xs">{spec.line}</span>
						</dt>
						<dd class="flex min-w-0 flex-col gap-2">
							{#if options.length > 0}
								<ListPicker
									{options}
									{value}
									showCode
									searchable={options.length > 8}
									clearable
									placeholder="Not mapped"
									clearLabel="Leave it unmapped"
									onValueChange={(v) => void builder.setMapping(kind, spec.slot, v)}
								/>
							{/if}
							{#if spec.slot === 'description' && descriptionAdvice(kind, builder.mapping[kind])}
								<p class="border-warning/70 flex flex-col items-start gap-1.5 border-l-2 pl-2.5 text-xs" data-slot="description-advice">
									<span class="text-foreground">{descriptionAdvice(kind, builder.mapping[kind])}</span>
									<Button size="sm" variant="outline" class="h-7" onclick={() => void builder.setMapping(kind, 'description', null)} data-slot="description-unmap">Leave it unmapped</Button>
								</p>
							{/if}
							{#if value === null}
								<p class="text-muted-foreground text-xs" data-slot="unmapped-line">
									{#if options.length === 0}No field on this site fits.{' '}{:else}Not mapped.{' '}{/if}
									{#if spec.create}
										Set it per item in the request instead. It stays in the request only.
									{:else}
										A link field also adds a field to {spec.linksTo}, so an admin adds it in Flow PT.
									{/if}
								</p>
								{#if spec.create}
									<div>
										<Button size="sm" variant="ghost" class="-ml-2" onclick={() => ((creating = { kind, slot: spec.slot }), (created = null))} data-slot="create-field-open">
											<Plus data-icon="inline-start" />Create only this one
										</Button>
									</div>
								{/if}
							{/if}
						</dd>
					</div>
				{/each}
			</dl>
		</section>
	{/if}
{/snippet}

<Dialog.Root bind:open onOpenChange={changed}>
	<Dialog.Content class={cn("flex max-h-[min(90dvh,52rem)] flex-col gap-0 overflow-hidden p-0", creatingMany ? "sm:max-w-3xl" : "sm:max-w-2xl")} data-slot="fields-dialog">
		{#if creatingMany}
			<CreateMissing
				{builder}
				onBack={() => (creatingMany = false)}
				onDone={(line) => {
					created = line;
					creatingMany = false;
				}}
			/>
		{:else if creating}
			<CreateField
				{builder}
				kind={creating.kind}
				slot={creating.slot}
				onBack={() => (creating = null)}
				onCreated={(line) => {
					created = line;
					creating = null;
				}}
			/>
		{:else}
			<Dialog.Header class="border-border border-b px-5 pt-5 pb-4">
				<Dialog.Title>Fields from Flow PT</Dialog.Title>
				<Dialog.Description>
					Which field on this site fills each thing a vendor reads. {status ? mappingWords(status).headline : ''} A mapped field is live: editing it in the request changes Flow PT.
					Anything left unmapped can still be set per item, in the request only. Kept for this project in this browser.
				</Dialog.Description>
			</Dialog.Header>
			<div class="flex min-h-0 flex-col gap-6 overflow-y-auto px-5 py-4">
				{#if created}<Notice tone="info" data-slot="created">{created}</Notice>{/if}
				{#if missing.length > 0}
					<Notice tone="info" data-slot="missing-fields">
						{missing.length === 1 ? 'One thing a vendor reads has' : `${missing.length} things a vendor reads have`} no field on this site: {missing.map((m) => `${m.label.toLowerCase()} on ${m.entityType}`).join(', ')}.
						{#snippet action()}
							<Button size="sm" onclick={() => ((creatingMany = true), (created = null))} data-slot="create-missing-open"><Plus data-icon="inline-start" />Create missing fields</Button>
						{/snippet}
					</Notice>
				{/if}
				{#if builder.live.state === 'error'}<Notice tone="destructive" title="Could not read the rows again.">{' '}{builder.live.message}</Notice>{/if}
				{@render kindBlock('shot', 'Shots')}
				{@render kindBlock('asset', 'Assets')}
			</div>
			<Dialog.Footer class="border-border mx-0 mb-0 rounded-b-xl border-t px-5 py-3">
				<Button onclick={() => ((open = false), changed(false))} data-slot="fields-done">Done</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
