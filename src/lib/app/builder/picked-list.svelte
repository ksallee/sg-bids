<!--
	The Shots or Assets in the request, each a frozen copy, in a dense table that fills the page and
	scrolls on its own under a sticky head: one line per row, the description cut to that line with
	the whole of it on hover. A click opens a row's description and note to vendors in place, saved
	when the field is left. Difficulty and omit edit in place; the row's controls stay quiet until
	the row is hovered or focused. A search narrows the rows; a difficulty can be set for every row
	shown at once. Edits stay in the request and never reach Flow PT. A native select keeps three
	hundred rows light.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import Search from '@lucide/svelte/icons/search';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import MessageSquarePlus from '@lucide/svelte/icons/message-square-plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { cn } from '$lib/utils.js';
	import type { ItemKind } from '$lib/pure/field-map';
	import type { Builder } from '$lib/app/builder.svelte';

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
		onAdd: () => void;
		onBreakdown: () => void;
		onFields: () => void;
	} = $props();

	$effect(() => {
		const marked = fresh;
		const first = untrack(() => builder.state[kind === 'shot' ? 'shots' : 'assets'].find((row) => marked.has(row.id)));
		if (!first) return;
		void tick().then(() => document.querySelector(`[data-row="${CSS.escape(first.id)}"]`)?.scrollIntoView({ block: 'nearest' }));
	});

	const noun = $derived(kind === 'shot' ? 'shot' : 'asset');
	const tiers = $derived(builder.tiers(kind));
	const difficultyMapped = $derived(Boolean(builder.mapping?.[kind].difficulty));
	let query = $state('');
	/** The row whose description and note are open in place. */
	let editing = $state<string | null>(null);

	function edit(id: string, patch: { description?: string; difficulty?: string; notes?: string; omitted?: boolean }): void {
		if (kind === 'shot') builder.editShot(id, patch);
		else builder.editAsset(id, patch);
	}

	const rows = $derived(
		kind === 'shot'
			? builder.state.shots.map((s) => ({
					id: s.id,
					name: s.code,
					from: s.source === 'breakdown' ? (s.fpt ? 'From the breakdown, linked to Flow PT' : 'From the breakdown') : null,
					meta: [s.episode, s.sequence].filter(Boolean).join(' / '),
					frames: s.frames,
					description: s.description ?? '',
					difficulty: s.difficulty ?? '',
					notes: s.notes ?? '',
					omitted: s.omitted
				}))
			: builder.state.assets.map((a) => ({
					id: a.id,
					name: a.name,
					from: a.source === 'breakdown' ? (a.fpt ? 'From the breakdown, linked to Flow PT' : 'From the breakdown') : null,
					meta: a.type ?? '',
					frames: undefined,
					description: a.description ?? '',
					difficulty: a.difficulty ?? '',
					notes: a.notes ?? '',
					omitted: a.omitted ?? false
				}))
	);
	const words = $derived(query.trim().toLowerCase().split(/\s+/).filter(Boolean));
	const shown = $derived(words.length === 0 ? rows : rows.filter((r) => words.every((w) => `${r.name} ${r.meta}`.toLowerCase().includes(w))));
	const omitted = $derived(rows.filter((r) => r.omitted).length);
	const selectClass =
		'border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2 text-sm outline-none focus-visible:ring-3';
	/** A control that reads as text until its row is hovered or it has focus. */
	const quiet =
		'group-hover:border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:group-hover:bg-input/30 h-7 w-full cursor-pointer appearance-none rounded-md border border-transparent bg-transparent px-1.5 text-sm outline-none focus-visible:ring-3';
	const TH = 'text-muted-foreground border-border bg-background h-9 border-b px-2 text-left text-xs font-medium whitespace-nowrap';
	const TD = 'border-border h-9 border-b px-2 py-0';

	async function open(id: string, field: 'description' | 'note' = 'description'): Promise<void> {
		editing = id;
		await tick();
		document.getElementById(`${field}-${id}`)?.focus({ preventScroll: true });
	}

	function closeOnLeave(event: FocusEvent): void {
		const box = event.currentTarget as HTMLElement;
		if (!box.contains(event.relatedTarget as Node | null)) editing = null;
	}

	function setAll(value: string): void {
		if (value === '') return;
		builder.editMany(kind, shown.map((r) => r.id), { difficulty: value === '-' ? '' : value });
	}
