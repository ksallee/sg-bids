<!--
	Step 3, Fields: which Flow PT field fills each thing a request carries. Shots and Assets side by
	side from lg, one row per slot: what the request calls it and why on the left, the field on the
	right. Defaults come from `$lib/pure/field-map`; a pick is kept per project in this browser.
-->
<script lang="ts">
	import Notice from '$lib/app/notice.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import Section from '$lib/app/section.svelte';
	import ListPicker from '$lib/components/list-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { slotOptions, slotsFor, type ItemKind } from '$lib/pure/field-map';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder }: { builder: Builder } = $props();

	let copying = $state(false);
	let copyError = $state<string | null>(null);

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

	const picked = $derived(builder.state.shots.length + builder.state.assets.length);
</script>

{#snippet kindBlock(kind: ItemKind, title: string)}
	{@const data = builder.data}
	{#if data.state === 'ready' && builder.mapping}
		{@const schema = kind === 'shot' ? data.value.shape.shot : data.value.shape.asset}
		<Section {title} meta={`${Object.keys(schema).length} fields on this site`} card>
			<dl class="divide-border flex flex-col divide-y" data-slot={`mapping-${kind}`}>
				{#each slotsFor(kind) as spec (spec.slot)}
					{@const options = slotOptions(kind, spec.slot, schema, data.value.shape.site)}
					<div class="grid items-center gap-x-4 gap-y-1.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[11rem_1fr]">
						<dt class="flex flex-col">
							<span class="text-sm font-medium">{spec.label}</span>
							<span class="text-muted-foreground text-xs">{spec.line}</span>
						</dt>
						<dd class="min-w-0">
							{#if options.length === 0}
								<span class="text-muted-foreground text-sm">No field on this site fits.</span>
							{:else}
								<ListPicker
									{options}
									value={builder.mapping[kind][spec.slot] ?? null}
									showCode
									searchable={options.length > 8}
									clearable
									placeholder="Not mapped"
									clearLabel="Leave it out"
									onValueChange={(v) => builder.setMapping(kind, spec.slot, v)}
								/>
							{/if}
						</dd>
					</div>
				{/each}
			</dl>
		</Section>
	{/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	{#if builder.data.state === 'loading' || builder.data.state === 'idle'}
		<PageState state="loading" title="Reading the project's fields…" />
	{:else if builder.data.state === 'error'}
		<PageState state="error" title="Could not read the fields" line={builder.data.message} />
	{:else}
		<div class="flex w-full max-w-6xl flex-col gap-6 px-6 py-6">
			<p class="text-muted-foreground max-w-[65ch] text-sm">
				Sites name their fields differently. Each line says which Flow PT field fills what vendors read. The picks were guessed from the field names. Change any of them. They are kept for
				this project.
			</p>
			{#if builder.stale}
				<Notice tone="warning" title="The picked items keep their old values.">
					{' '}{picked} {picked === 1 ? 'item was' : 'items were'} copied with the previous fields. Copying again drops your edits to them.
					{#snippet action()}
						<Button size="sm" variant="outline" onclick={() => void copyAgain()} disabled={copying}>{copying ? 'Copying…' : 'Copy again'}</Button>
					{/snippet}
				</Notice>
			{/if}
			{#if copyError}<Notice tone="destructive" title="Could not copy them again.">{' '}{copyError}</Notice>{/if}
			<div class="grid items-start gap-6 lg:grid-cols-2">
				{@render kindBlock('shot', 'Shots')}
				{@render kindBlock('asset', 'Assets')}
			</div>
		</div>
	{/if}
</div>
