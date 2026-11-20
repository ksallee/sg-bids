<!--
	Dev only. The Flow PT setup report for a picked project, and a button that creates the missing
	fields. Reads and writes as the signed-in person. All logic is in `$lib/pure/fpt-setup` and
	`$lib/io/fpt-setup`.
-->
<script lang="ts">
	import PageBody from '$lib/app/page-body.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import Notice from '$lib/app/notice.svelte';
	import ProjectPicker from '$lib/components/project-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { currentProject } from '$lib/current-project';
	import { liveAuth, liveContext, prepareLive, whoAmI } from '$lib/live';
	import { fptApi } from '$lib/io/fpt-api';
	import { ensureFields, readSetup, type EnsureResult, type SetupRead } from '$lib/io/fpt-setup';
	import { connectHref } from '$lib/pure/routes';

	const live = prepareLive();
	let project = $state<{ id: number; name: string } | null>(null);
	let projectId = $state<number | null>(null);
	let read = $state<Promise<SetupRead> | null>(null);
	let ensured = $state<EnsureResult | null>(null);
	let busy = $state(false);
	let failure = $state<string | null>(null);

	const api = () => fptApi(liveAuth().siteUrl, liveAuth().token);

	// Start on the project the builder last picked in this browser.
	$effect(() => {
		void live.then((state) => {
			const remembered = state.problem ? null : currentProject(state.siteUrl);
			if (remembered && projectId === null) pick(remembered);
		});
	});

	async function load(id: number): Promise<SetupRead> {
		const me = await whoAmI();
		return readSetup(api(), id, { me: me?.id });
	}

	function pick(next: { id: number; name: string } | null) {
		project = next;
		projectId = next?.id ?? null;
		ensured = null;
		read = projectId === null ? null : load(projectId);
	}

	async function create(current: SetupRead) {
		busy = true;
		failure = null;
		try {
			ensured = await ensureFields(api(), current);
			if (projectId !== null) read = load(projectId);
		} catch (e) {
			failure = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>FPT setup · SG Bids</title></svelte:head>

{#await live}
	<PageState state="loading" title="Connecting to Flow PT…" />
{:then state}
	{#if state.problem}
		<PageState state="empty" title="Not connected" line={state.problem}>
			{#snippet action()}<Button href={connectHref('/dev/fpt')}>Connect</Button>{/snippet}
		</PageState>
	{:else}
		<PageHeader measure="wide" title="Flow PT setup" context="Dev only. The Bid and Bid Line fields, and what the Vendor role can see.">
			<div class="max-w-sm">
				<ProjectPicker
					context={liveContext()}
					value={project ? { type: 'Project', id: project.id, name: project.name } : null}
					onValueChange={(next) => pick(next ? { id: next.id, name: next.name ?? `Project ${next.id}` } : null)}
				/>
			</div>
		</PageHeader>

		<PageBody measure="wide" class="text-sm">
			{#if read}
				{#await read}
					<PageState state="loading" title="Reading the site…" />
				{:then current}
					{@const report = current.report}
					<section class="flex flex-col gap-2">
						<h2 class="font-semibold">Summary</h2>
						<p>Ready: {report.ready ? 'yes' : 'no'}. Safe from vendors: {report.safe ? 'yes' : 'no'}.</p>
						<p>
							Bid: {report.entities.bid.state === 'found' ? report.entities.bid.type : report.entities.bid.state}. Bid Line: {report.entities.line.state === 'found'
								? report.entities.line.type
								: report.entities.line.state}.
						</p>
						<p>
							Vendor groups field: Shot {report.vendorField.Shot.field ?? 'none'}, Asset {report.vendorField.Asset.field ?? 'none'}.
						</p>
						<p>
							Statuses: {Object.entries(report.statuses.codes)
								.map(([app, code]) => `${app.replace('_', ' ')} ${code}`)
								.join(', ') || 'none'}{report.statuses.unmapped.length ? `. None for ${report.statuses.unmapped.join(', ').replace('_', ' ')}` : ''}.
						</p>
						<p>
							{report.access.group} role: Bid {report.access.bid.state.replace('_', ' ')}, Bid Line {report.access.line.state.replace('_', ' ')}, Event Log {report.access.eventLog.state.replace('_', ' ')}.
						</p>
					</section>

					{#if report.risks.length}
						<section class="flex flex-col gap-2">
							<h2 class="font-semibold">Risks</h2>
							{#each report.risks as risk, i (i)}<Notice tone="warning">{risk}</Notice>{/each}
						</section>
					{/if}

					{#if report.adminSteps.length}
						<section class="flex flex-col gap-2">
							<h2 class="font-semibold">For an admin, in the web interface</h2>
							<ol class="list-decimal pl-5">
								{#each report.adminSteps as step, i (i)}<li>{step}</li>{/each}
							</ol>
						</section>
					{/if}

					<section class="flex flex-col gap-2">
						<div class="flex items-center gap-3">
							<h2 class="font-semibold">Fields</h2>
							<Button size="sm" disabled={busy || !report.fields.some((f) => f.state === 'missing')} onclick={() => create(current)}>
								{busy ? 'Creating…' : 'Create missing fields'}
							</Button>
						</div>
						<table class="w-full border-separate border-spacing-0 [&_td]:border-b [&_td]:py-1.5 [&_td]:pr-3 [&_th]:border-b [&_th]:py-2 [&_th]:pr-3 [&_th]:text-xs [&_th]:font-medium">
							<thead class="text-muted-foreground text-left">
								<tr><th>Entity</th><th>Field</th><th>Type</th><th>State</th></tr>
							</thead>
							<tbody>
								{#each report.fields as f (`${f.entity}.${f.spec.name}`)}
									<tr>
										<td>{f.entity === 'bid' ? 'Bid' : 'Bid Line'}</td>
										<td class="font-mono text-xs">{f.spec.name}</td>
										<td>{f.spec.dataType}</td>
										<td>{f.state.replace('_', ' ')}{f.actual ? ` (${f.actual.dataType})` : ''}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</section>
				{:catch error}
					<PageState state="error" title="Could not read the site" line={error.message} />
				{/await}
			{:else}
				<PageState state="empty" title="Pick a project" line="The report reads the project's schema and the Vendor role's rules." />
			{/if}

			{#if failure}<Notice tone="destructive">{failure}</Notice>{/if}
			{#if ensured}
				<section class="flex flex-col gap-2">
					<h2 class="font-semibold">Last run</h2>
					<ul>
						{#each ensured.outcomes as o (`${o.create.entityType}.${o.create.name}`)}
							<li class="font-mono">{o.create.entityType}.{o.create.name}: {o.outcome.state}{o.outcome.state === 'failed' ? ` ${o.outcome.title}` : ''}</li>
						{/each}
						{#each ensured.plan.skipped as s (`${s.entity}.${s.name}`)}<li class="font-mono">{s.name}: skipped. {s.reason}</li>{/each}
					</ul>
				</section>
			{/if}
		</PageBody>
	{/if}
{:catch error}
	<PageState state="error" title="Could not connect to Flow PT" line={error.message} />
{/await}
