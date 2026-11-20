<!--
	Step 6, Items: the frozen copies, one row each, editable before the request goes out:
	description, difficulty tier, a note to vendors, and omit. Shots or Assets at a time. An edit
	saves when the field is left. The copy no longer follows Flow PT.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import Segmented from '$lib/app/segmented.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import ListPicker from '$lib/components/list-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { cn } from '$lib/utils.js';
	import type { ItemKind } from '$lib/pure/field-map';
	import type { StepKey } from '$lib/pure/steps';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, onPick }: { builder: Builder; onPick: (key: StepKey) => void } = $props();

	let kind = $state<ItemKind>(untrack(() => (builder.state.shots.length === 0 && builder.state.assets.length > 0 ? 'asset' : 'shot')));
	const shots = $derived(builder.state.shots);
	const assets = $derived(builder.state.assets);
	const tiers = $derived(builder.tiers(kind).map((t) => ({ code: t, label: t })));

	function edit(id: string, patch: { description?: string; difficulty?: string; notes?: string; omitted?: boolean }): void {
		if (kind === 'shot') builder.editShot(id, patch);
		else builder.editAsset(id, patch);
	}

	const rows = $derived(
		kind === 'shot'
			? shots.map((s) => ({
					id: s.id,
					name: s.code,
					meta: [s.episode, s.sequence].filter(Boolean).join(' / '),
					frames: s.frames,
					description: s.description ?? '',
					difficulty: s.difficulty ?? null,
					notes: s.notes ?? '',
					omitted: s.omitted
				}))
			: assets.map((a) => ({
					id: a.id,
					name: a.name,
					meta: a.type ?? '',
					frames: undefined,
					description: a.description ?? '',
					difficulty: a.difficulty ?? null,
					notes: a.notes ?? '',
					omitted: a.omitted ?? false
				}))
	);
	const omitted = $derived(rows.filter((r) => r.omitted).length);
</script>

{#if shots.length + assets.length === 0}
	<PageState state="empty" title="Nothing picked yet" line="Pick Shots or Assets first. Their copies show here to edit.">
		{#snippet action()}<Button variant="outline" onclick={() => onPick('shots')}>Pick shots</Button>{/snippet}
	</PageState>
{:else}
	<div class="border-border flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-6 py-3">
		<Segmented
			label="Items"
			value={kind}
			options={[
				{ value: 'shot', label: `Shots ${shots.length}` },
				{ value: 'asset', label: `Assets ${assets.length}` }
			]}
			onChange={(v) => (kind = v as ItemKind)}
		/>
		<p class="text-muted-foreground text-sm">
			These are copies. Edits stay in the request and never reach Flow PT.
			{#if omitted > 0}<span class="text-foreground">{omitted} omitted.</span>{/if}
		</p>
	</div>

	<div class="min-h-0 flex-1 overflow-auto">
		{#if rows.length === 0}
			<PageState state="empty" title={kind === 'shot' ? 'No shots picked' : 'No assets picked'} line="Nothing to edit here.">
				{#snippet action()}<Button variant="outline" onclick={() => onPick(kind === 'shot' ? 'shots' : 'assets')}>{kind === 'shot' ? 'Pick shots' : 'Pick assets'}</Button>{/snippet}
			</PageState>
		{:else}
			<table class="w-full min-w-[60rem] border-separate border-spacing-0 text-sm" data-slot="items-table">
				<thead class="bg-background sticky top-0 z-10">
					<tr class="text-muted-foreground text-left text-xs font-medium">
						<th class="border-border border-b py-2 pr-3 pl-6 font-medium">{kind === 'shot' ? 'Shot' : 'Asset'}</th>
						{#if kind === 'shot'}<th class="border-border w-20 border-b px-3 py-2 text-right font-medium">Frames</th>{/if}
						<th class="border-border border-b px-3 py-2 font-medium">Description</th>
						<th class="border-border w-44 border-b px-3 py-2 font-medium">Difficulty</th>
						<th class="border-border w-64 border-b px-3 py-2 font-medium">Note to vendors</th>
						<th class="border-border w-20 border-b py-2 pr-6 pl-3 font-medium">Omit</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.id)}
						<tr class={cn('align-top', row.omitted && 'bg-muted/50')} data-omitted={row.omitted}>
							<td class="border-border border-b py-2 pr-3 pl-6">
								<div class={cn('flex items-start gap-3', row.omitted && 'opacity-60')}>
									<div class="flex min-w-0 flex-col">
										<span class={cn('font-mono text-xs font-medium', row.omitted && 'line-through')}>{row.name}</span>
										{#if row.meta}<span class="text-muted-foreground truncate text-xs">{row.meta}</span>{/if}
									</div>
								</div>
							</td>
							{#if kind === 'shot'}
								<td class="border-border border-b px-3 py-2 pt-3 text-right tabular-nums">{row.frames ?? ''}</td>
							{/if}
							<td class="border-border border-b px-3 py-2">
								<Textarea
									class="min-h-9 py-1.5 text-sm"
									rows={1}
									value={row.description}
									placeholder="What the vendor bids on"
									aria-label={`Description of ${row.name}`}
									onchange={(e) => edit(row.id, { description: e.currentTarget.value })}
								/>
							</td>
							<td class="border-border border-b px-3 py-2">
								<ListPicker
									size="sm"
									options={tiers}
									value={row.difficulty}
									clearable
									placeholder="No tier"
									aria-label={`Difficulty of ${row.name}`}
									onValueChange={(v) => edit(row.id, { difficulty: v ?? '' })}
								/>
							</td>
							<td class="border-border border-b px-3 py-2">
								<Input
									class="h-8"
									value={row.notes}
									placeholder="Optional"
									aria-label={`Note on ${row.name}`}
									onchange={(e) => edit(row.id, { notes: e.currentTarget.value })}
								/>
							</td>
							<td class="border-border border-b py-2 pt-3 pr-6 pl-3">
								<Switch checked={row.omitted} aria-label={`Omit ${row.name}`} onCheckedChange={(v) => edit(row.id, { omitted: v })} />
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
{/if}
