<!--
	Requests: the person's requests in every project they may read on the site, newest first, with
	their bids, shots and assets, the project, status, round, due date, the vendors invited and the
	answers in. The project is a filter, not a gate. New request asks for a name and a project, then
	opens the request's one page. Each row's menu opens, duplicates or deletes it. A box per row, and
	one in the header for every row shown, select several: a bar then deletes or duplicates them, and
	a line says what went. The list and its filter are `$lib/pure/request-list`, the selection
	`$lib/pure/request-select`.
-->
<script lang="ts">
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import FileText from '@lucide/svelte/icons/file-text';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import SearchX from '@lucide/svelte/icons/search-x';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import StatusChip from '$lib/app/status-chip.svelte';
	import BulkDelete from '$lib/app/request/bulk-delete.svelte';
	import BulkDuplicate from '$lib/app/request/bulk-duplicate.svelte';
	import DeleteRequest from '$lib/app/request/delete-request.svelte';
	import DuplicateRequest from '$lib/app/request/duplicate-request.svelte';
	import NewRequest from '$lib/app/request/new-request.svelte';
	import SetupNotice from '$lib/app/setup-notice.svelte';
	import { deletedNote } from '$lib/app/request/deleted-note.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import ListPicker from '$lib/components/list-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { ApiError, listAcross, type RequestsAcross } from '$lib/api';
	import { setCurrentProject } from '$lib/current-project';
	import { liveState } from '$lib/live';
	import { bidsCell, listView } from '$lib/pure/request-list';
	import { deletedLine, requestName, type Deleted } from '$lib/pure/request-delete';
	import { headerState, NOTHING, picked, press, pressAll, prune, resultLine, type Missed, type Selection } from '$lib/pure/request-select';
	import { connectHref, requestHref } from '$lib/pure/routes';
	import { cn } from '$lib/utils.js';

	let data = $state<RequestsAcross | null>(null);
	let error = $state<{ message: string; signIn: boolean } | null>(null);
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
	/** The list again, keeping the rows on screen until the new ones come. */
	const refresh = () => listAcross().then((answer) => (data = answer), load);

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

	// Deleting: the row whose menu asked, then the list again with a line saying what went.
	let deleting = $state<{ id: string; projectId: number } | null>(null);
	let deleteOpen = $state(false);
	function ask(row: { id: string; projectId: number }): void {
		deleting = { id: row.id, projectId: row.projectId };
		deleteOpen = true;
	}
	function deleted(gone: Deleted): void {
		result = null;
		deletedNote.line = deletedLine(gone);
		if (data) data = { ...data, requests: data.requests.filter((r) => r.id !== deleting?.id) };
	}

	// Several at once: the ticks only ever hold rows the filters show.
	let selection = $state.raw<Selection>(NOTHING);
	const shown = $derived(view?.rows.map((r) => r.id) ?? []);
	const header = $derived(headerState(selection, shown));
	$effect(() => {
		const kept = prune(selection, shown);
		if (kept !== selection) selection = kept;
	});
	function pressRow(event: MouseEvent, id: string): void {
		// The box only stops its own toggle; the selection is ours.
		event.preventDefault();
		event.stopPropagation();
		selection = press(selection, id, shown, event.shiftKey);
	}
	function pressHeader(event: MouseEvent): void {
		event.preventDefault();
		selection = pressAll(selection, shown);
	}

	// The bar's actions work on the rows ticked when it was pressed.
	type Picked = { id: string; projectId: number; title: string | null; code: string };
	let acting = $state.raw<Picked[]>([]);
	let bulkDeleteOpen = $state(false);
	let bulkDuplicateOpen = $state(false);
	let result = $state<{ line: string; tone: 'info' | 'warning' } | null>(null);
	function act(which: 'delete' | 'duplicate'): void {
		acting = view ? picked(view.rows, selection).map(({ id, projectId, title, code }) => ({ id, projectId, title, code })) : [];
		if (which === 'delete') bulkDeleteOpen = true;
		else bulkDuplicateOpen = true;
	}
	function settled(kind: 'delete' | 'duplicate', outcome: { went: string[]; missed: Missed[] }): void {
		deletedNote.line = null;
		result = { line: resultLine(kind, { went: outcome.went.length, missed: outcome.missed }), tone: outcome.missed.length > 0 ? 'warning' : 'info' };
		if (kind === 'delete') {
			const gone = new Set(outcome.went);
			if (data) data = { ...data, requests: data.requests.filter((r) => !gone.has(r.id)) };
		} else {
			selection = NOTHING;
			void refresh();
		}
	}

	// New request: a dialog, also opened by `?new=1` (the old new request address).
	let creating = $state(page.url.searchParams.get('new') === '1');
	$effect(() => {
		if (creating && page.url.searchParams.has('new')) replaceState('/requests', {});
	});

	// Duplicating: the row whose menu asked.
	let duplicating = $state<{ id: string; projectId: number; name: string } | null>(null);
	let duplicateOpen = $state(false);

	const TH = 'text-muted-foreground border-border h-9 border-b px-3 text-left text-xs font-medium whitespace-nowrap';
	const TD = 'border-border border-b px-3 py-2';
