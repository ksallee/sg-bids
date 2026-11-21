<!--
	Add from Flow PT: a dialog with a plain list of the project's Shots or Assets, never a second
	table. A line is the thumbnail, the code, the status, and the Sequence (an Asset's type) as quiet
	text. Search by code, filter by Sequence or type, tick lines (Shift for a range), or tick every
	line shown. A line already in the request is ticked and cannot change. "Add N" freezes the
	ticked rows into the bid picked (`addPicked`) and closes; editing happens in the request's table.

	The list reads 100 rows a page, sorted by code, and reads the next page as the end scrolls into
	view, so a project with thousands of Shots opens at once. A thumbnail is a presigned URL that
	expires (081, field_types/image): each opening reads fresh ones, and one that fails to load shows
	the type's glyph. Rules in `$lib/pure/add-list` and `$lib/pure/pick`. Nothing here writes to Flow PT.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import Search from '@lucide/svelte/icons/search';
	import { createEntitySource, type EntityRow, type EntitySource, type EntitySourceState, type StatusRecord } from 'sg-widgets-core';
	import PageState from '$lib/app/page-state.svelte';
	import ListMultiPicker from '$lib/components/list-multi-picker.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import Thumbnail from '$lib/components/thumbnail.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { liveContext } from '$lib/live';
	import { cn } from '$lib/utils.js';
	import type { ItemKind } from '$lib/pure/field-map';
	import { EMPTY_FILTER, filterContext, isFiltered, pickFilters, sequenceOptions, typeOptions } from '$lib/pure/pick';
	import { addLabel, inRequest, listRow, shownState, toggle, toggleShown, type Ticks } from '$lib/pure/add-list';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, kind, onclose }: { builder: Builder; kind: ItemKind; onclose: (added: boolean) => void } = $props();

	const type = $derived(kind === 'shot' ? 'Shot' : 'Asset');
	const noun = $derived(kind === 'shot' ? 'shots' : 'assets');
	const Nouns = $derived(kind === 'shot' ? 'Shots' : 'Assets');
	const context = liveContext();

	const project = $derived(builder.state.project);
	const ready = $derived(builder.data.state === 'ready' && builder.mapping !== null && project !== null ? builder.data.value : null);
	const mapping = $derived(builder.mapping?.[kind] ?? {});
	const schema = $derived(builder.schemaOf(kind));
	const fctx = $derived(ready && project ? filterContext(kind, project.id, mapping, schema, ready.sequences) : null);
	const sequenceChoices = $derived(ready ? sequenceOptions(ready.sequences).sequences : []);
	const typeChoices = $derived(typeOptions(mapping.type ? schema[mapping.type] : undefined));

	/* the filter ----------------------------------------------------------- */

	let search = $state('');
	let query = $state('');
	$effect(() => {
		const next = search;
		const timer = setTimeout(() => (query = next), 250);
		return () => clearTimeout(timer);
	});
	let sequences = $state<number[]>([]);
	let types = $state<string[]>([]);
	const filter = $derived({ ...EMPTY_FILTER, search: query, sequences, types });
	const filtered = $derived(isFiltered(filter));
	const result = $derived(fctx ? pickFilters(filter, fctx) : null);
	const filters = $derived(result?.kind === 'filters' ? result.filters : null);

	function clearFilter(): void {
		search = query = '';
		sequences = [];
		types = [];
	}

	/* the rows ------------------------------------------------------------- */

	let source = $state.raw<EntitySource | null>(null);
	let snap = $state.raw<EntitySourceState | null>(null);
	/** Every row read while the dialog is open, so a tick hidden by the filter still has its row. */
	const seen = new Map<number, EntityRow>();
	let applied = '';

	$effect(() => {
		if (!ready) return;
		const initial = untrack(() => filters);
		const s = createEntitySource({
			client: context.client,
			entityType: untrack(() => type),
			fields: untrack(() => builder.fieldsFor(kind)),
			filters: initial,
			sort: [{ path: 'code', descending: false }],
			pageSize: 100,
			mode: 'infinite'
		});
		applied = JSON.stringify(initial);
		source = s;
		snap = s.snapshot();
		const off = s.subscribe(() => {
			const now = s.snapshot();
			for (const row of now.rows) seen.set(row.id, row);
			snap = now;
		});
		void s.load();
		return off;
	});

	$effect(() => {
		const next = filters;
		const s = untrack(() => source);
		if (!s || !next || JSON.stringify(next) === applied) return;
		applied = JSON.stringify(next);
		void s.setFilters(next);
	});

	let statuses = $state.raw<ReadonlyMap<string, StatusRecord>>(new Map());
	$effect(() => {
		let live = true;
		context.statuses.byCode().then(
			(found) => live && (statuses = found),
			() => {}
		);
		return () => {
			live = false;
		};
	});
	const statusField = $derived(schema.sg_status_list ?? null);

	const lines = $derived(ready ? (snap?.rows ?? []).map((row) => listRow(row, kind, mapping, ready.sequences)) : []);
	const order = $derived(lines.map((line) => line.id));
	const blocked = $derived(inRequest(builder.itemsOf(kind)));

	/* the ticks ------------------------------------------------------------ */

	let ticks = $state.raw<Ticks>({ selected: new Set(), anchor: null });
	const all = $derived(shownState(ticks.selected, order, blocked));
	const count = $derived(ticks.selected.size);

	function press(id: number, shift: boolean): void {
		ticks = toggle(ticks, id, { order, blocked, shift });
	}

	function pressBox(event: MouseEvent, id: number): void {
		// The row's own handler ticks it; the box only stops its own toggle and the second press.
		event.preventDefault();
		event.stopPropagation();
		press(id, event.shiftKey);
	}

	function pressAll(event: MouseEvent): void {
		event.preventDefault();
		ticks = { selected: toggleShown(ticks.selected, order, blocked), anchor: ticks.anchor };
	}

	function add(): void {
		const rows = [...seen.values()].filter((row) => ticks.selected.has(row.id) && !blocked.has(row.id));
		if (rows.length > 0) builder.addRows(kind, rows);
		onclose(rows.length > 0);
	}

	/* paging --------------------------------------------------------------- */

	let scroller = $state<HTMLElement | null>(null);

	/** The line under the list: reads the next page once it scrolls near. */
	function more(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(entries) => {
				const s = source;
				if (entries.some((e) => e.isIntersecting) && s && s.hasMore && s.status === 'ready') void s.loadMore();
			},
			{ root: scroller, rootMargin: '400px 0px' }
		);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	const loading = $derived(!ready || !snap || ((snap.status === 'loading' || snap.status === 'idle') && snap.rows.length === 0));
