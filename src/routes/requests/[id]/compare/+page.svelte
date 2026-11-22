<!--
	A request's bids side by side, and the award scenarios. A workbench: the grid takes the full width
	and the rest of the height, the scenario rail sits on the right. The state and its logic are in $lib/app/compare and $lib/pure.
-->
<script lang="ts">
	import { page } from '$app/state';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import StatusChip from '$lib/app/status-chip.svelte';
	import CompareGrid from '$lib/app/compare/compare-grid.svelte';
	import GridToolbar from '$lib/app/compare/grid-toolbar.svelte';
	import RowDetail from '$lib/app/compare/row-detail.svelte';
	import ScenarioRail from '$lib/app/compare/scenario-rail.svelte';
	import AwardPanel from '$lib/app/award/award-panel.svelte';
	import UndoNote from '$lib/app/award/undo-note.svelte';
	import { CompareState } from '$lib/app/compare/state.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { workingProject } from '$lib/current-project';
	import { prepareLive } from '$lib/live';
	import type { Row } from '$lib/pure/compare';

	const id = $derived(page.params.id ?? '');
	let s = $state<CompareState | null>(null);
	let detail = $state<Row | null>(null);
	let siteUrl = $state('');

	async function load(): Promise<void> {
		const live = await prepareLive();
		if (live.problem) throw new Error(live.problem);
		siteUrl = live.siteUrl;
		const project = workingProject(live.siteUrl, page.url);
		if (!project) throw new Error('Open the request from the Requests page first.');
		const next = new CompareState(project.id, id);
		await next.load();
		s = next;
	}

	const ready = $derived(load());

	$effect(() => {
		const current = s;
		if (!current) return;
		const leave = (e: BeforeUnloadEvent) => {
			if (current.saveState === 'waiting' || current.saveState === 'saving') {
				void current.flush();
				e.preventDefault();
			}
		};
		addEventListener('beforeunload', leave);
		return () => {
			removeEventListener('beforeunload', leave);
			void current.flush();
		};
	});
</script>

<svelte:head><title>Compare · SG Bids</title></svelte:head>

{#await ready}
	<PageState state="loading" title="Opening the answers…" />
{:then}
	{#if s?.data && s.grid}
		{@const r = s.data.request}
		{@const needRates = s.grid.columns.filter((c) => c.needsRate).length}
		<PageHeader title={`Compare: ${r.header.title ?? 'Untitled request'}`} back={{ href: `/requests/${r.id}`, label: 'The request' }}>
			{#snippet context()}
				<StatusChip status={s!.data!.status} />
				<span class="text-foreground">{r.header.project}</span>
				{#if r.header.round > 1}<span>Round {r.header.round}</span>{/if}
				<span>{s!.grid!.columns.length} {s!.grid!.columns.length === 1 ? 'answer' : 'answers'} in {r.header.baseCurrency}</span>
			{/snippet}
			{#if needRates > 0}
				<Notice tone="warning">
					{needRates === 1 ? 'One answer needs' : `${needRates} answers need`} a rate to {r.header.baseCurrency}. Its figures show in its own currency until you set one in its column.
				</Notice>
			{/if}
			{#if s.data.awarded}<Notice tone="info">The award is made. The rates are locked.</Notice>{/if}
		</PageHeader>

		<UndoNote requestId={r.id} />
		{#if s.data.publication}
			<div class="border-b px-6 py-4">
				<AwardPanel projectId={s.projectId} request={r} publication={s.data.publication} siteUrl={siteUrl} onChange={() => void s!.load()} />
			</div>
		{/if}

		{#if s.grid.columns.length === 0}
			<PageState state="empty" title="No answers in yet" line="Answers show here once vendors submit them. Drafts stay theirs.">
				{#snippet action()}<Button href={`/requests/${r.id}`}>The request</Button>{/snippet}
			</PageState>
		{:else}
			<div class="flex min-h-0 flex-1">
				<div class="flex min-h-0 min-w-0 flex-1 flex-col">
					<GridToolbar state={s} code={r.header.title?.trim() || s.data.code} />
					{#if s.view && s.view.shown === 0}
						<PageState state="empty" title="No row fits the filters" line="Loosen a filter to see rows again.">
							{#snippet action()}<Button variant="outline" onclick={() => s!.clearFilters()}>Clear the filters</Button>{/snippet}
						</PageState>
					{:else}
						<CompareGrid state={s} onDetail={(row) => (detail = row)} />
					{/if}
				</div>
				<ScenarioRail state={s} />
			</div>
			<RowDetail state={s} row={detail} onClose={() => (detail = null)} />
		{/if}
	{/if}
{:catch error}
	<PageState state="error" title="Could not open the answers" line={error.message}>
		{#snippet action()}<Button href={`/requests/${id}`}>The request</Button>{/snippet}
	</PageState>
{/await}
