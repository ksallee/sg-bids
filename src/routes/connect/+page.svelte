<!--
	Connect: the Flow PT site and who reads it. A signed-in page sends a person here only when there
	is no session, with the page to come back to in `next` (checked by `safeNext`); after the sign-in
	they go back to it. Opened from the site in the header, it is where to see who you are, change
	the site or sign out. It is never a step on the way to the requests.
-->
<script lang="ts">
	import { page } from '$app/state';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Globe from '@lucide/svelte/icons/globe';
	import UserRound from '@lucide/svelte/icons/user-round';
	import PageBody from '$lib/app/page-body.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import Notice from '$lib/app/notice.svelte';
	import UserAvatar from '$lib/components/user-avatar.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { prepareLive, setSiteUrl, signIn, signOut, whoAmI, type LiveState } from '$lib/live';
	import { safeNext } from '$lib/pure/routes';

	let editingSite = $state(false);
	let siteDraft = $state('');
	let approving = $state(false);
	let refusal = $state<string | null>(null);

	const live = prepareLive();
	/** Where to go after the sign-in, when a page sent the person here. */
	const next = $derived(page.url.searchParams.has('next') ? safeNext(page.url.searchParams.get('next')) : null);

	function useSite(): void {
		const value = siteDraft.trim();
		if (!value) return;
		setSiteUrl(value);
		location.reload();
	}

	async function onSignIn(state: LiveState): Promise<void> {
		refusal = null;
		approving = true;
		try {
			await signIn(state.siteUrl, (url) => window.open(url, '_blank', 'noopener'));
			if (next) location.assign(next);
			else location.reload();
		} catch (error) {
			refusal = error instanceof Error ? error.message : String(error);
		} finally {
			approving = false;
		}
	}

	function onSignOut(): void {
		signOut();
		location.reload();
	}
</script>

<svelte:head><title>Connect · SG Bids</title></svelte:head>

{#await live}
	<PageState state="loading" title="Connecting to Flow PT…" />
{:then state}
	{@const editing = editingSite || state.siteUrl === ''}
	<PageHeader
		measure="narrow"
		title={state.problem ? 'Sign in to Flow PT' : 'Your Flow PT connection'}
		context={next && state.problem ? 'Sign in as yourself, then you go back to the page you opened.' : 'Who reads and writes Flow PT from this app. Nothing is written before an award.'}
	>
		{#snippet actions()}
			{#if state.problem === null}
				<Button href={next ?? '/bids'}>{next ? 'Back to the page' : 'Bids'}</Button>
			{/if}
		{/snippet}
	</PageHeader>

	<PageBody measure="narrow">
		<section class="bg-card text-card-foreground flex flex-col rounded-lg border" aria-label="Connection">
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2 p-4" data-slot="connect-site">
				<span class="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full"><Globe class="size-4" aria-hidden="true" /></span>
				<div class="flex min-w-0 flex-1 flex-col gap-0.5">
					<span class="text-muted-foreground text-xs">Site</span>
					{#if editing}
						<Input
							class="h-8 max-w-md"
							type="url"
							placeholder="https://studio.shotgrid.autodesk.com"
							bind:value={siteDraft}
							onkeydown={(event) => event.key === 'Enter' && useSite()}
							aria-label="Site URL"
						/>
					{:else}
						<span class="truncate text-sm font-medium" title={state.siteUrl}>{state.siteUrl}</span>
					{/if}
				</div>
				{#if editing}
					<Button size="sm" onclick={useSite}>Use site</Button>
					{#if state.siteUrl}
						<Button size="sm" variant="ghost" onclick={() => (editingSite = false)}>Cancel</Button>
					{/if}
				{:else}
					<Button size="sm" variant="ghost" onclick={() => ((siteDraft = state.siteUrl), (editingSite = true))}>Change site</Button>
				{/if}
			</div>

			{#if state.siteUrl && !editing}
				<div class="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-t p-4" data-slot="connect-who">
					{#if state.session}
						{#await whoAmI()}
							<span class="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full"><UserRound class="size-4" aria-hidden="true" /></span>
							<div class="flex min-w-0 flex-1 flex-col gap-0.5">
								<span class="text-muted-foreground text-xs">Signed in as</span>
								<span class="text-sm">{state.session.login}</span>
							</div>
						{:then person}
							{@const name = (person?.attributes.name as string | undefined) ?? state.session.login}
							<UserAvatar {name} image={(person?.attributes.image as string | null | undefined) ?? null} size="md" />
							<div class="flex min-w-0 flex-1 flex-col gap-0.5">
								<span class="text-muted-foreground text-xs">Signed in as</span>
								<span class="truncate text-sm font-medium">{name}</span>
							</div>
						{/await}
						<Button size="sm" variant="ghost" onclick={onSignOut}>Sign out</Button>
					{:else}
						<span class="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full"><UserRound class="size-4" aria-hidden="true" /></span>
						<div class="flex min-w-0 flex-1 flex-col gap-0.5">
							<span class="text-muted-foreground text-xs">Account</span>
							<span class="text-sm">
								{#if approving}
									Approve the request in the tab that opened.
								{:else if state.devToken}
									Reading with the dev key. Sign in to write as yourself.
								{:else}
									Not signed in. Flow PT records each write under the person who signs in.
								{/if}
							</span>
						</div>
						<Button size="sm" variant={state.devToken ? 'outline' : 'default'} onclick={() => onSignIn(state)} disabled={approving}>
							{approving ? 'Waiting for approval…' : state.devToken ? 'Sign in as yourself' : 'Sign in'}
						</Button>
					{/if}
				</div>
			{/if}
		</section>

		{#if refusal}
			<Notice tone="destructive" title="Sign-in refused.">{' '}{refusal}</Notice>
		{/if}
		{#if state.problem}
			<Notice tone="warning">{state.problem}</Notice>
		{:else}
			<p class="text-muted-foreground flex items-center gap-1.5 text-sm" data-slot="connect-ready">
				<CircleCheck class="text-success size-4" aria-hidden="true" />
				Connected.
			</p>
		{/if}
	</PageBody>
{:catch error}
	<PageState state="error" title="Could not connect to Flow PT" line={error.message}>
		{#snippet action()}<Button variant="outline" onclick={() => location.reload()}>Try again</Button>{/snippet}
	</PageState>
{/await}