</script>

<svelte:head><title>Requests · SG Bids</title></svelte:head>

<PageHeader title="Requests" {context}>
	{#snippet actions()}
		<Button onclick={() => (creating = true)} data-slot="new-request"><Plus data-icon="inline-start" />New request</Button>
	{/snippet}
	{#if view && view.counts.total > 0}
		<div class="flex flex-wrap items-center gap-2" data-slot="requests-toolbar">
			<div class="relative w-full sm:w-72">
				<Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
				<Input class="h-8 pl-8" type="search" placeholder="Find by name, project or bid" bind:value={query} aria-label="Find a request" />
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
			{#if selection.selected.size > 0}
				<div class="bg-muted ml-auto flex h-8 min-w-0 items-center gap-0.5 rounded-lg pr-0.5 pl-3" role="toolbar" aria-label="Selected requests" data-slot="requests-bulk-bar">
					<span class="mr-2 text-sm font-medium whitespace-nowrap tabular-nums" aria-live="polite" data-slot="requests-bulk-count">{selection.selected.size} selected</span>
					<Button size="sm" variant="ghost" onclick={() => act('duplicate')} data-slot="requests-bulk-duplicate">Duplicate…</Button>
					<Button size="sm" variant="ghost" class="hover:text-destructive" onclick={() => act('delete')} data-slot="requests-bulk-delete">Delete…</Button>
					<span class="bg-border mx-1 h-4 w-px" aria-hidden="true"></span>
					<Button size="sm" variant="ghost" class="text-muted-foreground" onclick={() => (selection = NOTHING)} data-slot="requests-bulk-clear">Clear selection</Button>
				</div>
			{/if}
		</div>
	{/if}
</PageHeader>

<SetupNotice />

{#if result}
	<div class="border-border border-b px-6 py-2.5">
		<Notice tone={result.tone} data-slot="bulk-result">
			{result.line}
			{#snippet action()}<Button size="sm" variant="ghost" onclick={() => (result = null)}>Dismiss</Button>{/snippet}
		</Notice>
	</div>
{:else if deletedNote.line}
	<div class="border-border border-b px-6 py-2.5">
		<Notice tone="info" data-slot="deleted-note">
			{deletedNote.line}
			{#snippet action()}<Button size="sm" variant="ghost" onclick={() => (deletedNote.line = null)}>Dismiss</Button>{/snippet}
		</Notice>
	</div>
{/if}

{#if error}
	<PageState state="error" title="Could not read the requests" line={error.message}>
		{#snippet action()}
			{#if error?.signIn}
				<Button href={connectHref('/requests')}>Sign in again</Button>
			{:else}
				<Button variant="outline" onclick={load}>Try again</Button>
			{/if}
		{/snippet}
	</PageState>
{:else if !view}
	<PageState state="loading" title="Reading your requests…" />
{:else if view.counts.total === 0}
	<PageState state="empty" icon={FileText} title="No requests yet" line="A request asks vendors to bid on shots and assets. Name it, add the rows and the vendors on one page, issue, and each vendor gets a link.">
		{#snippet action()}<Button onclick={() => (creating = true)} data-slot="empty-new-request"><Plus data-icon="inline-start" />New request</Button>{/snippet}
	</PageState>
{:else if view.rows.length === 0}
	<PageState state="empty" icon={SearchX} title="No request matches" line="Change the search or the project, or clear both.">
		{#snippet action()}<Button variant="outline" onclick={clear}>Clear the filters</Button>{/snippet}
	</PageState>
{:else}
	<div class="min-h-0 flex-1 overflow-auto" data-slot="requests-scroll">
		<table class="w-full min-w-[64rem] table-fixed border-separate border-spacing-0 text-sm" data-slot="requests">
			<colgroup>
				<col class="w-12" />
				<col />
				<col class="w-[15%]" />
				<col class="w-16" />
				<col class="w-16" />
				<col class="w-[11%]" />
				<col class="w-28" />
				<col class="w-16" />
				<col class="w-32" />
				<col class="w-16" />
				<col class="w-24" />
				<col class="w-14" />
			</colgroup>
			<thead class="bg-background sticky top-0 z-10">
				<tr>
					<th class={cn(TH, 'pr-0 pl-6')}>
						<Checkbox
							class="align-middle"
							checked={header === 'all'}
							indeterminate={header === 'some'}
							onclick={pressHeader}
							aria-label={view.filtered ? 'Select every request shown' : 'Select every request'}
							data-slot="requests-select-all"
						/>
					</th>
					<th class={TH}>Request</th>
					<th class={TH}>Bids</th>
					<th class={cn(TH, 'text-right')}>Shots</th>
					<th class={cn(TH, 'text-right')}>Assets</th>
					<th class={TH}>Project</th>
					<th class={TH}>Status</th>
					<th class={cn(TH, 'text-right')}>Round</th>
					<th class={TH}>Answers due</th>
					<th class={cn(TH, 'text-right')}>Invited</th>
					<th class={cn(TH, 'text-right')}>Answers in</th>
					<th class={cn(TH, 'pr-6')}><span class="sr-only">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each view.rows as row (row.id)}
					{@const on = selection.selected.has(row.id)}
					{@const bids = bidsCell(row.bids)}
					<tr class={cn('group hover:bg-muted/60 relative', on && 'bg-primary/5 hover:bg-primary/10')} data-status={row.status} data-selected={on || undefined}>
						<td class={cn(TD, 'pr-0 pl-6')}>
							<Checkbox
								class="relative z-10 align-middle"
								checked={on}
								onclick={(e: MouseEvent) => pressRow(e, row.id)}
								aria-label={`Select ${requestName(row)}`}
								data-slot="row-select"
							/>
						</td>
						<td class={TD}>
							<a
								class="focus-visible:ring-ring flex min-w-0 items-baseline gap-3 rounded-sm outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-offset-2"
								href={requestHref(row)}
								onclick={() => remember(row)}
							>
								<span class={cn('truncate font-medium', !row.title && 'text-muted-foreground')} title={row.title ?? undefined}>{row.title ?? row.code}</span>
							</a>
						</td>
						<td class={TD} title={bids.title || undefined} data-slot="row-bids">
							{#if bids.shown}
								<span class="flex min-w-0 items-baseline gap-1.5">
									<span class="truncate">{bids.shown}</span>
									{#if bids.more > 0}<span class="text-muted-foreground shrink-0 text-xs tabular-nums">+{bids.more}</span>{/if}
								</span>
							{:else}
								<span class="text-muted-foreground">None</span>
							{/if}
						</td>
						<td class={cn(TD, 'text-right tabular-nums', row.shots === 0 && 'text-muted-foreground')} data-slot="row-shots">{row.shots.toLocaleString('en-US')}</td>
						<td class={cn(TD, 'text-right tabular-nums', row.assets === 0 && 'text-muted-foreground')} data-slot="row-assets">{row.assets.toLocaleString('en-US')}</td>
						<td class={cn(TD, 'text-muted-foreground truncate')} title={row.projectName}>{row.projectName}</td>
						<td class={TD}><StatusChip status={row.status} /></td>
						<td class={cn(TD, 'text-right tabular-nums')}>{row.round}</td>
						<td class={cn(TD, 'whitespace-nowrap tabular-nums', !row.dueDate && 'text-muted-foreground')}>{row.dueDate ? day(row.dueDate) : 'None'}</td>
						<td class={cn(TD, 'text-right tabular-nums', row.invited === 0 && 'text-muted-foreground')}>{row.invited}</td>
						<td class={cn(TD, 'text-right tabular-nums', row.submitted === 0 && 'text-muted-foreground')}>
							{#if row.invited > 0}<span class="text-foreground font-medium">{row.submitted}</span>{' '}<span class="text-muted-foreground">of {row.invited}</span>{:else}{row.submitted}{/if}
						</td>
						<td class={cn(TD, 'py-1 pr-6 text-right')}>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger
									class="hover:bg-accent focus-visible:ring-ring text-muted-foreground hover:text-foreground relative z-10 inline-flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2"
									aria-label={`More for ${row.title ?? row.code}`}
									data-slot="row-actions"
								>
									<Ellipsis class="size-4" />
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end">
									<DropdownMenu.Item onSelect={() => (remember(row), goto(requestHref(row)))}>Open</DropdownMenu.Item>
									<DropdownMenu.Item
										onSelect={() => ((duplicating = { id: row.id, projectId: row.projectId, name: row.title ?? row.code }), (duplicateOpen = true))}
										data-slot="row-duplicate">Duplicate…</DropdownMenu.Item
									>
									<DropdownMenu.Separator />
									<DropdownMenu.Item class="text-destructive" onSelect={() => ask(row)} data-slot="row-delete">{row.status === 'draft' ? 'Delete draft…' : 'Delete request…'}</DropdownMenu.Item>
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
	<DeleteRequest bind:open={deleteOpen} projectId={deleting.projectId} requestId={deleting.id} ondeleted={deleted} />
{/if}
<BulkDelete bind:open={bulkDeleteOpen} rows={acting} ondone={(outcome) => settled('delete', outcome)} />
<BulkDuplicate bind:open={bulkDuplicateOpen} rows={acting} ondone={(outcome) => settled('duplicate', outcome)} />
{#if duplicating}
	<DuplicateRequest bind:open={duplicateOpen} projectId={duplicating.projectId} requestId={duplicating.id} name={duplicating.name} />
{/if}
<NewRequest bind:open={creating} />
