<!--
	The Shots or Assets of the request, in the registry's EntityTable over a list source of the
	request's own rows, grouped by bid: one table, a header per bid with its counts, in the bids'
	order. Dense, full width, the rest of the height. A column a Flow PT field feeds is live and says
	so in its header: on a row picked from Flow PT, an edit there writes the field as the signed in
	person and shows the value read back. Every other column, and every cell of a breakdown row, is in
	this request only. A cell that cannot be edited says why on hover.

	Select rows (a press, Shift for a range) and edit one cell: the value goes to that column in every
	selected row, after a confirm that says what changes where. The bar over the table omits,
	includes, moves the selected rows to another bid, or takes them out. Every edit offers Undo; a
	write Flow PT refused, or one that answered and changed nothing (028), is listed with Retry. Rules
	in `$lib/pure/live-columns`, `$lib/pure/row-edit` and `$lib/pure/edit-words`.

	Add row puts an empty row in this request only last in the bid picked, its first cell open to type
	in, as quick as a spreadsheet: Tab writes the cell and opens the next one, Enter on the last row of
	a bid adds another. Such a row, like a pasted one, takes a code and a Count: how many shots of a
	kind it stands for. A row linked to Flow PT is one, and its Count says why on hover.

	One click on a cell edits it, one on a checkbox flips it. A click with Shift, Ctrl or Cmd, or on a
	row's box or a cell that cannot be edited, selects.

	Each code carries where its row comes from, in the columns' marks: live from Flow PT, or from a
	breakdown and in this request only. A source filter shows when the request holds both
	(`$lib/pure/row-source`). A bid with no row of this kind says so under the table, with a way to
	add some.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import FileText from '@lucide/svelte/icons/file-text';
	import Info from '@lucide/svelte/icons/info';
	import Plus from '@lucide/svelte/icons/plus';
	import Radio from '@lucide/svelte/icons/radio';
	import Search from '@lucide/svelte/icons/search';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { CollectionColumn, EntityRef, EntityRow, FieldSchema } from 'sg-widgets-core';
	import Notice from '$lib/app/notice.svelte';
	import EditToast, { type Toast } from './edit-toast.svelte';
	import EntityTable, { type EntityTableCellContext, type EntityTableGroupContext } from '$lib/components/entity-table.svelte';
	import FieldValue from '$lib/components/field-value.svelte';
	import { createListSource, type BulkEdit, type RowUpdate, type RowWriteResult } from '$lib/components/core-next';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { liveContext } from '$lib/live';
	import { cn } from '$lib/utils.js';
	import type { ItemKind } from '$lib/pure/field-map';
	import { cellTarget, columnByKey, descriptionAdvice, type ColumnKey, type RequestColumn } from '$lib/pure/live-columns';
	import { itemValue, type CellChange, type Change, type Refusal } from '$lib/pure/row-edit';
	import { bulkConfirm, editLine, splitTargets, undoLine } from '$lib/pure/edit-words';
	import { bySource, hasBothSources, rowSource, type RowSource, type SourceFilter } from '$lib/pure/row-source';
	import Segmented from '$lib/app/segmented.svelte';
	import { countOf, framesOf, isCounted, unitsLine } from '$lib/pure/count';
	import type { Id, RequestAsset, RequestShot, Target } from '$lib/pure/model';
	import type { Builder, EditOutcome } from '$lib/app/builder.svelte';

	let {
		builder,
		kind,
		fresh = new Set(),
		onAdd,
		onBreakdown,
		onFields
	}: {
		builder: Builder;
		kind: ItemKind;
		/** Rows just added from Flow PT: marked, and the first scrolled into view. */
		fresh?: ReadonlySet<string>;
		/** Add rows from Flow PT, to the bid named or the one picked. */
		onAdd: (bid?: Id) => void;
		onBreakdown: (bid?: Id) => void;
		onFields: () => void;
	} = $props();

	type Item = RequestShot | RequestAsset;
	const type = $derived(kind === 'shot' ? 'Shot' : 'Asset');
	const noun = $derived(kind === 'shot' ? 'shot' : 'asset');
	const nouns = $derived(kind === 'shot' ? 'Shots' : 'Assets');
	const context = liveContext();

	const allItems = $derived(builder.itemsOf(kind));
	const byItem = $derived(new Map(allItems.map((item) => [item.id, item])));
	const requestColumns = $derived(builder.columns(kind));
	const items = $derived(allItems);

	/* rows ----------------------------------------------------------------- */

	/** A breakdown row has no Flow PT id, so the table keys it with a negative one, the same all session. */
	const breakdownIds = new Map<string, number>();
	function refOf(item: Item): EntityRef {
		if (item.source !== 'breakdown' && item.fpt) return { type: item.fpt.type, id: item.fpt.id };
		let id = breakdownIds.get(item.id);
		if (id === undefined) {
			id = -(breakdownIds.size + 1);
			breakdownIds.set(item.id, id);
		}
		return { type, id };
	}

	/**
	 * A column's path in the table. Never a bare key: `type` and `id` are read off the row itself
	 * (core's `cellValue`), so a Type column keyed `type` would show the entity type.
	 */
	const pathOf = (key: ColumnKey): string => `c_${key}`;
	const keyOf = (path: string): ColumnKey => path.slice(2) as ColumnKey;

	/** The bid path the table groups on, drawn as no column. Its value sorts in the bids' order. */
	const BID = '__bid';
	const bidOrder = $derived(new Map(builder.bids.map((b, i) => [b.key, i])));
	const bidValue = (key: Id | undefined) => `${String(bidOrder.get(key ?? '') ?? 9999).padStart(4, '0')}|${key ?? ''}`;
	const bidOfValue = (value: unknown) => String(value ?? '').split('|').slice(1).join('|');

	function rowOf(item: Item): EntityRow {
		const attributes: Record<string, unknown> = { __item: item.id, [BID]: bidValue(item.package) };
		for (const column of requestColumns) attributes[pathOf(column.key)] = itemValue(item, column.key);
		return { ...refOf(item), attributes, relationships: {} };
	}

	let query = $state('');
	let from = $state<SourceFilter>('all');
	const mixed = $derived(hasBothSources(allItems));
	const sourced = $derived(mixed ? bySource(items, from) : items);
	const words = $derived(query.trim().toLowerCase().split(/\s+/).filter(Boolean));
	const shown = $derived(
		words.length === 0
			? sourced
			: sourced.filter((item) => {
					const text = `${itemValue(item, 'code') ?? ''} ${itemValue(item, kind === 'shot' ? 'sequence' : 'type') ?? ''}`.toLowerCase();
					return words.every((w) => text.includes(w));
				})
	);
	const rows = $derived(shown.map(rowOf));
	const itemOfRef = (ref: EntityRef): Item | undefined => {
		for (const item of allItems) {
			const mine = refOf(item);
			if (mine.type === ref.type && mine.id === ref.id) return item;
		}
		return undefined;
	};

	const source = createListSource({ entityType: untrack(() => type), updateMany: (updates) => write(updates) });
	$effect(() => source.setRows(rows));

	/* columns -------------------------------------------------------------- */

	/** The schema a cell editor reads a list's values from: the field's own, or the request's tiers. */
	function fieldOf(column: RequestColumn): FieldSchema | null {
		if (column.field) return builder.schemaOf(kind)[column.field] ?? null;
		if (column.dataType !== 'list') return null;
		return { name: column.key, displayName: column.label, entityType: '', dataType: 'list', editable: true, mandatory: false, unique: false, validValues: [...(column.validValues ?? [])] };
	}

	// The rows group by bid and each group's header names it: no Bid column (sg-widgets PR #384).
	const columns = $derived<CollectionColumn[]>([
		...requestColumns.map((column) => ({
			path: pathOf(column.key),
			header: column.label,
			dataType: column.dataType,
			editable: true,
			align: (column.dataType === 'number' ? 'right' : 'left') as 'right' | 'left',
			sortable: column.key !== 'omitted',
			field: fieldOf(column),
			width: column.width,
			// A description takes the room a popover has; every other cell edits in place, so Tab moves on.
			editorPlacement: (column.key === 'description' ? 'popover' : 'inline') as 'popover' | 'inline'
		}))
	]);

	function editLock(row: EntityRow, column: CollectionColumn): string | null {
		const item = byItem.get(String(row.attributes.__item));
		const request = requestColumns.find((c) => c.key === keyOf(column.path));
		if (!item || !request) return null;
		const target = cellTarget(request, item, builder.gone.has(item.id));
		return target.kind === 'locked' ? target.reason : null;
	}

	const advice = $derived(builder.mapping ? descriptionAdvice(kind, builder.mapping[kind]) : null);
	const difficulty = $derived(requestColumns.find((c) => c.key === 'difficulty'));

	/* selection ------------------------------------------------------------ */

	let selection = $state<EntityRef[]>([]);
	const selectedItems = $derived(selection.flatMap((ref) => itemOfRef(ref) ?? []));

	/* writes --------------------------------------------------------------- */

	let toast = $state<Toast | null>(null);
	let toastId = 0;
	/** The cells the last edit left unchanged, with why, and the changes to try again. */
	let failed = $state.raw<{ key: ColumnKey; failures: readonly Refusal[]; retry: CellChange[] } | null>(null);
	/** A new value remounts the table, which clears the reasons it shows in cells after a retry. */
	let generation = $state(0);

	function labelOf(key: ColumnKey): string {
		return requestColumns.find((c) => c.key === key)?.label ?? key;
	}

	function announce(outcome: EditOutcome, changes: readonly CellChange[]): void {
		const code = (id: string) => builder.codeOf(kind, id);
		if (outcome.failures.length > 0) {
			const ids = new Set(outcome.failures.filter((f) => f.retry).map((f) => f.itemId));
			failed = { key: outcome.key, failures: outcome.failures, retry: changes.filter((c) => ids.has(c.itemId)) };
		} else failed = null;
		if (outcome.changes.length === 0) return;
		const done: readonly Change[] = outcome.changes;
		toast = {
			id: ++toastId,
			line: editLine(kind, labelOf(outcome.key), done, code),
			undo: async () => {
				const { plan, failures } = await builder.undo(kind, done);
				const left = failures.length > 0 ? ` ${failures.length} could not be put back: ${failures[0].reason}` : '';
				return undoLine(plan, code) + left;
			}
		};
	}

	/** The table's writes: the request decides where each lands, and answers each row as it now reads. */
	async function write(updates: RowUpdate[]): Promise<RowWriteResult[]> {
		const path = Object.keys(updates[0]?.patch ?? {})[0];
		if (!path) return [];
		const key = keyOf(path);
		const changes: CellChange[] = updates.flatMap((u) => {
			const item = itemOfRef(u.ref);
			return item ? [{ itemId: item.id, key, value: u.patch[path] }] : [];
		});
		const outcome = await builder.editCells(kind, key, changes);
		announce(outcome, changes);
		const reasons = new Map(outcome.failures.map((f) => [f.itemId, f.reason]));
		return updates.map((u): RowWriteResult => {
			const item = itemOfRef(u.ref);
			const reason = item ? reasons.get(item.id) : 'This row is no longer in the request.';
			const now = item ? builder.itemsOf(kind).find((i) => i.id === item.id) : undefined;
			if (reason !== undefined || !now) return { ref: u.ref, ok: false, message: reason ?? 'This row is no longer in the request.' };
			return { ref: u.ref, ok: true, row: rowOf(now) };
		});
	}

	async function retry(): Promise<void> {
		const held = failed;
		if (!held) return;
		failed = null;
		const outcome = await builder.editCells(kind, held.key, held.retry);
		announce(outcome, held.retry);
		generation += 1;
	}

	/* the bulk edit confirm ------------------------------------------------ */

	let confirming = $state<{ title: string; lines: string[]; live: boolean; answer: (yes: boolean) => void } | null>(null);

	function confirmBulk(edit: BulkEdit): Promise<boolean> {
		const column = requestColumns.find((c) => c.key === keyOf(edit.path));
		if (!column) return Promise.resolve(false);
		const reached = edit.rows.flatMap((row) => byItem.get(String(row.attributes.__item)) ?? []);
		const split = { ...splitTargets(column, reached, builder.gone), locked: edit.skipped.map((s) => s.reason) };
		const words = bulkConfirm(kind, column.label, split);
		return new Promise((resolve) => {
			confirming = {
				...words,
				live: split.fpt > 0,
				answer: (yes) => {
					confirming = null;
					resolve(yes);
				}
			};
		});
	}

	/* the bar over the selection ------------------------------------------- */

	async function setOmitted(on: boolean): Promise<void> {
		const changes = selectedItems.map((item) => ({ itemId: item.id, key: 'omitted' as const, value: on }));
		announce(await builder.editCells(kind, 'omitted', changes), changes);
	}

	function takeOut(): void {
		const removed = allItems.flatMap((item, index) => (selectedItems.some((s) => s.id === item.id) ? [{ index, item }] : []));
		if (removed.length === 0) return;
		builder.remove(
			kind,
			removed.map((r) => r.item.id)
		);
		selection = [];
		failed = null;
		toast = {
			id: ++toastId,
			line: removed.length === 1 ? `${builder.codeOf(kind, removed[0].item.id) || removed[0].item.id} is out of the request.` : `${removed.length} rows are out of the request.`,
			undo: async () => {
				builder.restore(kind, removed);
				return removed.length === 1 ? 'It is back in its bid.' : 'They are back in their bids.';
			}
		};
	}

	/** The selected rows to another bid, with Undo. */
	function moveTo(bid: Id): void {
		const moved = selectedItems.filter((i) => i.package !== bid).map((i) => ({ target: { kind, id: i.id } as Target, from: i.package }));
		if (moved.length === 0) return;
		builder.moveRows(
			moved.map((m) => m.target),
			bid
		);
		selection = [];
		const name = builder.bidName(bid);
		toast = {
			id: ++toastId,
			line: moved.length === 1 ? `${builder.codeOf(kind, moved[0].target.id)} is in ${name} now.` : `${moved.length} rows are in ${name} now.`,
			undo: async () => {
				for (const m of moved) if (m.from) builder.moveRows([m.target], m.from);
				return moved.length === 1 ? 'It is back in its bid.' : 'They are back in their bids.';
			}
		};
	}

	/* rows typed by hand ---------------------------------------------------- */

	/** One empty row in this request only, last in the bid named (the one picked), its first cell open. */
	function addRow(bid?: Id): void {
		builder.addRow(kind, bid ?? builder.current);
	}

	/** The row's element once the table draws it: a few frames after the change, at most. */
	async function rowElement(ref: EntityRef): Promise<HTMLElement | null> {
		const key = CSS.escape(`${ref.type}:${ref.id}`);
		for (let i = 0; i < 20; i++) {
			await tick();
			const tr = document.querySelector<HTMLElement>(`[data-slot=request-table] tr[data-row-key="${key}"]`);
			if (tr) return tr;
			await new Promise((done) => requestAnimationFrame(() => done(null)));
		}
		return null;
	}

	/**
	 * Open the editor of a cell, as Enter on it does. The registry's table opens one from a key on the
	 * focused cell; the page asks it the same way.
	 */
	function openCell(cell: HTMLElement | null): void {
		if (!cell) return;
		cell.focus({ preventScroll: true });
		cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	}

	// The cursor the page asks for: a row just added, or one the issue list points at. Its first cell
	// a person may type in opens.
	$effect(() => {
		const cursor = builder.cursor;
		if (!cursor || cursor.kind !== kind) return;
		const item = untrack(() => allItems.find((i) => i.id === cursor.id));
		if (!item) return;
		// A filter could hide the row, a new one with no code above all.
		untrack(() => {
			if (!shown.some((i) => i.id === item.id)) {
				query = '';
				from = 'all';
			}
		});
		void (async () => {
			const tr = await rowElement(refOf(item));
			if (builder.cursor?.seq !== cursor.seq) return;
			builder.cursor = null;
			if (!tr) return;
			const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
			tr.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
			openCell(tr.querySelector<HTMLElement>('td[data-editable]'));
		})();
	});

	/** The item a key event's row is for. */
	function itemOfEvent(event: KeyboardEvent): Item | undefined {
		const key = (event.target as HTMLElement | null)?.closest<HTMLElement>('tr[data-row-key]')?.dataset['rowKey'];
		if (!key) return undefined;
		const [refType, refId] = [key.slice(0, key.lastIndexOf(':')), Number(key.slice(key.lastIndexOf(':') + 1))];
		return itemOfRef({ type: refType, id: refId });
	}

	/**
	 * Typing in a row of this request only goes as in a spreadsheet: Tab writes the cell and opens the
	 * next, Enter in the last row of a bid writes it and adds a row under it. Read on the way down,
	 * before the table's editor writes the cell; the table does its part as always.
	 */
	function typing(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.isComposing) return;
		const target = event.target as HTMLElement | null;
		const editor = target?.closest('[data-slot=entity-table-editor]');
		if (!editor || !(event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) return;
		const item = itemOfEvent(event);
		if (!item || item.fpt) return;
		if (event.key === 'Tab') {
			// The table writes the cell and focuses the next one it may edit; that one opens. The editor
			// is gone by then, so the row is the key it was in.
			const rowKey = target?.closest<HTMLElement>('tr[data-row-key]')?.dataset['rowKey'];
			setTimeout(() => {
				const next = document.activeElement as HTMLElement | null;
				if (next?.matches('td[data-editable]') && next.closest<HTMLElement>('tr[data-row-key]')?.dataset['rowKey'] === rowKey) openCell(next);
			}, 0);
			return;
		}
		const inBid = allItems.filter((i) => i.package === item.package);
		if (inBid.at(-1)?.id !== item.id) return;
		const bid = item.package;
		setTimeout(() => addRow(bid), 0);
	}

	/** The bids with no row of this kind, under the table. */

	const goneCount = $derived(allItems.filter((item) => builder.gone.has(item.id)).length);

	function selectGone(): void {
		selection = allItems.filter((item) => builder.gone.has(item.id)).map(refOf);
	}

	// Rows just added from Flow PT: the first one scrolled into view.
	$effect(() => {
		const marked = fresh;
		const first = untrack(() => allItems.find((item) => marked.has(item.id)));
		if (!first) return;
		const ref = refOf(first);
		void tick().then(() => document.querySelector(`tr[data-row-key="${CSS.escape(`${ref.type}:${ref.id}`)}"]`)?.scrollIntoView({ block: 'nearest' }));
	});

	const omitted = $derived(allItems.filter((item) => item.omitted).length);

	const SOURCE_WORDS = $derived<Record<RowSource, { label: string; title: string }>>({
		fpt: { label: 'From Flow PT', title: `From Flow PT. A change in a live column changes the ${type} in Flow PT.` },
		breakdown: { label: 'From a breakdown', title: 'From a breakdown. Its cells are in this request only.' },
		linked: { label: 'From a breakdown, linked to Flow PT', title: `From a breakdown, linked to its ${type} in Flow PT. Its cells are in this request only.` }
	});
