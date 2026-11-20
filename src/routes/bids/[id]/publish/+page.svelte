<!--
	Publish the chosen scenario to Flow PT: what must be true first on the right, every write in order
	on the left, then the run and the award. State in $lib/app/award/publish.svelte.ts, rules in
	$lib/pure/award-gate and fpt-award.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import StatusChip from '$lib/app/status-chip.svelte';
	import AwardPanel from '$lib/app/award/award-panel.svelte';
	import UndoNote from '$lib/app/award/undo-note.svelte';
	import GateRail from '$lib/app/award/gate-rail.svelte';
	import WriteLedger from '$lib/app/award/write-ledger.svelte';
	import { PublishState } from '$lib/app/award/publish.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { currentProject } from '$lib/current-project';
	import { prepareLive } from '$lib/live';

	const id = $derived(page.params.id ?? '');
	let s = $state<PublishState | null>(null);
	let siteUrl = $state('');

	async function load(): Promise<void> {
		const live = await prepareLive();
		if (live.problem) throw new Error(live.problem);
		const project = currentProject(live.siteUrl);
		if (!project) throw new Error('Pick the project on the requests list first.');
		siteUrl = live.siteUrl;
		const next = new PublishState(project.id, id);
		await next.load();
		s = next;
		void next.readSite();
	}

	const ready = $derived(load());

	// Plan again whenever what the plan depends on changes, a moment after.
	$effect(() => {
		const current = s;
		if (!current) return;
		const key = JSON.stringify([current.gate?.blockers, current.allLines, current.groups, current.missing, current.itemFields !== null, current.setup?.report.fields.length, current.publication?.updatedAt]);
		void key;
		if (untrack(() => current.phase) !== 'idle') return;
		const timer = setTimeout(() => void current.preview(), 250);
		return () => clearTimeout(timer);
	});

	const failedAt = $derived(s?.published?.error ? (s.published.plan.steps.map((x) => x.label).find((l) => !s!.published!.stepsDone.includes(l)) ?? null) : null);
</script>

<svelte:head><title>Publish the award · SG Bids</title></svelte:head>

{#await ready}
	<PageState state="loading" title="Opening the award…" />
{:then}
	{#if s?.data}
		{@const r = s.data.request}
		<PageHeader title="Publish the award to Flow PT">
			{#snippet context()}
				<StatusChip status={s!.data!.status} />
				<span class="text-foreground">{r.header.title ?? 'Untitled request'}</span>
				<span>{s!.scenario ? `Scenario: ${s!.scenario.name}` : 'No scenario chosen'}</span>
			{/snippet}
			{#snippet actions()}
				<Button variant="outline" href={`/bids/${r.id}`}>The request</Button>
				<Button variant="outline" href={`/bids/${r.id}/compare`}>Compare</Button>
			{/snippet}
		</PageHeader>

		<div class="flex min-h-0 flex-1 flex-col lg:flex-row">
			<div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
				<div class="flex max-w-5xl flex-col gap-6 px-6 py-6">
					{#if s.phase === 'done'}
						<Notice tone="info" data-slot="published">Published and read back. Every write landed as sent.</Notice>
					{:else if s.phase === 'failed'}
						<Notice tone="destructive" data-slot="publish-failed">
							{#if s.published && s.recordError}
								Flow PT holds what is below, and the app could not record it: {s.recordError}
							{:else if s.published}
								The run stopped part way. The app recorded what landed. Publish again to finish it, or undo it.
							{:else}
								Nothing was recorded: {s.recordError}
							{/if}
							{#snippet action()}
								{#if s!.published && s!.recordError}<Button size="sm" onclick={() => void s!.record()}>Record it again</Button>{/if}
							{/snippet}
						</Notice>
					{/if}

					<UndoNote requestId={r.id} />
					{#if s.publication && s.phase !== 'publishing'}
						<AwardPanel
							projectId={s.projectId}
							request={r}
							publication={s.publication}
							{siteUrl}
							resume={false}
							onChange={(next) => {
								s!.publication = next;
								s!.phase = 'idle';
								s!.published = null;
								void s!.load();
							}}
						/>
						{#if s.publication.state === 'published' && s.phase === 'idle'}
							<p class="text-muted-foreground text-sm">Change the chosen scenario and publish again: the rows are updated by key, and what it no longer awards is taken back.</p>
						{/if}
					{/if}

					{#if s.published && s.phase !== 'idle'}
						<WriteLedger plan={s.published.plan} done={s.published.stepsDone} {failedAt} />
						{#if s.published.problems.length}
							<div class="flex flex-col gap-1">
								<h3 class="text-sm font-semibold">Read back different from what was sent</h3>
								<ul class="text-muted-foreground list-disc pl-5 text-sm">{#each s.published.problems as p, i (i)}<li>{p}</li>{/each}</ul>
							</div>
						{/if}
					{:else if s.phase === 'publishing' && s.prepared}
						<WriteLedger plan={s.prepared.plan} running={s.stepNow} />
					{:else if s.prepared}
						<WriteLedger plan={s.prepared.plan} />
					{:else if s.previewError}
						<PageState state="error" title="Could not plan the award" line={s.previewError} />
					{:else if s.previewing}
						<PageState state="loading" title="Reading what Flow PT holds…" />
					{:else}
						<PageState state="empty" title="The preview shows here" line="Once nothing on the right blocks, every write to Flow PT shows here before anything is written." />
					{/if}
				</div>
			</div>
			<GateRail state={s} />
		</div>
	{/if}
{:catch error}
	<PageState state="error" title="Could not open the award" line={error.message}>
		{#snippet action()}<Button href={`/bids/${id}`}>The request</Button>{/snippet}
	</PageState>
{/await}
