<!--
	Bid requests: the project's requests with their status, round, due date, invitations and bids,
	newest first. The project is picked here or in the builder and kept in this browser. A draft
	this tab holds but has not stored yet is listed on top. Not connected, it sends to Connect.
-->
<script lang="ts">
	import FileText from '@lucide/svelte/icons/file-text';
	import Plus from '@lucide/svelte/icons/plus';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import StatusChip from '$lib/app/status-chip.svelte';
	import ProjectPicker from '$lib/components/project-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { api, type RequestOverview } from '$lib/api';
	import { currentProject, setCurrentProject } from '$lib/current-project';
	import { cushion } from '$lib/drafts';
	import { liveContext, prepareLive } from '$lib/live';
	import type { ProjectPick } from '$lib/pure/header';
	import type { BidRequest } from '$lib/pure/model';

	const live = prepareLive();
	let project = $state<ProjectPick | null>(null);
	let rows = $state<RequestOverview[] | null>(null);
	let error = $state<string | null>(null);
	let local = $state<BidRequest | null>(null);

	void live.then((state) => {
		if (state.problem) return;
		project = currentProject(state.siteUrl);
	});
	void cushion.read().then((kept) => (local = kept && kept.id.startsWith('local-') ? kept : null));

	$effect(() => {
		const picked = project;
		rows = null;
		error = null;
		if (!picked) return;
		let alive = true;
		api.list(picked.id).then(
			(answer) => alive && (rows = answer),
			(failure) => alive && (error = failure instanceof Error ? failure.message : String(failure))
		);
		return () => {
			alive = false;
		};
	});

	async function pick(next: ProjectPick | null): Promise<void> {
		setCurrentProject((await live).siteUrl, next);
		project = next;
	}

	const dayFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
	const day = (value: string | null) => (value ? dayFormat.format(new Date(`${value}T00:00:00Z`)) : '');
	const href = (row: RequestOverview) => (row.status === 'draft' ? `/bids/new?id=${row.id}` : `/bids/${row.id}`);
</script>

<svelte:head><title>Bid requests · SG Bids</title></svelte:head>

{#await live}
	<PageState state="loading" title="Connecting to Flow PT…" />
{:then state}
	{#if state.problem}
		<PageState state="empty" title="Not connected" line={state.problem}>
			{#snippet action()}<Button href="/connect">Connect</Button>{/snippet}
		</PageState>
	{:else}
		<PageHeader title="Bid requests" context={project ? `${project.name}. Requests are kept per project.` : 'Pick the project to see its requests.'}>
			{#snippet actions()}
				<div class="w-64">
					<ProjectPicker
						context={liveContext()}
						value={project ? { type: 'Project', id: project.id, name: project.name } : null}
						onValueChange={(next) => void pick(next ? { id: next.id, name: next.name ?? `Project ${next.id}` } : null)}
						placeholder="Pick a project"
					/>
				</div>
				<Button href="/bids/new"><Plus data-icon="inline-start" />New request</Button>
			{/snippet}
		</PageHeader>

		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<div class="flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
				{#if local}
					<Notice tone="info" title="A draft is not saved yet.">
						{' '}{local.header.title ?? 'Untitled'}{local.header.project ? `, ${local.header.project}` : ''}. It saves once it has a project and a code.
						{#snippet action()}<Button size="sm" variant="outline" href="/bids/new">Open it</Button>{/snippet}
					</Notice>
				{/if}
				{#if !project}
					<PageState state="empty" icon={FileText} title="No project picked" line="Pick the project in the header, or start a request." />
				{:else if error}
					<Notice tone="destructive" title="Could not read the requests.">{' '}{error}</Notice>
				{:else if rows === null}
					<p class="text-muted-foreground text-sm" role="status">Reading the requests…</p>
				{:else if rows.length === 0}
					<PageState state="empty" icon={FileText} title="No requests yet" line="Start one from this project's Shots and Assets.">
						{#snippet action()}<Button href="/bids/new">New request</Button>{/snippet}
					</PageState>
				{:else}
					<table class="w-full text-sm" data-slot="requests">
						<thead>
							<tr class="text-muted-foreground border-border border-b text-left text-xs">
								<th class="py-2 pr-3 font-medium">Request</th>
								<th class="px-3 py-2 font-medium">Status</th>
								<th class="px-3 py-2 text-right font-medium">Round</th>
								<th class="px-3 py-2 font-medium">Bids due</th>
								<th class="px-3 py-2 text-right font-medium">Invited</th>
								<th class="py-2 pl-3 text-right font-medium">Bids in</th>
							</tr>
						</thead>
						<tbody>
							{#each rows as row (row.id)}
								<tr class="border-border hover:bg-muted/50 border-b">
									<td class="py-2.5 pr-3">
										<a class="flex flex-col outline-none focus-visible:underline" href={href(row)}>
											<span class="font-medium">{row.title ?? 'Untitled request'}</span>
											<span class="text-muted-foreground font-mono text-xs">{row.code}</span>
										</a>
									</td>
									<td class="px-3 py-2.5"><StatusChip status={row.status} /></td>
									<td class="px-3 py-2.5 text-right tabular-nums">{row.round}</td>
									<td class="px-3 py-2.5">{day(row.dueDate)}</td>
									<td class="px-3 py-2.5 text-right tabular-nums">{row.invited}</td>
									<td class="py-2.5 pl-3 text-right tabular-nums">{row.submitted}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		</div>
	{/if}
{:catch failure}
	<PageState state="error" title="Could not connect to Flow PT" line={failure.message} />
{/await}
