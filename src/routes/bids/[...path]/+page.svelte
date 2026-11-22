<!--
	The Bids pages are gone: a request holds its bids now. Every old `/bids` address goes on: to the
	request it names (`/bids/<id>`, `/compare`, `/publish`, `/bids/new?id=`), else to the Requests
	list (`routes.movedRequestPath`). Whether `/bids/<id>` names a request is read once.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import PageState from '$lib/app/page-state.svelte';
	import SessionGate from '$lib/app/session-gate.svelte';
	import { api } from '$lib/api';
	import { workingProject } from '$lib/current-project';
	import { liveState } from '$lib/live';
	import { movedRequestPath } from '$lib/pure/routes';
	import { parseId } from '$lib/pure/wire';

	async function names(id: string): Promise<boolean> {
		const project = workingProject(liveState().siteUrl, page.url);
		if (!project || !parseId(id)) return false;
		return api.get(project.id, id).then(
			() => true,
			() => false
		);
	}

	async function go(): Promise<void> {
		const one = /^\/bids\/([^/]+)\/?$/.exec(page.url.pathname);
		const isRequest = one !== null && one[1] !== 'new' && (await names(one[1]));
		await goto(movedRequestPath(page.url.pathname, page.url.search, isRequest) ?? '/requests', { replaceState: true });
	}
</script>

<SessionGate>
	{#await go()}
		<PageState state="loading" title="Opening the request…" />
	{/await}
</SessionGate>