</script>

{#if rows.length === 0}
	<div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center" data-slot="picked-empty">
		<p class="text-base font-semibold tracking-tight">No {noun}s in the request yet</p>
		<p class="text-muted-foreground max-w-md text-sm text-balance">Add them from Flow PT, or from a breakdown when they are not in Flow PT yet. Each one is copied in, so you can edit it here without changing the site.</p>
		<div class="flex flex-wrap justify-center gap-2">
			<Button onclick={onAdd}>Add {noun}s from Flow PT</Button>
			<Button variant="outline" onclick={onBreakdown}>Add from a breakdown</Button>
		</div>
	</div>
{:else}
	<div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-2.5" data-slot="picked-toolbar">
		<div class="relative w-full sm:w-64">
			<Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
			<Input class="h-8 pl-8" type="search" placeholder={`Find a ${noun} in the request`} bind:value={query} aria-label={`Find a ${noun} in the request`} />
		</div>
		<label class="flex items-center gap-2 text-sm">
			<span class="text-muted-foreground whitespace-nowrap">Difficulty for {shown.length === rows.length ? 'all' : `the ${shown.length} shown`}</span>
			<select class={cn(selectClass, 'w-36')} value="" onchange={(e) => (setAll(e.currentTarget.value), (e.currentTarget.value = ''))} data-slot="bulk-difficulty">
				<option value="">Set…</option>
				{#each tiers as tier (tier)}<option value={tier}>{tier}</option>{/each}
				<option value="-">No difficulty</option>
			</select>
		</label>
		{#if !difficultyMapped}
			<p class="text-muted-foreground text-xs" data-slot="difficulty-note">
				Difficulty has no Flow PT field here. What you set stays in the request.
				<button type="button" class="text-foreground underline decoration-current/30 underline-offset-2 hover:decoration-current" onclick={onFields}>Map or create a field</button>
			</p>
		{/if}
		<p class="text-muted-foreground ml-auto text-xs">
			{#if omitted > 0}{omitted} omitted. Omitted {noun}s stay listed and go to no vendor.{:else}Edits stay in the request. Flow PT is not changed.{/if}
		</p>
	</div>

	<div class="border-border min-h-0 flex-1 overflow-auto border-t" data-slot="picked-list">
		<table class="w-full min-w-[52rem] table-fixed border-separate border-spacing-0 text-sm">
			<colgroup>
				<col class="w-[15rem]" />
				<col class="w-[12rem]" />
				{#if kind === 'shot'}<col class="w-20" />{/if}
				<col />
				<col class="w-36" />
				<col class="w-16" />
				<col class="w-24" />
			</colgroup>
			<thead class="sticky top-0 z-10">
				<tr>
					<th class={cn(TH, 'pl-6')}>{kind === 'shot' ? 'Shot' : 'Asset'}</th>
					<th class={TH}>{kind === 'shot' ? 'Sequence' : 'Type'}</th>
					{#if kind === 'shot'}<th class={cn(TH, 'text-right')}>Frames</th>{/if}
					<th class={TH}>Description and note to vendors</th>
					<th class={TH}>Difficulty</th>
					<th class={TH} title={`An omitted ${noun} stays listed and goes to no vendor.`}>Omit</th>
					<th class={cn(TH, 'pr-6')}><span class="sr-only">Note and remove</span></th>
				</tr>
			</thead>
			<tbody>
				{#each shown as row (row.id)}
					<tr
						class={cn('group hover:bg-muted/60 focus-within:bg-muted/60', row.omitted && 'bg-muted/40', fresh.has(row.id) && 'bg-info/10')}
						data-omitted={row.omitted}
						data-row={row.id}
						data-fresh={fresh.has(row.id) || undefined}
					>
						<td class={cn(TD, 'pl-6')}>
							<span class="flex min-w-0 items-center gap-2">
								<span class={cn('truncate font-mono text-xs font-medium', row.omitted && 'text-muted-foreground line-through')} title={row.name}>{row.name}</span>
								{#if row.from}
									<span
										class={cn('shrink-0 rounded-full border px-1.5 text-[11px] leading-4', row.from.includes('linked') ? 'border-border text-muted-foreground' : 'border-warning/60 text-foreground')}
										title={row.from}
										data-slot="row-source">{row.from.includes('linked') ? 'Breakdown, linked' : 'Breakdown'}</span
									>
								{/if}
							</span>
						</td>
						<td class={cn(TD, 'text-muted-foreground truncate text-xs')} title={row.meta}>{row.meta}</td>
						{#if kind === 'shot'}
							<td class={cn(TD, 'text-right tabular-nums', row.frames === undefined && 'text-muted-foreground text-xs')}>{row.frames ?? 'None'}</td>
						{/if}
						<td class={cn(TD, 'relative')}>
							<button
								type="button"
								class="hover:bg-background focus-visible:ring-ring/50 flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left outline-none focus-visible:ring-3"
								title={row.description || undefined}
								aria-label={`Edit the description of ${row.name}`}
								onclick={() => open(row.id)}
								data-slot="edit-description"
							>
								<span class={cn('min-w-0 truncate', !row.description && 'text-muted-foreground')}>{row.description || 'No description'}</span>
								{#if row.notes}
									<MessageSquare class="text-info size-3.5 shrink-0" aria-hidden="true" />
									<span class="sr-only">Has a note to vendors.</span>
								{/if}
							</button>
							{#if editing === row.id}
								<!-- svelte-ignore a11y_no_noninteractive_element_interactions: Escape and leaving close the fields inside; they keep the keyboard -->
								<div
									class="bg-popover text-popover-foreground absolute inset-x-1 top-0.5 z-20 flex flex-col gap-1.5 rounded-lg border p-1.5 shadow-lg"
									onfocusout={closeOnLeave}
									onkeydown={(e) => e.key === 'Escape' && (editing = null)}
									role="group"
									aria-label={`Description and note of ${row.name}`}
									data-slot="row-editor"
								>
									<Textarea
										id={`description-${row.id}`}
										class="min-h-20 resize-y py-1.5 text-sm"
										rows={3}
										value={row.description}
										placeholder="What the vendor bids on"
										aria-label={`Description of ${row.name}`}
										onchange={(e) => edit(row.id, { description: e.currentTarget.value })}
									/>
									<Input
										id={`note-${row.id}`}
										class="h-7 text-xs"
										value={row.notes}
										placeholder="Note to vendors on this one"
										aria-label={`Note to vendors on ${row.name}`}
										onchange={(e) => edit(row.id, { notes: e.currentTarget.value })}
									/>
								</div>
							{/if}
						</td>
						<td class={TD}>
							<select class={quiet} value={row.difficulty} aria-label={`Difficulty of ${row.name}`} onchange={(e) => edit(row.id, { difficulty: e.currentTarget.value })}>
								<option value="">None</option>
								{#each tiers as tier (tier)}<option value={tier}>{tier}</option>{/each}
								{#if row.difficulty && !tiers.includes(row.difficulty)}<option value={row.difficulty}>{row.difficulty}</option>{/if}
							</select>
						</td>
						<td class={TD}>
							<Switch size="sm" checked={row.omitted} aria-label={`Omit ${row.name}`} onCheckedChange={(v) => edit(row.id, { omitted: v })} />
						</td>
						<td class={cn(TD, 'pr-6')}>
							<div class="flex items-center justify-end opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
								<Button
									size="icon-sm"
									variant="ghost"
									class="text-muted-foreground"
									aria-label={`${row.notes ? 'Edit the note' : 'Add a note'} to vendors on ${row.name}`}
									title={row.notes ? 'Edit the note to vendors' : 'Add a note to vendors'}
									onclick={() => open(row.id, 'note')}
								>
									<MessageSquarePlus />
								</Button>
								<Button
									size="icon-sm"
									variant="ghost"
									class="text-muted-foreground hover:text-destructive"
									aria-label={`Take ${row.name} out of the request`}
									title="Take it out of the request"
									onclick={() => builder.remove(kind, [row.id])}
								>
									<X />
								</Button>
							</div>
						</td>
					</tr>
				{:else}
					<tr><td colspan="7" class="text-muted-foreground px-6 py-10 text-center text-sm">No {noun} in the request matches.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
