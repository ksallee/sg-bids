<!--
	A request's page: who is invited and where each stands, inviting a vendor (the link shows once),
	revoking and making a new link, the way to the comparison, then the request as vendors get it.
	Vendor names and Groups live on the invitations, never in the request.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Columns3 from '@lucide/svelte/icons/columns-3';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import Section from '$lib/app/section.svelte';
	import StatusChip from '$lib/app/status-chip.svelte';
	import LinkOnce from '$lib/app/request/link-once.svelte';
	import InviteForm from '$lib/app/request/invite-form.svelte';
	import VendorSheet from '$lib/app/builder/vendor-sheet.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { api, type LoadedRequest } from '$lib/api';
	import { currentProject } from '$lib/current-project';
	import { prepareLive } from '$lib/live';
	import { stateLabel, vendorLink } from '$lib/pure/invitations';
	import { summarize } from '$lib/pure/request';
	import { cn } from '$lib/utils.js';

	const id = $derived(page.params.id ?? '');
	let projectId = $state<number | null>(null);
	let loaded = $state<LoadedRequest | null>(null);
	let problem = $state<string | null>(null);
	let shown = $state<{ name: string; link: string } | null>(null);
	let busy = $state<string | null>(null);
	let actionError = $state<string | null>(null);

	async function load(): Promise<void> {
		const live = await prepareLive();
		if (live.problem) throw new Error(live.problem);
		const project = currentProject(live.siteUrl);
		if (!project) throw new Error('Pick the project on the requests list first.');
		projectId = project.id;
		loaded = await api.get(project.id, id);
	}

	const ready = $derived(load());

	async function act(key: string, work: () => Promise<void>): Promise<void> {
		busy = key;
		actionError = null;
		try {
			await work();
			loaded = await api.get(projectId!, id);
		} catch (error) {
			actionError = error instanceof Error ? error.message : String(error);
		} finally {
			busy = null;
		}
	}

	function invited(name: string, token: string): void {
		shown = { name, link: vendorLink(location.origin, token) };
		void api.get(projectId!, id).then((next) => (loaded = next));
	}

	const reissue = (invitationId: string, name: string) =>
		act(`reissue:${invitationId}`, async () => {
			const { token } = await api.reissue(projectId!, invitationId);
			shown = { name, link: vendorLink(location.origin, token) };
		});

	const revoke = (invitationId: string) => act(`revoke:${invitationId}`, () => api.revoke(projectId!, invitationId).then(() => undefined));

	async function newRound(): Promise<void> {
		await act('round', async () => {
			const { request } = await api.newRound(projectId!, id);
			await goto(`/bids/new?id=${request.id}&step=details`);
		});
	}

	const time = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	const day = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	const TONE: Record<string, string> = {
		not_opened: 'bg-muted-foreground',
		opened: 'bg-info',
		submitted: 'bg-success',
		withdrawn: 'bg-warning',
		revoked: 'bg-destructive',
		expired: 'bg-destructive'
	};
</script>

<svelte:head><title>Request · SG Bids</title></svelte:head>

