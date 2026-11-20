<!--
	Bid requests: who is signed in, the draft in progress, and New request. Only the draft this tab
	holds is listed until requests are stored (`$lib/drafts`). Not connected, it sends the person to
	Connect.
-->
<script lang="ts">
	import FileText from '@lucide/svelte/icons/file-text';
	import Plus from '@lucide/svelte/icons/plus';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import UserAvatar from '$lib/components/user-avatar.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { drafts } from '$lib/drafts';
	import { prepareLive, whoAmI } from '$lib/live';
	import { summarize } from '$lib/pure/request';

	const live = prepareLive();
	const draft = drafts.loadDraft();
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
		<PageHeader title="Bid requests">
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
			{#snippet actions()}
				<Button href="/bids/new"><Plus data-icon="inline-start" />New request</Button>
			{/snippet}
		</PageHeader>
		{#await draft then found}
			{#if found && (found.header.projectRef || found.shots.length + found.assets.length > 0)}
				{@const counts = summarize(found)}
				<div class="flex w-full max-w-3xl flex-col gap-3 px-6 py-6">
					<h2 class="text-sm font-semibold">In progress</h2>
					<a
						href="/bids/new?step=review"
						class="bg-card text-card-foreground hover:border-foreground/25 focus-visible:ring-ring flex items-center gap-4 rounded-lg border p-4 outline-none transition-colors duration-150 focus-visible:ring-2"
						data-slot="draft-row"
					>
						<FileText class="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
						<div class="flex min-w-0 flex-1 flex-col gap-0.5">
							<span class="truncate text-sm font-medium">{found.header.title ?? 'Untitled request'}</span>
							<span class="text-muted-foreground truncate text-xs">
								{found.header.project || 'No project yet'}{found.header.code ? `, ${found.header.code}` : ''}. {counts.shots}
								{counts.shots === 1 ? 'shot' : 'shots'} and {counts.assets}
								{counts.assets === 1 ? 'asset' : 'assets'}.
							</span>
						</div>
						<span class="text-muted-foreground text-xs">Draft</span>
					</a>
					<p class="text-muted-foreground text-xs">Drafts live in this tab for now. Sent requests are listed here once they are stored.</p>
				</div>
			{:else}
				<PageState state="empty" icon={FileText} title="No requests yet" line="Start one from a project's Shots and Assets.">
					{#snippet action()}<Button href="/bids/new">New request</Button>{/snippet}
				</PageState>
			{/if}
		{/await}
	{/if}
{:catch error}
	<PageState state="error" title="Could not connect to Flow PT" line={error.message} />
{/await}
