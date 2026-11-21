<!--
	Match to Flow PT: each breakdown row with no Flow PT row, against the project's Shots and Assets
	with the same code. Exact first, then in another case; never a near code. One match is offered,
	ticked; several, taken or none are said and left. Link the ticked rows, or each one alone. On an
	issued request only the Flow PT row changes: vendors see nothing new. Rules in `$lib/pure/match`.
-->
<script lang="ts">
	import Link2 from '@lucide/svelte/icons/link-2';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Notice from '$lib/app/notice.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { linkPlan, type Match } from '$lib/pure/match';
	import type { ItemKind } from '$lib/pure/field-map';
	import type { Matcher } from './matcher';

	let { builder, open = $bindable(false) }: { builder: Matcher; open?: boolean } = $props();

	let found = $state<Record<ItemKind, Match[]> | null>(null);
	let picked = $state<Set<string>>(new Set());
	let reading = $state(false);
	let linking = $state(false);
	let problem = $state<string | null>(null);
	let done = $state<string | null>(null);

	async function read(): Promise<void> {
		reading = true;
		problem = null;
		try {
			const [shot, asset] = await Promise.all([builder.findMatches('shot'), builder.findMatches('asset')]);
			found = { shot, asset };
			picked = new Set([...shot, ...asset].filter((m) => m.state === 'exact' || m.state === 'case').map((m) => m.id));
		} catch (error) {
			problem = `Flow PT could not be read: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			reading = false;
		}
	}

	$effect(() => {
		if (open) {
			done = null;
			void read();
		}
	});

	const linkable = $derived(found ? [...found.shot, ...found.asset].filter((m) => m.state === 'exact' || m.state === 'case') : []);
	const chosen = $derived(linkable.filter((m) => picked.has(m.id)).length);

	async function link(only?: string): Promise<void> {
		if (!found) return;
		linking = true;
		problem = null;
		try {
			const ids = only ? new Set([only]) : picked;
			let n = 0;
			for (const kind of ['shot', 'asset'] as const) {
				const links = linkPlan(kind, found[kind], ids);
				n += links.length;
				await builder.link(kind, links);
			}
			done = `${n} ${n === 1 ? 'row is' : 'rows are'} linked to Flow PT.${builder.readOnly ? ' Vendors see no change.' : ''}`;
			await read();
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		} finally {
			linking = false;
		}
	}

	function toggle(id: string, on: boolean): void {
		const next = new Set(picked);
		if (on) next.add(id);
		else next.delete(id);
		picked = next;
	}

	function words(m: Match): string {
		switch (m.state) {
			case 'exact':
				return `${m.fpt.type} ${m.fpt.id}`;
			case 'case':
				return `${m.fpt.type} ${m.fpt.id}, written ${m.found}`;
			case 'several':
				return `${m.ids.length} rows in Flow PT carry this code. None is picked.`;
			case 'taken':
				return `Already in the ${builder.readOnly ? 'request' : 'bid'}, as ${m.by}.`;
			case 'none':
				return 'No row with this code.';
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[min(90dvh,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl" data-slot="match-dialog">
		<Dialog.Header class="border-border border-b px-5 pt-5 pb-4">
			<Dialog.Title>Match to Flow PT</Dialog.Title>
			<Dialog.Description>
				Rows from the breakdown against the project's Shots and Assets with the same code. The same code first, then the same code in another case. Never a near code.
				{#if builder.readOnly}Linking changes only which Flow PT row the request points at. Vendors see no change.{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
			{#if done}<Notice tone="info" data-slot="match-done">{done}</Notice>{/if}
			{#if problem}<Notice tone="destructive">{problem}</Notice>{/if}
			{#if reading && !found}
				<p class="text-muted-foreground flex items-center gap-2 text-sm"><LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Reading the project's Shots and Assets…</p>
			{:else if found}
				{#each [['shot', 'Shots'], ['asset', 'Assets']] as [kind, title] (kind)}
					{@const list = found[kind as ItemKind]}
					{#if list.length > 0}
						<section class="flex flex-col gap-1" aria-label={title}>
							<h3 class="text-sm font-semibold">{title} <span class="text-muted-foreground font-normal tabular-nums">{list.length}</span></h3>
							<ul class="divide-border flex flex-col divide-y rounded-lg border" data-slot={`match-${kind}`}>
								{#each list as m (m.id)}
									{@const ok = m.state === 'exact' || m.state === 'case'}
									<li class="flex items-center gap-3 px-3 py-2 text-sm" data-state={m.state}>
										<input
											type="checkbox"
											class="accent-primary size-4"
											checked={ok && picked.has(m.id)}
											disabled={!ok || linking}
											aria-label={`Link ${m.code}`}
											onchange={(e) => toggle(m.id, e.currentTarget.checked)}
										/>
										<span class="w-40 shrink-0 truncate font-mono text-xs font-medium" title={m.code}>{m.code}</span>
										<span class={ok ? 'min-w-0 flex-1' : 'text-muted-foreground min-w-0 flex-1'}>{words(m)}</span>
										{#if ok}
											<Button size="sm" variant="ghost" disabled={linking} onclick={() => void link(m.id)} aria-label={`Link ${m.code} alone`}>Link</Button>
										{/if}
									</li>
								{/each}
							</ul>
						</section>
					{/if}
				{/each}
				{#if found.shot.length + found.asset.length === 0}
					<p class="text-muted-foreground text-sm" data-slot="match-none">Every row from the breakdown has its Flow PT row.</p>
				{/if}
			{/if}
		</div>
		<Dialog.Footer class="border-border mx-0 mb-0 flex items-center gap-3 rounded-b-xl border-t px-5 py-3 sm:justify-between">
			<p class="text-muted-foreground text-xs">{linkable.length} of {found ? found.shot.length + found.asset.length : 0} have one match.</p>
			<div class="flex gap-2">
				<Button variant="outline" onclick={() => (open = false)}>Close</Button>
				<Button disabled={chosen === 0 || linking} onclick={() => void link()} data-slot="match-link">
					<Link2 data-icon="inline-start" />{linking ? 'Linking…' : `Link ${chosen} ${chosen === 1 ? 'row' : 'rows'}`}
				</Button>
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