{#await ready}
	<PageState state="loading" title="Opening the request…" />
{:then}
	{#if loaded}
		{@const r = loaded.request}
		{@const counts = summarize(r)}
		{@const submitted = loaded.invitations.filter((inv) => inv.state.kind === 'submitted').length}
		<PageHeader title={r.header.title ?? 'Untitled request'}>
			{#snippet context()}
				<StatusChip status={loaded!.status} />
				<span class="text-foreground">{r.header.project}</span>
				<span aria-hidden="true">·</span><span class="font-mono text-xs">{r.header.code}</span>
				<span aria-hidden="true">·</span><span>Round {r.header.round}</span>
				<span aria-hidden="true">·</span><span>{counts.shots} shots, {counts.assets} assets</span>
			{/snippet}
			{#snippet actions()}
				<Button variant="outline" href="/bids">Requests</Button>
				{#if loaded!.status === 'draft'}
					<Button href={`/bids/new?id=${r.id}&step=review`}>Edit the draft</Button>
				{:else}
					<Button onclick={() => void newRound()} disabled={busy === 'round'}>{busy === 'round' ? 'Starting…' : 'New round'}</Button>
				{/if}
			{/snippet}
			{#if loaded.status === 'draft'}
				<Notice tone="info">This request is a draft. Vendors you invite can open their link once it is issued.</Notice>
			{/if}
			{#if actionError}<Notice tone="destructive">{actionError}</Notice>{/if}
		</PageHeader>

		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<div class="flex w-full max-w-6xl flex-col gap-8 px-6 py-6">
				{#if shown}
					<LinkOnce name={shown.name} link={shown.link} onDone={() => (shown = null)} />
				{/if}

				<Section title="Vendors" meta={`${loaded.invitations.length} invited`}>
					{#if loaded.status !== 'closed'}
						<InviteForm projectId={projectId!} requestId={r.id} onInvited={invited} />
					{/if}
					{#if loaded.invitations.length === 0}
						<p class="text-muted-foreground text-sm">Nobody is invited yet.</p>
					{:else}
						<table class="w-full text-sm" data-slot="invitations">
							<thead>
								<tr class="text-muted-foreground border-border border-b text-left text-xs">
									<th class="py-2 pr-3 font-medium">Vendor</th>
									<th class="px-3 py-2 font-medium">Where it stands</th>
									<th class="px-3 py-2 font-medium">Link works until</th>
									<th class="py-2 pl-3 text-right font-medium"><span class="sr-only">Actions</span></th>
								</tr>
							</thead>
							<tbody>
								{#each loaded.invitations as inv (inv.vendor.id)}
									{@const s = inv.state}
									{@const dead = s.kind === 'revoked' || s.kind === 'expired'}
									<tr class="border-border border-b" data-state={s.kind}>
										<td class="py-2.5 pr-3">
											<div class="flex flex-col">
												<span class="font-medium">{inv.vendor.name}</span>
												<span class="text-muted-foreground text-xs">{inv.vendor.email}{inv.vendor.fpt ? ', linked to a Flow PT Group' : ''}</span>
											</div>
										</td>
										<td class="px-3 py-2.5">
											<span class="inline-flex items-center gap-2">
												<span class={cn('size-1.5 rounded-full', TONE[s.kind])} aria-hidden="true"></span>
												{stateLabel(s)}
												{#if 'at' in s && s.at}<span class="text-muted-foreground text-xs">{time.format(new Date(s.at))}</span>{/if}
											</span>
										</td>
										<td class="text-muted-foreground px-3 py-2.5">{dead ? '' : day.format(new Date(inv.expiresAt))}</td>
										<td class="py-2.5 pl-3 text-right whitespace-nowrap">
											{#if loaded.status !== 'closed'}
												<Button size="sm" variant="outline" onclick={() => void reissue(inv.vendor.id, inv.vendor.name)} disabled={busy !== null}>
													{busy === `reissue:${inv.vendor.id}` ? 'Making…' : 'New link'}
												</Button>
											{/if}
											{#if !dead}
												<Button size="sm" variant="ghost" onclick={() => void revoke(inv.vendor.id)} disabled={busy !== null}>
													{busy === `revoke:${inv.vendor.id}` ? 'Revoking…' : 'Revoke'}
												</Button>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
						<p class="text-muted-foreground text-xs">A vendor's bid shows as opened until they submit it. Drafts stay theirs.</p>
					{/if}
				</Section>

				<Section title="Comparison" meta={`${submitted} of ${loaded.invitations.length} bids in`} data-slot="comparison">
					<div class="bg-card flex flex-wrap items-center gap-4 rounded-lg border p-4">
						<Columns3 class="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
						<div class="flex min-w-0 flex-1 flex-col gap-0.5">
							<p class="text-sm font-medium">{submitted === 0 ? 'No bid in yet' : 'The bids side by side'}</p>
							<p class="text-muted-foreground text-xs">
								{submitted === 0
									? 'Once a vendor submits, its prices show here shot by shot. Drafts stay theirs.'
									: 'Shot by shot in your base currency, with the rates you set, the totals and rebate estimates, and award scenarios.'}
							</p>
						</div>
						<Button href={`/bids/${r.id}/compare`} variant={submitted === 0 ? 'outline' : 'default'} disabled={loaded.status === 'draft'}>Open the comparison</Button>
					</div>
				</Section>

				<Section title="The request as vendors get it">
					<VendorSheet request={r} />
				</Section>
			</div>
		</div>
	{/if}
{:catch error}
	<PageState state="error" title="Could not open the request" line={error.message}>
		{#snippet action()}<Button href="/bids">Requests</Button>{/snippet}
	</PageState>
{/await}
