<!--
	A request's one page. A draft is built here (`$lib/app/builder/draft-page`); once issued, the same
	page shows its vendors and their links, the award and what went out (`$lib/app/request/issued-page`).
	The links made at the issue are held here, in this page alone, and shown once.
-->
<script lang="ts">
	import { page } from '$app/state';
	import PageState from '$lib/app/page-state.svelte';
	import DraftPage from '$lib/app/builder/draft-page.svelte';
	import IssuedPage from '$lib/app/request/issued-page.svelte';
	import { Builder } from '$lib/app/builder.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { api, type Invited, type LoadedRequest } from '$lib/api';
	import { setCurrentProject, unnamed, workingProject } from '$lib/current-project';
	import { liveContext, prepareLive } from '$lib/live';
	import { projectName } from '$lib/io/reads';
	import type { ProjectPick } from '$lib/pure/header';
	import { vendorLink } from '$lib/pure/invitations';

	const id = $derived(page.params.id ?? '');
	let project = $state<ProjectPick | null>(null);
	let siteUrl = $state('');
	let loaded = $state.raw<LoadedRequest | null>(null);
	let builder = $state.raw<Builder | null>(null);
	let links = $state.raw<ReadonlyMap<string, string>>(new Map());
	let justIssued = $state(false);

	async function refresh(): Promise<void> {
		loaded = await api.get(project!.id, id);
		if (loaded.status === 'draft' && (!builder || builder.state.id !== loaded.request.id)) builder = new Builder(loaded, project!);
		if (loaded.status !== 'draft') builder = null;
	}

	async function load(): Promise<void> {
		const live = await prepareLive();
		if (live.problem) throw new Error(live.problem);
		siteUrl = live.siteUrl;
		let found = workingProject(live.siteUrl, page.url);
		if (!found) throw new Error('Open the request from the Requests page.');
		if (unnamed(found)) {
			const name = await projectName(liveContext().client, found.id).catch(() => null);
			if (name) {
				found = { id: found.id, name };
				setCurrentProject(live.siteUrl, found);
			}
		}
		project = found;
		builder = null;
		links = new Map();
		justIssued = false;
		await refresh();
	}

	const ready = $derived(id ? load() : Promise.resolve());

	async function issued(made: Invited[]): Promise<void> {
		links = new Map(made.map((l) => [l.invitation.id, vendorLink(location.origin, l.token)]));
		justIssued = true;
		builder = null;
		await refresh();
		window.scrollTo({ top: 0 });
	}
</script>

{#await ready}
	<PageState state="loading" title="Opening the request…" />
{:then}
	{#if loaded && project}
		{#if builder}
			{#key builder}
				{#await builder.ready}
					<PageState state="loading" title="Reading the rows from Flow PT…" />
				{:then}
					<DraftPage {builder} onIssued={(made) => void issued(made)} />
				{/await}
			{/key}
		{:else if loaded.status !== 'draft'}
			<IssuedPage {loaded} projectId={project.id} {siteUrl} {links} {justIssued} onRefresh={refresh} />
		{/if}
	{/if}
{:catch error}
	<PageState state="error" title="Could not open the request" line={error.message}>
		{#snippet action()}<Button href="/requests">Requests</Button>{/snippet}
	</PageState>
{/await}
