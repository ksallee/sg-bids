<!--
	Bids: the person's bids in every project they may read on the site, newest change first, each
	with its project, what it holds and the requests it went out in. The project is a filter, not a
	gate. Tick one or several bids of a project, then New request from them; New bid opens the
	editor. Each row's menu opens, clones or deletes it. A bid this tab holds but has not stored yet
	is offered on top. The list, its filter and the selection are `$lib/pure/bid-list`.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Layers from '@lucide/svelte/icons/layers';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import SearchX from '@lucide/svelte/icons/search-x';
	import Send from '@lucide/svelte/icons/send';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import StatusChip from '$lib/app/status-chip.svelte';
	import DeleteBid from '$lib/app/bid/delete-bid.svelte';
	import EditToast, { type Toast } from '$lib/app/builder/edit-toast.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import ListPicker from '$lib/components/list-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { ApiError, bidsApi, listBidsAcross, type BidDeleted, type BidsAcross } from '$lib/api';
	import { setCurrentProject } from '$lib/current-project';
	import { cushion, type KeptBid } from '$lib/drafts';
	import { liveState } from '$lib/live';
	import { bidHref, bidListView, newRequestHref, selectionRequest } from '$lib/pure/bid-list';
	import { wentOutIn } from '$lib/pure/request-bids';
	import { connectHref, requestHref } from '$lib/pure/routes';
	import { cn } from '$lib/utils.js';

	let data = $state<BidsAcross | null>(null);
	let error = $state<{ message: string; signIn: boolean } | null>(null);
	let local = $state<KeptBid | null>(null);
	let project = $state<string | null>(null);
	let query = $state('');
	let ticked = $state<ReadonlySet<string>>(new Set());
	let toast = $state<Toast | null>(null);
	let toastId = 0;

	function load(): void {
		error = null;
		data = null;
		listBidsAcross().then(
			(answer) => {
				data = answer;
				const known = new Set(answer.bids.map((b) => b.id));
				ticked = new Set([...ticked].filter((id) => known.has(id)));
			},
			(failure) => (error = { message: failure instanceof Error ? failure.message : String(failure), signIn: failure instanceof ApiError && failure.status === 401 })
		);
	}
	load();
	void cushion.read().then((kept) => (local = kept && kept.id.startsWith('local-') ? kept : null));

	const view = $derived(data ? bidListView(data.bids, data.projects, { project: project === null ? null : Number(project), query }) : null);
	const options = $derived(view ? view.projectOptions.map((p) => ({ code: String(p.id), label: p.name })) : []);
	const counts = $derived(new Map(view?.projectOptions.map((p) => [String(p.id), p.count]) ?? []));
	const selection = $derived(data ? selectionRequest(data.bids, ticked) : null);
	const shownIds = $derived(view ? view.rows.map((r) => r.id) : []);
	const allTicked = $derived(shownIds.length > 0 && shownIds.every((id) => ticked.has(id)));
	const someTicked = $derived(shownIds.some((id) => ticked.has(id)));

	const remember = (row: { projectId: number; projectName: string }) => setCurrentProject(liveState().siteUrl, { id: row.projectId, name: row.projectName });
	const context = $derived.by(() => {
		if (!view || view.counts.total === 0) return 'Every bid you can see on this site, newest change first.';
		const projects = view.projectOptions.length;
		return `${view.counts.total} ${view.counts.total === 1 ? 'bid' : 'bids'} in ${projects} ${projects === 1 ? 'project' : 'projects'} you can see on this site, newest change first.`;
	});
	const clear = () => ((project = null), (query = ''));

	function tick(id: string, on: boolean): void {
		const next = new Set(ticked);
		if (on) next.add(id);
		else next.delete(id);
		ticked = next;
	}

	function tickAll(on: boolean): void {
		const next = new Set(ticked);
		for (const id of shownIds) {
			if (on) next.add(id);
			else next.delete(id);
		}
		ticked = next;
	}

	function newRequest(): void {
		if (!selection?.ok || !data) return;
		const name = data.projects.find((p) => p.id === selection.projectId)?.name ?? `Project ${selection.projectId}`;
		setCurrentProject(liveState().siteUrl, { id: selection.projectId, name });
		void goto(newRequestHref(selection));
	}

	// Cloning: the copy goes to the top of the list, and the line offers to open it.
	let cloning = $state<string | null>(null);
	async function clone(row: { id: string; projectId: number; projectName: string }): Promise<void> {
		cloning = row.id;
		try {
			const copy = await bidsApi.clone(row.projectId, row.id);
			load();
			toast = { id: ++toastId, line: `${copy.bid.name} is made, with every row.` };
		} catch (failure) {
			toast = { id: ++toastId, line: `Not cloned. ${failure instanceof Error ? failure.message : String(failure)}` };
		} finally {
			cloning = null;
		}
	}

	// Deleting: the row whose menu asked, then the list again with a line saying what happened.
	let deleting = $state<{ id: string; projectId: number } | null>(null);
	let deleteOpen = $state(false);
	function ask(row: { id: string; projectId: number }): void {
		deleting = { id: row.id, projectId: row.projectId };
		deleteOpen = true;
	}
	function deleted(gone: BidDeleted): void {
		if (data) data = { ...data, bids: data.bids.filter((b) => b.id !== deleting?.id) };
		tick(deleting?.id ?? '', false);
		const left = gone.drafts.length > 0 ? ` It left ${gone.drafts.map((d) => d.code).join(', ')}.` : '';
		toast = { id: ++toastId, line: `${gone.name} is deleted.${left}` };
	}

	// The bid this tab holds but has not stored: discarded after one confirm.
	let discardOpen = $state(false);
	async function discardLocal(): Promise<void> {
		await cushion.clear();
		local = null;
		discardOpen = false;
	}

	const dayFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	const number = new Intl.NumberFormat();
	const TH = 'text-muted-foreground border-border h-9 border-b px-3 text-left text-xs font-medium whitespace-nowrap';
	const TD = 'border-border border-b px-3 py-2';