</script>

{#snippet liveMark(column: RequestColumn)}
	{#if column.key === 'description' && advice}
		<button type="button" class="text-warning focus-visible:ring-ring/50 -ml-1 mr-1.5 flex shrink-0 items-center rounded-sm outline-none focus-visible:ring-2" title={advice} aria-label={`Suggestion: ${advice}`} onclick={onFields} data-slot="description-advice-mark">
			<TriangleAlert class="size-3.5" aria-hidden="true" />
		</button>
	{/if}
{/snippet}

{#snippet sourceMark(source: RowSource)}
	<span class={cn('flex shrink-0 items-center', source === 'fpt' ? 'text-info' : 'text-muted-foreground/70')} role="img" aria-label={SOURCE_WORDS[source].label} title={SOURCE_WORDS[source].title} data-slot="row-source" data-source={source}>
		{#if source === 'fpt'}<Radio class="size-3.5" aria-hidden="true" />{:else}<FileText class="size-3.5" aria-hidden="true" />{/if}
	</span>
{/snippet}

{#snippet groupHeader({ value, count }: EntityTableGroupContext)}
	{@const key = bidOfValue(value)}
	{@const s = builder.stats.get(key)}
	<span class="truncate font-semibold" data-slot="bid-group">{builder.bidName(key) || 'No bid'}</span>
	<span class="text-muted-foreground text-xs font-normal tabular-nums" data-slot="bid-group-counts">
		{#if s}{unitsLine(kind === 'shot' ? s.shots : s.assets, kind === 'shot' ? s.shotRows : s.assetRows, noun)}{:else}{count} {count === 1 ? noun : `${noun}s`}{/if}{#if kind === 'shot' && s && s.frames > 0}{' '}· {s.frames.toLocaleString()} frames{/if}
	</span>
{/snippet}

{#snippet cell({ row, column, value }: EntityTableCellContext)}
	{@const item = byItem.get(String(row.attributes.__item))}
	{#if column.path === pathOf('code') && item}
		<span class="flex min-w-0 items-center gap-2">
			{@render sourceMark(rowSource(item))}
			{#if value === null || value === ''}
				<span class="text-muted-foreground truncate text-xs italic" data-slot="row-no-code">Type a code</span>
			{:else}
				<span class={cn('truncate font-mono text-xs font-medium', item.omitted && 'text-muted-foreground line-through')} title={String(value ?? '')}>{value}</span>
			{/if}
			{#if builder.gone.has(item.id)}
				<span class="border-destructive/60 text-destructive shrink-0 rounded-full border px-1.5 text-[11px] leading-4" title={`This ${type} is gone from Flow PT, or you cannot read it. It keeps its last values.`} data-slot="row-gone">Not in Flow PT</span>
			{/if}
			{#if fresh.has(item.id)}<span class="bg-info/15 text-foreground shrink-0 rounded-full px-1.5 text-[11px] leading-4" data-slot="row-fresh">Added</span>{/if}
		</span>
	{:else if column.path === pathOf('count') && item}
		<span class={cn('block text-right tabular-nums', isCounted(item) ? 'font-semibold' : 'text-muted-foreground')} data-slot="row-count">{countOf(item).toLocaleString()}</span>
	{:else if column.path === pathOf('frames') && item && isCounted(item) && typeof value === 'number'}
		{@const all = framesOf(item) ?? 0}
		<span class="block truncate text-right tabular-nums" title={`${value.toLocaleString()} frames each, ${all.toLocaleString()} in all.`} data-slot="row-frames">
			{value.toLocaleString()}<span class="text-muted-foreground">&nbsp;·&nbsp;{all.toLocaleString()}</span>
		</span>
	{:else if column.dataType === 'checkbox'}
		<!-- The table flips it on a press or Space on the cell, so the box only shows the value. -->
		<Checkbox aria-label={column.header} checked={value === true} tabindex={-1} onclick={(event: MouseEvent) => event.preventDefault()} />
	{:else if value === null || value === undefined || value === ''}
		<!-- An empty cell stays empty: its hover says it can be filled. -->
	{:else if column.path === pathOf('sequence')}
		<span class="text-muted-foreground block truncate text-xs" title={String(value)}>{value}</span>
	{:else}
		<FieldValue {value} dataType={column.dataType} field={column.field} {context} density="compact" />
	{/if}
{/snippet}

{#if allItems.length === 0}
	<div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center" data-slot="picked-empty">
		<p class="text-base font-semibold tracking-tight">No {noun}s in {builder.bids.length === 1 ? builder.bidName(builder.current) : 'the request'} yet</p>
		<p class="text-muted-foreground max-w-md text-sm text-balance">
			Add them from Flow PT, or from a breakdown when they are not in Flow PT yet. A {noun} from Flow PT shows its live values, and a change to them changes Flow PT.
		</p>
		<div class="flex flex-wrap justify-center gap-2">
			<Button onclick={() => onAdd()} data-slot="empty-add-fpt">Add {noun}s from Flow PT</Button>
			<Button variant="outline" onclick={() => onBreakdown()}>Add from a breakdown</Button>
		</div>
		{#if builder.bids.length > 1}<p class="text-muted-foreground text-xs">They go to {builder.bidName(builder.current)}. Pick another bid above to fill it.</p>{/if}
	</div>
{:else}
	<div class="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2" data-slot="picked-toolbar">
		{#if selection.length > 0}
			<div class="bg-muted flex min-w-0 items-center gap-1 rounded-lg py-1 pr-1 pl-3" role="toolbar" aria-label={`${selection.length} selected`} data-slot="bulk-bar">
				<span class="mr-2 text-sm font-medium tabular-nums" aria-live="polite">{selection.length} selected</span>
				<Button size="sm" variant="ghost" onclick={() => void setOmitted(true)} data-slot="bulk-omit">Omit</Button>
				<Button size="sm" variant="ghost" onclick={() => void setOmitted(false)} data-slot="bulk-include">Include</Button>
				{#if builder.bids.length > 1}
					<DropdownMenu.Root>
						<DropdownMenu.Trigger class="hover:bg-accent focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2" data-slot="bulk-move">
							Move to<ChevronDown class="size-3.5" aria-hidden="true" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="start">
							{#each builder.bids as b (b.key)}
								<DropdownMenu.Item disabled={selectedItems.every((i) => i.package === b.key)} onSelect={() => moveTo(b.key)} data-slot="bulk-move-to" data-bid={b.name}>{b.name}</DropdownMenu.Item>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				{/if}
				<Button size="sm" variant="ghost" class="hover:text-destructive" onclick={takeOut} data-slot="bulk-remove">Remove</Button>
				<span class="bg-border mx-1 h-4 w-px" aria-hidden="true"></span>
				<Button size="sm" variant="ghost" class="text-muted-foreground" onclick={() => (selection = [])} data-slot="bulk-clear">Clear selection</Button>
			</div>
		{:else}
			<div class="relative w-full sm:w-64">
				<Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
				<Input class="h-8 pl-8" type="search" placeholder={`Find a ${noun}`} bind:value={query} aria-label={`Find a ${noun} in the request`} />
			</div>
		{/if}
		{#if mixed}
			<Segmented
				label="Where the rows come from"
				value={from}
				options={[
					{ value: 'all', label: 'All' },
					{ value: 'fpt', label: 'Flow PT' },
					{ value: 'breakdown', label: 'Breakdown' }
				]}
				onChange={(v) => (from = v as SourceFilter)}
			/>
		{/if}
		{#if builder.live.state === 'reading'}<p class="text-muted-foreground text-xs" aria-live="polite">Reading Flow PT…</p>{/if}
		<p class="text-muted-foreground ml-auto flex items-center gap-4 text-xs">
			{#if difficulty && !difficulty.live}
				<button type="button" class="hover:text-foreground underline decoration-current/30 underline-offset-2" onclick={onFields} data-slot="difficulty-note">Map Difficulty to a field</button>
			{/if}
			{#if omitted > 0}<span>{omitted} omitted. They go to no vendor.</span>{/if}
			<Popover.Root>
				<Popover.Trigger class="hover:bg-accent hover:text-foreground focus-visible:ring-ring inline-flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2" aria-label="How this table works" title="How this table works" data-slot="live-legend">
					<Info class="size-4" aria-hidden="true" />
				</Popover.Trigger>
				<Popover.Content class="w-80 text-sm" align="end">
					<ul class="flex flex-col gap-2.5">
						<li><span class="font-medium">Live in Flow PT:</span> {requestColumns.filter((c) => c.live).map((c) => c.label).join(', ') || 'no column'}. On a {noun} picked from Flow PT, a change there changes the {type} in Flow PT.</li>
						<li><span class="font-medium">In this request only:</span> {requestColumns.filter((c) => !c.live).map((c) => c.label).join(', ') || 'no column'}. Flow PT is not changed.</li>
						<li class="text-muted-foreground">The mark by a code says where the row comes from: Flow PT or a breakdown.</li>
						<li class="text-muted-foreground">One click edits a cell. Select rows by their box, then edit a cell to change them all.</li>
					</ul>
				</Popover.Content>
			</Popover.Root>
		</p>
	</div>

	{#if builder.live.state === 'error'}
		<div class="px-6 pb-2"><Notice tone="destructive" title="Could not read the rows from Flow PT.">{' '}{builder.live.message} The values shown are the last ones read.</Notice></div>
	{/if}
	{#if goneCount > 0}
		<div class="px-6 pb-2" data-slot="gone-notice">
			<Notice tone="warning">
				{goneCount === 1 ? `One ${noun} is` : `${goneCount} ${noun}s are`} not in Flow PT anymore, or you cannot read {goneCount === 1 ? 'it' : 'them'}. {goneCount === 1 ? 'It keeps' : 'They keep'} the last values read and go to vendors as they are.
				{#snippet action()}<Button size="sm" variant="outline" onclick={selectGone}>Select {goneCount === 1 ? 'it' : 'them'}</Button>{/snippet}
			</Notice>
		</div>
	{/if}
	{#if failed}
		<div class="px-6 pb-2" data-slot="edit-failed">
			<Notice tone="destructive" title={`${failed.failures.length} not changed.`}>
				{' '}
				{#each failed.failures.slice(0, 3) as f, i (f.itemId)}<span class="font-mono text-xs">{builder.codeOf(kind, f.itemId)}</span>: {f.reason}{i < Math.min(failed.failures.length, 3) - 1 ? ' ' : ''}{/each}
				{#if failed.failures.length > 3}{' '}And {failed.failures.length - 3} more.{/if}
				{#snippet action()}
					<div class="flex gap-1">
						{#if failed && failed.retry.length > 0}<Button size="sm" variant="outline" onclick={() => void retry()} data-slot="edit-retry">Retry {failed.retry.length}</Button>{/if}
						<Button size="sm" variant="ghost" onclick={() => (failed = null)}>Dismiss</Button>
					</div>
				{/snippet}
			</Notice>
		</div>
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="min-h-0 flex-1 px-6 pb-4" data-slot="request-table" onkeydowncapture={typing}>
		{#key generation}
			<EntityTable
				class="h-full"
				{source}
				{columns}
				{context}
				projectId={builder.state.project?.id}
				selectable
				bind:selection
				editable
				editOn="click"
				bulkEdit
				{editLock}
				confirmBulkEdit={confirmBulk}
				paging="scroll"
				maxHeight="100%"
				density="compact"
				emptyLabel={`No ${noun} matches.`}
				groupBy={BID}
				{groupHeader}
				{cell}
			>
				{#snippet headerEnd({ column }: { column: CollectionColumn })}
					{@const request = requestColumns.find((c) => c.key === keyOf(column.path))}
					{#if request}{@render liveMark(request)}{/if}
				{/snippet}
			</EntityTable>
		{/key}
	</div>
{/if}

<Dialog.Root open={confirming !== null} onOpenChange={(open) => !open && confirming?.answer(false)}>
	<Dialog.Content class="sm:max-w-md" data-slot="bulk-confirm">
		{#if confirming}
			<Dialog.Header>
				<Dialog.Title>{confirming.title}</Dialog.Title>
				<Dialog.Description class="flex flex-col gap-1.5">
					{#each confirming.lines as line (line)}<span>{line}</span>{/each}
					{#if confirming.live}<span>Undo is offered after it.</span>{/if}
				</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => confirming?.answer(false)} data-slot="bulk-cancel">Cancel</Button>
				<Button onclick={() => confirming?.answer(true)} data-slot="bulk-apply">{confirming.live ? `Change in Flow PT` : 'Change'}</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<EditToast bind:toast />
