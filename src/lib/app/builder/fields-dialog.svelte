<!--
	The project's field mapping, a setting out of the request's path: which Flow PT field fills each
	thing a vendor reads. Shots then Assets, one row per concept: its name and what it is for, the
	field, and for a concept with no field, what that means (it can still be set per item in the
	request) and, where the app can, "Create this field in Flow PT". Closing keeps the mapping for
	this project in this browser. Defaults and options from `$lib/pure/field-map`.
-->
<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Notice from '$lib/app/notice.svelte';
	import CreateField from './create-field.svelte';
	import ListPicker from '$lib/components/list-picker.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { mappingWords, slotOptions, slotsFor, type ItemKind, type Slot } from '$lib/pure/field-map';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, open = $bindable(false) }: { builder: Builder; open?: boolean } = $props();

	let creating = $state<{ kind: ItemKind; slot: Slot } | null>(null);
	let created = $state<string | null>(null);
	let copying = $state(false);
	let copyError = $state<string | null>(null);

	const picked = $derived(builder.state.shots.length + builder.state.assets.length);
	const status = $derived(builder.mappingStatus);

	async function copyAgain(): Promise<void> {
		copying = true;
		copyError = null;
		try {
			await builder.refreeze();
		} catch (error) {
			copyError = error instanceof Error ? error.message : String(error);
		} finally {
			copying = false;
		}
	}

	function changed(next: boolean): void {
		if (next) return;
		builder.keepMapping();
		creating = null;
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
									onValueChange={(v) => builder.setMapping(kind, spec.slot, v)}
								/>
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
										<Button size="sm" variant="outline" onclick={() => ((creating = { kind, slot: spec.slot }), (created = null))} data-slot="create-field-open">
											<Plus data-icon="inline-start" />Create this field in Flow PT
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
	<Dialog.Content class="flex max-h-[min(90dvh,52rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" data-slot="fields-dialog">
		{#if creating}
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
					Which field on this site fills each thing a vendor reads. {status ? mappingWords(status).headline : ''} Mapping is optional: anything left unmapped can still be set per item in
					the request. Kept for this project in this browser.
				</Dialog.Description>
			</Dialog.Header>
			<div class="flex min-h-0 flex-col gap-6 overflow-y-auto px-5 py-4">
				{#if created}<Notice tone="info" data-slot="created">{created}</Notice>{/if}
				{#if builder.stale}
					<Notice tone="warning" title="The picked items keep their old values.">
						{' '}{picked} {picked === 1 ? 'item was' : 'items were'} copied with the previous fields. Copying again drops your edits to them.
						{#snippet action()}
							<Button size="sm" variant="outline" onclick={() => void copyAgain()} disabled={copying}>{copying ? 'Copying…' : 'Copy again'}</Button>
						{/snippet}
					</Notice>
				{/if}
				{#if copyError}<Notice tone="destructive" title="Could not copy them again.">{' '}{copyError}</Notice>{/if}
				{@render kindBlock('shot', 'Shots')}
				{@render kindBlock('asset', 'Assets')}
			</div>
			<Dialog.Footer class="border-border mx-0 mb-0 rounded-b-xl border-t px-5 py-3">
				<Button onclick={() => ((open = false), changed(false))} data-slot="fields-done">Done</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
