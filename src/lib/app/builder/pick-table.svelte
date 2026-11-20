<!--
	Adding Shots or Assets from Flow PT: the project's rows in the registry's EntityTable, filtered by
	code, Sequence, Episode, status and type, as sg-task-templates' entities screen. A tick freezes
	the row into the request at once (`$lib/pure/pick`); "Add all" reads every row the filter
	matches. Nothing here writes to Flow PT.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import Search from '@lucide/svelte/icons/search';
	import { createEntitySource, resolveColumns, type CollectionColumn, type EntityRef } from 'sg-widgets-core';
	import Notice from '$lib/app/notice.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import EntityTable from '$lib/components/entity-table.svelte';
	import EntityMultiPicker from '$lib/components/entity-multi-picker.svelte';
	import ListMultiPicker from '$lib/components/list-multi-picker.svelte';
	import StatusMultiPicker from '$lib/components/status-multi-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { liveContext } from '$lib/live';
	import { searchAll } from '$lib/io/reads';
	import { EPISODE_FROM_SEQUENCE, type ItemKind } from '$lib/pure/field-map';
	import { EMPTY_FILTER, filterContext, isFiltered, pickColumns, pickFilters, selectionRefs, sequenceOptions, typeOptions, type PickFilter } from '$lib/pure/pick';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, kind }: { builder: Builder; kind: ItemKind } = $props();

	const type = $derived(kind === 'shot' ? 'Shot' : 'Asset');
	const noun = $derived(kind === 'shot' ? 'shots' : 'assets');
	const context = liveContext();

	let filter = $state<PickFilter>({ ...EMPTY_FILTER });
	let search = $state('');
	$effect(() => {
		const next = search;
		const timer = setTimeout(() => (filter = { ...untrack(() => filter), search: next }), 250);
		return () => clearTimeout(timer);
	});

	const ready = $derived(builder.data.state === 'ready' && builder.mapping !== null && builder.state.project !== null ? builder.data.value : null);
	const mapping = $derived(builder.mapping?.[kind] ?? {});
	const schema = $derived(builder.schemaOf(kind));
	const fctx = $derived(ready && builder.state.project ? filterContext(kind, builder.state.project.id, mapping, schema, ready.sequences) : null);
	const result = $derived(fctx ? pickFilters(filter, fctx) : null);
	const filters = $derived(result?.kind === 'filters' ? result.filters : null);
	const options = $derived(ready ? sequenceOptions(ready.sequences) : { sequences: [], episodes: [] });
	const types = $derived(typeOptions(mapping.type ? schema[mapping.type] : undefined));
	const items = $derived(kind === 'shot' ? builder.state.shots : builder.state.assets);
	const selection = $derived(selectionRefs(items));

	let source = $state.raw<ReturnType<typeof createEntitySource> | null>(null);
	let columns = $state<CollectionColumn[]>([]);
	let selectingAll = $state(false);
	let selectError = $state<string | null>(null);

	// The table is built once the project is read; a new kind or mapping builds it again.
	$effect(() => {
		if (!ready) return;
		const specs = pickColumns(kind, mapping, schema);
		const fields = [...new Set([...builder.fieldsFor(kind), ...specs.map((s) => s.path)])];
		const initial = untrack(() => filters);
		source = createEntitySource({
			client: context.client,
			entityType: type,
			fields,
			filters: initial,
			sort: [{ path: 'code', descending: false }],
			pageSize: 100,
			mode: 'infinite'
		});
		let live = true;
		void resolveColumns(context.schema, type, specs).then((next) => live && (columns = next));
		return () => {
			live = false;
		};
	});

	async function selectAll(): Promise<void> {
		if (!filters) return;
		selectingAll = true;
		selectError = null;
		try {
			builder.addRows(kind, await searchAll(context.client, type, filters, builder.fieldsFor(kind), 'code'));
		} catch (error) {
			selectError = error instanceof Error ? error.message : String(error);
		} finally {
			selectingAll = false;
		}
	}

	function onSelection(refs: EntityRef[]): void {
		void builder.select(kind, refs.map((r) => r.id), source?.rows ?? []).catch((error) => (selectError = error instanceof Error ? error.message : String(error)));
	}

	const ids = (values: string[]) => values.map(Number);
	const codes = (values: readonly number[]) => values.map(String);
