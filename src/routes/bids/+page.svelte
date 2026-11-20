<!--
	The signed-in landing: who is signed in, and the bids, of which there are none yet. Not
	connected, it sends the person to Connect.
-->
<script lang="ts">
	import FileText from '@lucide/svelte/icons/file-text';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import UserAvatar from '$lib/components/user-avatar.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { prepareLive, whoAmI } from '$lib/live';

	const live = prepareLive();
</script>

<svelte:head><title>Bids · SG Bids</title></svelte:head>

{#await live}
	<PageState state="loading" title="Connecting to Flow PT…" />
{:then state}
	{#if state.problem}
		<PageState state="empty" title="Not connected" line={state.problem}>
			{#snippet action()}<Button href="/connect">Connect</Button>{/snippet}
		</PageState>
	{:else}
		<PageHeader title="Bids">
			{#snippet context()}
				{#if state.session}
					{#await whoAmI()}
						<span>Signed in as {state.session.login}</span>
					{:then person}
						{@const name = (person?.attributes.name as string | undefined) ?? state.session.login}
						<UserAvatar {name} image={(person?.attributes.image as string | null | undefined) ?? null} size="sm" />
						<span>Signed in as <span class="text-foreground font-medium">{name}</span></span>
					{/await}
				{:else}
					<span>Reading with the dev key. Nobody is signed in.</span>
				{/if}
			{/snippet}
		</PageHeader>
		<PageState state="empty" icon={FileText} title="No bids yet" line="Bid requests come in a later version." />
	{/if}
{:catch error}
	<PageState state="error" title="Could not connect to Flow PT" line={error.message} />
{/await}