</script>

<Dialog.Root open={true} onOpenChange={(open) => !open && onclose(false)}>
	<Dialog.Content
		class="flex h-[min(88dvh,60rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(55rem,calc(100vw-4rem))]"
		data-slot="fpt-add-dialog"
		onOpenAutoFocus={(e) => {
			e.preventDefault();
			document.querySelector<HTMLInputElement>('[data-slot=fpt-add-search]')?.focus();
		}}
	>
		<Dialog.Header class="border-border gap-1 border-b px-5 pt-5 pb-4">
			<Dialog.Title>Add {noun} to {builder.bidName(builder.current)}</Dialog.Title>
			<Dialog.Description>Tick the {noun} to add from Flow PT. They go to {builder.bidName(builder.current)}. You edit them in the table.</Dialog.Description>
		</Dialog.Header>

		<div class="border-border flex flex-wrap items-center gap-2 border-b px-5 py-3" data-slot="fpt-add-filters">
			<div class="relative min-w-48 flex-1">
				<Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
				<Input class="h-8 pl-8" type="search" placeholder={`Search ${noun} by code`} bind:value={search} aria-label={`Search ${noun} by code`} data-slot="fpt-add-search" />
			</div>
			{#if fctx?.sequenceField && sequenceChoices.length > 0}
				<ListMultiPicker
					class="w-48"
					size="sm"
					options={sequenceChoices}
					value={sequences.map(String)}
					searchable
					placeholder="Any sequence"
					searchPlaceholder="Search sequences…"
					onValueChange={(v) => (sequences = v.map(Number))}
				/>
			{/if}
			{#if kind === 'asset' && fctx?.typeField && typeChoices.length > 0}
				<ListMultiPicker class="w-44" size="sm" options={typeChoices} value={types} placeholder="Any type" onValueChange={(v) => (types = v)} />
			{/if}
		</div>

		{#if builder.data.state === 'error'}
			<PageState state="error" title="Could not read the project" line={builder.data.message} />
		{:else if snap?.status === 'error' && snap.rows.length === 0}
			<PageState state="error" title={`Could not read the ${noun}`} line={snap.error?.message}>
				{#snippet action()}<Button variant="outline" onclick={() => void source?.load()}>Try again</Button>{/snippet}
			</PageState>
		{:else if loading}
			<PageState state="loading" title={`Reading the ${noun}…`} />
		{:else if lines.length === 0}
			{#if filtered}
				<PageState state="empty" title={`No ${noun} match`} line="Change the search or the filter.">
					{#snippet action()}<Button variant="outline" onclick={clearFilter}>Clear</Button>{/snippet}
				</PageState>
			{:else}
				<PageState state="empty" title={`No ${Nouns} in this project`} line={`Add them from a breakdown, or create them in Flow PT first.`} />
			{/if}
		{:else}
			<div class="text-muted-foreground flex items-center gap-3 px-5 py-2 text-xs" data-slot="fpt-add-all">
				<label class="hover:text-foreground flex cursor-pointer items-center gap-3 select-none">
					<Checkbox checked={all === 'all'} indeterminate={all === 'some'} onclick={pressAll} disabled={order.every((id) => blocked.has(id))} data-slot="fpt-add-all-box" />
					Select all shown
				</label>
				<span class="ml-auto tabular-nums">{lines.length} shown{snap?.hasMore ? '. Scroll for more.' : ''}</span>
			</div>
			<div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t" data-slot="fpt-add-list">
				<ul class="divide-border divide-y" aria-label={`${Nouns} in the project`}>
					{#each lines as line (line.id)}
						{@const held = blocked.has(line.id)}
						{@const on = held || ticks.selected.has(line.id)}
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions: the box takes the keyboard -->
						<li
							class={cn('flex items-center gap-3 px-5 py-2 select-none', held ? 'text-muted-foreground' : 'hover:bg-muted/50 cursor-pointer', on && !held && 'bg-primary/5')}
							onclick={(e) => !held && press(line.id, e.shiftKey)}
							data-slot="fpt-add-row"
							data-held={held || undefined}
						>
							<Checkbox checked={on} disabled={held} aria-label={held ? `${line.code}, in the request` : line.code} onclick={(e: MouseEvent) => pressBox(e, line.id)} />
							<Thumbnail src={line.image} size="lg" entityType={type} alt="" class={cn(held && 'opacity-60')} />
							<span class="flex min-w-0 flex-1 flex-col">
								<span class={cn('truncate font-mono text-[13px] font-medium', !held && 'text-foreground')} title={line.code}>{line.code}</span>
								{#if line.aside}<span class="text-muted-foreground truncate text-xs" title={line.aside}>{line.aside}</span>{/if}
							</span>
							{#if held}<span class="text-muted-foreground shrink-0 text-xs" data-slot="fpt-add-held">In the request</span>{/if}
							<span class="flex w-32 shrink-0 justify-end">
								{#if line.status}<StatusBadge code={line.status} status={statuses.get(line.status) ?? null} field={statusField} size="sm" siteUrl={context.siteUrl} />{/if}
							</span>
						</li>
					{/each}
				</ul>
				{#if snap?.status === 'error'}
					<div class="text-muted-foreground flex items-center justify-center gap-2 px-5 py-3 text-xs">
						Could not read more.<Button size="sm" variant="ghost" onclick={() => void source?.loadMore()}>Try again</Button>
					</div>
				{:else if snap?.hasMore || snap?.status === 'loadingMore'}
					<!-- A new line per page, so a line still in view after a page reads the next one too. -->
					{#key lines.length}
						<div use:more class="text-muted-foreground px-5 py-3 text-center text-xs" aria-live="polite">Reading more…</div>
					{/key}
				{/if}
			</div>
		{/if}

		<Dialog.Footer class="border-border mx-0 mb-0 flex items-center gap-3 rounded-b-xl border-t px-5 py-3 sm:justify-between">
			<p class="text-muted-foreground text-sm tabular-nums" aria-live="polite" data-slot="fpt-add-count">
				{count === 0 ? 'None selected.' : `${count} selected.`}
				{#if count > 0}<button type="button" class="hover:text-foreground ml-1 underline decoration-current/30 underline-offset-2" onclick={() => (ticks = { selected: new Set(), anchor: null })}>Clear</button>{/if}
			</p>
			<div class="flex gap-2">
				<Button variant="outline" onclick={() => onclose(false)} data-slot="fpt-add-cancel">Cancel</Button>
				<Button onclick={add} disabled={count === 0} data-slot="fpt-add-submit">{addLabel(kind, count)}</Button>
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