</script>

{#if builder.data.state === 'error'}
	<PageState state="error" title="Could not read the project" line={builder.data.message} />
{:else if !ready || !fctx}
	<PageState state="loading" title="Reading the project…" />
{:else}
	<div class="flex flex-wrap items-center gap-2" data-slot="pick-filters">
		<div class="relative w-full sm:w-56">
			<Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
			<Input class="h-8 pl-8" type="search" placeholder={`Search ${noun} by code`} bind:value={search} aria-label={`Search ${noun} by code`} data-slot="pick-search" data-focus-first />
		</div>
		{#if fctx.sequenceField}
			<ListMultiPicker
				class="w-44"
				size="sm"
				options={options.sequences}
				value={codes(filter.sequences)}
				searchable
				placeholder="Any sequence"
				searchPlaceholder="Search sequences…"
				onValueChange={(v) => (filter = { ...filter, sequences: ids(v) })}
			/>
		{/if}
		{#if fctx.episodeField === EPISODE_FROM_SEQUENCE && options.episodes.length > 0}
			<ListMultiPicker
				class="w-40"
				size="sm"
				options={options.episodes}
				value={codes(filter.episodes)}
				searchable
				placeholder="Any episode"
				onValueChange={(v) => (filter = { ...filter, episodes: ids(v) })}
			/>
		{:else if fctx.episodeField && fctx.episodeField !== EPISODE_FROM_SEQUENCE}
			<EntityMultiPicker
				class="w-40"
				size="sm"
				{context}
				entityTypes={['Episode']}
				projectId={builder.state.project?.id}
				value={filter.episodes.map((id) => ({ type: 'Episode', id }))}
				placeholder="Any episode"
				onValueChange={(v) => (filter = { ...filter, episodes: v.map((r) => r.id) })}
			/>
		{/if}
		{#if fctx.statusField}
			<StatusMultiPicker
				class="w-44"
				size="sm"
				{context}
				entityType={type}
				projectId={builder.state.project?.id}
				value={[...filter.statuses]}
				placeholder="Any status"
				onValueChange={(v) => (filter = { ...filter, statuses: v })}
			/>
		{/if}
		{#if fctx.typeField && types.length > 0}
			<ListMultiPicker
				class="w-40"
				size="sm"
				options={types}
				value={[...filter.types]}
				placeholder="Any type"
				onValueChange={(v) => (filter = { ...filter, types: v })}
			/>
		{/if}
		{#if isFiltered(filter) || search}
			<Button size="sm" variant="ghost" onclick={() => ((filter = { ...EMPTY_FILTER }), (search = ''))}>Clear filters</Button>
		{/if}
		<div class="ml-auto flex items-center gap-2">
			<Button size="sm" variant="outline" onclick={() => void selectAll()} disabled={selectingAll || !filters} data-slot="add-all">
				{selectingAll ? 'Adding…' : isFiltered(filter) ? `Add all filtered ${noun}` : `Add all ${noun}`}
			</Button>
		</div>
	</div>
	{#if selectError}<Notice tone="destructive" title="Could not add them.">{' '}{selectError}</Notice>{/if}

	{#if result?.kind === 'none'}
		<Notice tone="info">No Sequence is in both the Sequence and the Episode picked. Change one of them.</Notice>
	{:else if source}
		<EntityTable
			{source}
			bind:columns
			{context}
			projectId={builder.state.project?.id}
			{filters}
			selectable
			{selection}
			onSelectionChange={onSelection}
			paging="scroll"
			maxHeight="max(20rem, calc(100dvh - 21rem))"
			density="compact"
			emptyLabel={isFiltered(filter) ? `No ${noun} match these filters.` : `This project has no ${noun}.`}
		/>
	{/if}
{/if}
