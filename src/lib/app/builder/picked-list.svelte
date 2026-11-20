<!--
	The Shots or Assets in the request, each a frozen copy, edited in place: the description, the
	difficulty, a note to vendors, omit, or take it out. A search narrows the rows; a difficulty can
	be set for every row shown at once. Edits stay in the request and never reach Flow PT. Text saves
	when the field is left. A native select keeps three hundred rows light.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import Search from '@lucide/svelte/icons/search';
	import MessageSquarePlus from '@lucide/svelte/icons/message-square-plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { cn } from '$lib/utils.js';
	import type { ItemKind } from '$lib/pure/field-map';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, kind, onAdd, onFields }: { builder: Builder; kind: ItemKind; onAdd: () => void; onFields: () => void } = $props();

	const noun = $derived(kind === 'shot' ? 'shot' : 'asset');
	const tiers = $derived(builder.tiers(kind));
	const difficultyMapped = $derived(Boolean(builder.mapping?.[kind].difficulty));
	let query = $state('');
	let noting = $state<Record<string, boolean>>({});

	function edit(id: string, patch: { description?: string; difficulty?: string; notes?: string; omitted?: boolean }): void {
		if (kind === 'shot') builder.editShot(id, patch);
		else builder.editAsset(id, patch);
	}

	const rows = $derived(
		kind === 'shot'
			? builder.state.shots.map((s) => ({
					id: s.id,
					name: s.code,
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

	async function openNote(id: string): Promise<void> {
		noting = { ...noting, [id]: true };
		await tick();
		document.getElementById(`note-${id}`)?.focus();
	}

	function setAll(value: string): void {
		if (value === '') return;
		builder.editMany(kind, shown.map((r) => r.id), { difficulty: value === '-' ? '' : value });
	}
</script>

{#if rows.length === 0}
	<div class="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center" data-slot="picked-empty">
		<p class="text-sm font-medium">No {noun}s in the request yet</p>
		<p class="text-muted-foreground max-w-sm text-sm">Add them from Flow PT. Each one is copied in, so you can edit it here without changing the site.</p>
		<Button size="sm" onclick={onAdd}>Add {noun}s from Flow PT</Button>
	</div>
{:else}
	<div class="flex flex-wrap items-center gap-2" data-slot="picked-toolbar">
		<div class="relative w-full sm:w-56">
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
		<p class="text-muted-foreground ml-auto text-xs">
			{#if omitted > 0}{omitted} omitted. Omitted {noun}s stay listed and go to no vendor.{:else}Edits stay in the request. Flow PT is not changed.{/if}
		</p>
	</div>
	{#if !difficultyMapped}
		<p class="text-muted-foreground text-xs" data-slot="difficulty-note">
			Difficulty has no Flow PT field here. What you set stays in the request.
			<button type="button" class="text-foreground underline decoration-current/30 underline-offset-2 hover:decoration-current" onclick={onFields}>Map or create a field</button>
		</p>
	{/if}

	<div class="overflow-x-auto rounded-lg border" data-slot="picked-list">
		<table class="w-full min-w-[44rem] border-separate border-spacing-0 text-sm">
			<thead class="bg-muted sticky top-0 z-10">
				<tr class="text-muted-foreground text-left text-xs">
					<th class="border-border w-48 border-b py-2 pr-3 pl-3 font-medium">{kind === 'shot' ? 'Shot' : 'Asset'}</th>
					{#if kind === 'shot'}<th class="border-border w-16 border-b px-2 py-2 text-right font-medium">Frames</th>{/if}
					<th class="border-border border-b px-2 py-2 font-medium">Description and note to vendors</th>
					<th class="border-border w-36 border-b px-2 py-2 font-medium">Difficulty</th>
					<th class="border-border w-14 border-b px-2 py-2 font-medium" title={`An omitted ${noun} stays listed and goes to no vendor.`}>Omit</th>
					<th class="border-border w-20 border-b py-2 pr-2 font-medium"><span class="sr-only">Note and remove</span></th>
				</tr>
			</thead>
			<tbody>
				{#each shown as row (row.id)}
					<tr class={cn('group align-top', row.omitted && 'bg-muted/60')} data-omitted={row.omitted} data-row={row.id}>
						<td class="border-border border-b py-2 pr-3 pl-3">
							<div class={cn('flex min-w-0 flex-col pt-1.5', row.omitted && 'opacity-60')}>
								<span class={cn('truncate font-mono text-xs font-medium', row.omitted && 'line-through')} title={row.name}>{row.name}</span>
								{#if row.meta}<span class="text-muted-foreground truncate text-xs">{row.meta}</span>{/if}
							</div>
						</td>
						{#if kind === 'shot'}
							<td class={cn('border-border border-b px-2 py-2 pt-3.5 text-right text-xs tabular-nums', row.frames === undefined && 'text-muted-foreground')}>{row.frames ?? 'none'}</td>
						{/if}
						<td class="border-border border-b px-2 py-2">
							<div class="flex flex-col gap-1.5">
								<Textarea
									class="max-h-[3.75rem] min-h-8 resize-none py-1.5 text-sm focus-visible:max-h-60"
									rows={1}
									value={row.description}
									placeholder="What the vendor bids on"
									aria-label={`Description of ${row.name}`}
									onchange={(e) => edit(row.id, { description: e.currentTarget.value })}
								/>
								{#if row.notes || noting[row.id]}
									<Input
										id={`note-${row.id}`}
										class="h-7 text-xs"
										value={row.notes}
										placeholder="Note to vendors"
										aria-label={`Note to vendors on ${row.name}`}
										onchange={(e) => edit(row.id, { notes: e.currentTarget.value })}
									/>
								{/if}
							</div>
						</td>
						<td class="border-border border-b px-2 py-2">
							<select class={selectClass} value={row.difficulty} aria-label={`Difficulty of ${row.name}`} onchange={(e) => edit(row.id, { difficulty: e.currentTarget.value })}>
								<option value="">None</option>
								{#each tiers as tier (tier)}<option value={tier}>{tier}</option>{/each}
								{#if row.difficulty && !tiers.includes(row.difficulty)}<option value={row.difficulty}>{row.difficulty}</option>{/if}
							</select>
						</td>
						<td class="border-border border-b px-2 py-2 pt-3">
							<Switch checked={row.omitted} aria-label={`Omit ${row.name}`} onCheckedChange={(v) => edit(row.id, { omitted: v })} />
						</td>
						<td class="border-border border-b py-2 pr-2">
							<div class="mt-0.5 flex items-center">
								<Button
									size="icon-sm"
									variant="ghost"
									class={cn('text-muted-foreground', (row.notes || noting[row.id]) && 'invisible')}
									aria-label={`Add a note to vendors on ${row.name}`}
									title="Add a note to vendors"
									onclick={() => openNote(row.id)}
								>
									<MessageSquarePlus />
								</Button>
								<Button size="icon-sm" variant="ghost" class="text-muted-foreground" aria-label={`Take ${row.name} out of the request`} title="Take it out of the request" onclick={() => builder.remove(kind, [row.id])}>
									<X />
								</Button>
							</div>
						</td>
					</tr>
				{:else}
					<tr><td colspan="6" class="text-muted-foreground px-3 py-6 text-center text-sm">No {noun} in the request matches.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