</script>

<svelte:head><title>Bids · SG Bids</title></svelte:head>

<PageHeader title="Bids" {context}>
	{#snippet actions()}
		{#if selection?.ok}
			<Button variant="outline" href="/bids/new" data-slot="new-bid"><Plus data-icon="inline-start" />New bid</Button>
			<Button onclick={newRequest} data-slot="new-request-from-bids"><Send data-icon="inline-start" />New request from {selection.bids.length} {selection.bids.length === 1 ? 'bid' : 'bids'}</Button>
		{:else}
			<Button href="/bids/new" data-slot="new-bid"><Plus data-icon="inline-start" />New bid</Button>
		{/if}
	{/snippet}
	{#if view && view.counts.total > 0}
		<div class="flex flex-wrap items-center gap-2" data-slot="bids-toolbar">
			<div class="relative w-full sm:w-72">
				<Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
				<Input class="h-8 pl-8" type="search" placeholder="Find by name, project or request" bind:value={query} aria-label="Find a bid" />
			</div>
			<div class="w-full sm:w-64">
				<ListPicker
					{options}
					value={view.project === null ? null : String(view.project)}
					searchable={options.length > 8}
					clearable
					clearLabel="Every project"
					placeholder="Every project"
					triggerLabel="Project"
					secondary={(o) => String(counts.get(o.code) ?? '')}
					onValueChange={(v) => (project = v)}
				/>
			</div>
			{#if view.filtered}
				<Button size="sm" variant="ghost" onclick={clear}>Clear</Button>
				<span class="text-muted-foreground text-xs tabular-nums">{view.counts.shown} of {view.counts.total}</span>
			{/if}
			<div class="ml-auto flex min-w-0 items-center gap-2 text-sm" aria-live="polite" data-slot="bids-selection">
				{#if ticked.size > 0}
					<span class="font-medium tabular-nums">{ticked.size} ticked</span>
					{#if selection && !selection.ok}<span class="text-destructive text-xs">{selection.reason}</span>{/if}
					<Button size="sm" variant="ghost" class="text-muted-foreground" onclick={() => (ticked = new Set())}>Clear ticks</Button>
				{:else}
					<span class="text-muted-foreground text-xs">Tick bids of one project to send them in a request.</span>
				{/if}
			</div>
		</div>
	{/if}
</PageHeader>

{#if local}
	<div class="border-border border-b px-6 py-2.5">
		<Notice tone="info" title="A bid is not saved yet.">
			{' '}{local.name || 'Untitled bid'}{local.project ? `, ${local.project.name}` : ''}. It saves once it has a project and a name or a row.
			{#snippet action()}
				<Button size="sm" variant="ghost" class="hover:text-destructive" onclick={() => (discardOpen = true)} data-slot="discard-local">Discard</Button>
				<Button size="sm" variant="outline" href="/bids/new">Open it</Button>
			{/snippet}
		</Notice>
	</div>
	<Dialog.Root bind:open={discardOpen}>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Discard the unsaved bid?</Dialog.Title>
				<Dialog.Description>{local.name || 'Untitled bid'}. It lives in this tab only. This cannot be undone.</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (discardOpen = false)}>Keep it</Button>
				<Button variant="destructive" onclick={() => void discardLocal()}>Discard bid</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}

{#if error}
	<PageState state="error" title="Could not read the bids" line={error.message}>
		{#snippet action()}
			{#if error?.signIn}
				<Button href={connectHref('/bids')}>Sign in again</Button>
			{:else}
				<Button variant="outline" onclick={load}>Try again</Button>
			{/if}
		{/snippet}
	</PageState>
{:else if !view}
	<PageState state="loading" title="Reading your bids…" />
{:else if view.counts.total === 0}
	<PageState state="empty" icon={Layers} title="No bids yet" line="A bid is a set of Shots, Assets or breakdown rows in a project. Build one, then send it to vendors in a request.">
		{#snippet action()}<Button href="/bids/new"><Plus data-icon="inline-start" />New bid</Button>{/snippet}
	</PageState>
{:else if view.rows.length === 0}
	<PageState state="empty" icon={SearchX} title="No bid matches" line="Change the search or the project, or clear both.">
		{#snippet action()}<Button variant="outline" onclick={clear}>Clear the filters</Button>{/snippet}
	</PageState>
{:else}
	<div class="min-h-0 flex-1 overflow-auto" data-slot="bids-scroll">
		<table class="w-full min-w-[60rem] border-separate border-spacing-0 text-sm" data-slot="bids">
			<colgroup>
				<col class="w-12" />
				<col />
				<col class="w-[14%]" />
				<col class="w-20" />
				<col class="w-24" />
				<col class="w-20" />
				<col class="w-[24%]" />
				<col class="w-32" />
				<col class="w-14" />
			</colgroup>
			<thead class="bg-background sticky top-0 z-10">
				<tr>
					<th class={cn(TH, 'pl-6')}>
						<Checkbox checked={allTicked} indeterminate={someTicked && !allTicked} onCheckedChange={(v) => tickAll(v === true)} aria-label="Tick every bid shown" />
					</th>
					<th class={TH}>Bid</th>
					<th class={TH}>Project</th>
					<th class={cn(TH, 'text-right')}>Shots</th>
					<th class={cn(TH, 'text-right')}>Frames</th>
					<th class={cn(TH, 'text-right')}>Assets</th>
					<th class={TH}>Went out in</th>
					<th class={TH}>Changed</th>
					<th class={cn(TH, 'pr-6')}><span class="sr-only">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each view.rows as row (row.id)}
					{@const on = ticked.has(row.id)}
					{@const requests = wentOutIn(row.requests)}
					<tr class={cn('group hover:bg-muted/60 relative', on && 'bg-primary/5')} data-bid={row.id}>
						<td class={cn(TD, 'relative z-10 pl-6')}>
							<Checkbox checked={on} onCheckedChange={(v) => tick(row.id, v === true)} aria-label={`Tick ${row.name}`} data-slot="bid-tick" />
						</td>
						<td class={TD}>
							<a
								class="focus-visible:ring-ring flex min-w-0 items-baseline gap-3 rounded-sm outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-offset-2"
								href={bidHref(row)}
								onclick={() => remember(row)}
							>
								<span class="truncate font-medium" title={row.name}>{row.name}</span>
								{#if row.omitted > 0}<span class="text-muted-foreground shrink-0 text-xs">{row.omitted} omitted</span>{/if}
							</a>
						</td>
						<td class={cn(TD, 'text-muted-foreground truncate')} title={row.projectName}>{row.projectName}</td>
						<td class={cn(TD, 'text-right tabular-nums', row.shots === 0 && 'text-muted-foreground')}>{number.format(row.shots)}</td>
						<td class={cn(TD, 'text-right tabular-nums', row.frames === 0 && 'text-muted-foreground')}>{number.format(row.frames)}</td>
						<td class={cn(TD, 'text-right tabular-nums', row.assets === 0 && 'text-muted-foreground')}>{number.format(row.assets)}</td>
						<td class={cn(TD, 'relative z-10')}>
							{#if requests.length === 0}
								<span class="text-muted-foreground">None yet</span>
							{:else}
								<span class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
									{#each requests.slice(0, 3) as r (r.id)}
										<a class="hover:text-foreground inline-flex items-center gap-1.5 underline-offset-2 hover:underline" href={requestHref({ ...r, projectId: row.projectId })} onclick={() => remember(row)} title={r.title ?? r.label}>
											<span class="font-mono text-xs">{r.label}</span>
											<StatusChip status={r.status} />
										</a>
									{/each}
									{#if requests.length > 3}<span class="text-muted-foreground text-xs">and {requests.length - 3} more</span>{/if}
								</span>
							{/if}
						</td>
						<td class={cn(TD, 'text-muted-foreground whitespace-nowrap tabular-nums')}>{dayFormat.format(new Date(row.updatedAt))}</td>
						<td class={cn(TD, 'py-1 pr-6 text-right')}>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger
									class="hover:bg-accent focus-visible:ring-ring text-muted-foreground hover:text-foreground relative z-10 inline-flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2"
									aria-label={`More for ${row.name}`}
									data-slot="row-actions"
								>
									<Ellipsis class="size-4" />
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end">
									<DropdownMenu.Item onSelect={() => (remember(row), goto(bidHref(row)))}>Open</DropdownMenu.Item>
									<DropdownMenu.Item onSelect={() => void clone(row)} disabled={cloning === row.id} data-slot="row-clone">Clone</DropdownMenu.Item>
									<DropdownMenu.Separator />
									<DropdownMenu.Item class="text-destructive" onSelect={() => ask(row)} data-slot="row-delete">Delete bid…</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if deleting}
	<DeleteBid bind:open={deleteOpen} projectId={deleting.projectId} bidId={deleting.id} ondeleted={deleted} />
{/if}

<EditToast bind:toast />
