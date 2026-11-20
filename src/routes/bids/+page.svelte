<!--
	Bid requests: the person's requests in every project they may read on the site, newest first,
	with the project, status, round, due date, invitations and bids in. The project is a filter, not a
	gate; a new request picks its project once, in the builder. A draft this tab holds but has not
	stored yet is offered on top. The list and its filter are `$lib/pure/request-list`.
-->
<script lang="ts">
	import FileText from '@lucide/svelte/icons/file-text';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import SearchX from '@lucide/svelte/icons/search-x';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import StatusChip from '$lib/app/status-chip.svelte';
	import ListPicker from '$lib/components/list-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { ApiError, listAcross, type RequestsAcross } from '$lib/api';
	import { setCurrentProject } from '$lib/current-project';
	import { cushion } from '$lib/drafts';
	import { liveState } from '$lib/live';
	import { listView } from '$lib/pure/request-list';
	import { connectHref, requestHref } from '$lib/pure/routes';
	import type { BidRequest } from '$lib/pure/model';
	import { cn } from '$lib/utils.js';

	let data = $state<RequestsAcross | null>(null);
	let error = $state<{ message: string; signIn: boolean } | null>(null);
	let local = $state<BidRequest | null>(null);
	let project = $state<string | null>(null);
	let query = $state('');

	function load(): void {
		error = null;
		data = null;
		listAcross().then(
			(answer) => (data = answer),
			(failure) => (error = { message: failure instanceof Error ? failure.message : String(failure), signIn: failure instanceof ApiError && failure.status === 401 })
		);
	}
	load();
	void cushion.read().then((kept) => (local = kept && kept.id.startsWith('local-') ? kept : null));

	const view = $derived(data ? listView(data.requests, data.projects, { project: project === null ? null : Number(project), query }) : null);
	const options = $derived(view ? view.projectOptions.map((p) => ({ code: String(p.id), label: p.name })) : []);
	const counts = $derived(new Map(view?.projectOptions.map((p) => [String(p.id), p.count]) ?? []));

	const dayFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
	const day = (value: string | null) => (value ? dayFormat.format(new Date(`${value}T00:00:00Z`)) : '');
	/** Opening a request makes its project the working one: its pages and a new request start there. */
	const remember = (row: { projectId: number; projectName: string }) => setCurrentProject(liveState().siteUrl, { id: row.projectId, name: row.projectName });
	const context = $derived.by(() => {
		if (!view) return 'Every request you can see on this site, newest first.';
		const projects = view.projectOptions.length;
		return `${view.counts.total} ${view.counts.total === 1 ? 'request' : 'requests'} in ${projects} ${projects === 1 ? 'project' : 'projects'} you can see on this site, newest first.`;
	});
	const clear = () => ((project = null), (query = ''));
	const TH = 'text-muted-foreground border-border h-9 border-b px-3 text-left text-xs font-medium whitespace-nowrap';
	const TD = 'border-border border-b px-3 py-2';
</script>

<svelte:head><title>Bid requests · SG Bids</title></svelte:head>

<PageHeader title="Bid requests" {context}>
	{#snippet actions()}
		<Button href="/bids/new" data-slot="new-request"><Plus data-icon="inline-start" />New request</Button>
	{/snippet}
	{#if view && view.counts.total > 0}
		<div class="flex flex-wrap items-center gap-2" data-slot="requests-toolbar">
			<div class="relative w-full sm:w-72">
				<Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
				<Input class="h-8 pl-8" type="search" placeholder="Find by title, code or project" bind:value={query} aria-label="Find a request" />
			</div>
			<div class="w-full sm:w-64">
				<ListPicker
					options={options}
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
		</div>
	{/if}
</PageHeader>

{#if local}
	<div class="border-border border-b px-6 py-2.5">
		<Notice tone="info" title="A draft is not saved yet.">
			{' '}{local.header.title ?? 'Untitled'}{local.header.project ? `, ${local.header.project}` : ''}. It saves once it has a project and a code.
			{#snippet action()}<Button size="sm" variant="outline" href="/bids/new">Open it</Button>{/snippet}
		</Notice>
	</div>
{/if}

{#if error}
	<PageState state="error" title="Could not read the requests" line={error.message}>
		{#snippet action()}
			{#if error?.signIn}
				<Button href={connectHref('/bids')}>Sign in again</Button>
			{:else}
				<Button variant="outline" onclick={load}>Try again</Button>
			{/if}
		{/snippet}
	</PageState>
{:else if !view}
	<PageState state="loading" title="Reading your requests…" />
{:else if view.counts.total === 0}
	<PageState state="empty" icon={FileText} title="No bid requests yet" line="Start one from a project's Shots and Assets. You pick the project first, then what vendors bid on.">
		{#snippet action()}<Button href="/bids/new"><Plus data-icon="inline-start" />New request</Button>{/snippet}
	</PageState>
{:else if view.rows.length === 0}
	<PageState state="empty" icon={SearchX} title="No request matches" line="Change the search or the project, or clear both.">
		{#snippet action()}<Button variant="outline" onclick={clear}>Clear the filters</Button>{/snippet}
	</PageState>
{:else}
	<div class="min-h-0 flex-1 overflow-auto" data-slot="requests-scroll">
		<table class="w-full min-w-[56rem] border-separate border-spacing-0 text-sm" data-slot="requests">
			<colgroup>
				<col />
				<col class="w-[16%]" />
				<col class="w-28" />
				<col class="w-20" />
				<col class="w-32" />
				<col class="w-24" />
				<col class="w-24" />
			</colgroup>
			<thead class="bg-background sticky top-0 z-10">
				<tr>
					<th class={cn(TH, 'pl-6')}>Request</th>
					<th class={TH}>Project</th>
					<th class={TH}>Status</th>
					<th class={cn(TH, 'text-right')}>Round</th>
					<th class={TH}>Bids due</th>
					<th class={cn(TH, 'text-right')}>Invited</th>
					<th class={cn(TH, 'pr-6 text-right')}>Bids in</th>
				</tr>
			</thead>
			<tbody>
				{#each view.rows as row (row.id)}
					<tr class="group hover:bg-muted/60 relative" data-status={row.status}>
						<td class={cn(TD, 'pl-6')}>
							<a
								class="focus-visible:ring-ring flex min-w-0 items-baseline gap-3 rounded-sm outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-offset-2"
								href={requestHref(row)}
								onclick={() => remember(row)}
							>
								<span class={cn('truncate font-medium', !row.title && 'text-muted-foreground')} title={row.title ?? undefined}>{row.title ?? 'Untitled request'}</span>
								<span class="text-muted-foreground shrink-0 font-mono text-xs">{row.code}</span>
							</a>
						</td>
						<td class={cn(TD, 'text-muted-foreground truncate')} title={row.projectName}>{row.projectName}</td>
						<td class={TD}><StatusChip status={row.status} /></td>
						<td class={cn(TD, 'text-right tabular-nums')}>{row.round}</td>
						<td class={cn(TD, 'whitespace-nowrap tabular-nums', !row.dueDate && 'text-muted-foreground')}>{row.dueDate ? day(row.dueDate) : 'None'}</td>
						<td class={cn(TD, 'text-right tabular-nums', row.invited === 0 && 'text-muted-foreground')}>{row.invited}</td>
						<td class={cn(TD, 'pr-6 text-right tabular-nums', row.submitted === 0 && 'text-muted-foreground')}>
							{#if row.invited > 0}<span class="text-foreground font-medium">{row.submitted}</span>{' '}<span class="text-muted-foreground">of {row.invited}</span>{:else}{row.submitted}{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
