<!--
	A request's page, on a centred reading measure: its bids, who is invited to which and where each
	stands, inviting a vendor (the link shows once), revoking and making a new link, then the request
	as vendors get it. The way to the comparison is the page's primary action once an answer is in;
	before that, inviting is. A draft is finished in the send flow; a vendor added to it gets its link
	at the issue. Vendor names and Groups live on the invitations, never in the request. The menu
	beside the actions deletes the request (`$lib/app/request/delete-request`).
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Columns3 from '@lucide/svelte/icons/columns-3';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Layers from '@lucide/svelte/icons/layers';
	import DeleteRequest from '$lib/app/request/delete-request.svelte';
	import { deletedNote } from '$lib/app/request/deleted-note.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { deletedLine } from '$lib/pure/request-delete';
	import Notice from '$lib/app/notice.svelte';
	import PageBody from '$lib/app/page-body.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import Section from '$lib/app/section.svelte';
	import StatusChip from '$lib/app/status-chip.svelte';
	import LinkOnce from '$lib/app/request/link-once.svelte';
	import InviteForm from '$lib/app/request/invite-form.svelte';
	import VendorBidsDialog from '$lib/app/request/vendor-bids-dialog.svelte';
	import { IssuedRows } from '$lib/app/request/issued-rows.svelte';
	import MatchLine from '$lib/app/builder/match-line.svelte';
	import { packageStats } from '$lib/pure/packages';
	import type { InvitationView } from '$lib/api';
	import AwardPanel from '$lib/app/award/award-panel.svelte';
	import UndoNote from '$lib/app/award/undo-note.svelte';
	import VendorSheet from '$lib/app/builder/vendor-sheet.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { api, type LoadedRequest } from '$lib/api';
	import { workingProject } from '$lib/current-project';
	import { prepareLive } from '$lib/live';
	import { bidHref } from '$lib/pure/bid-list';
	import { stateLabel, vendorLink } from '$lib/pure/invitations';
	import { summarize } from '$lib/pure/request';
	import { cn } from '$lib/utils.js';

	const id = $derived(page.params.id ?? '');
	let projectId = $state<number | null>(null);
	let siteUrl = $state('');
	let loaded = $state<LoadedRequest | null>(null);
	let shown = $state<{ name: string; link: string } | null>(null);
	let busy = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	let issuedRows = $state.raw<IssuedRows | null>(null);

	async function refresh(): Promise<void> {
		loaded = await api.get(projectId!, id);
		issuedRows = loaded.status === 'issued' ? new IssuedRows(projectId!, id, loaded.request, () => void refresh()) : null;
	}

	async function load(): Promise<void> {
		const live = await prepareLive();
		if (live.problem) throw new Error(live.problem);
		siteUrl = live.siteUrl;
		const project = workingProject(live.siteUrl, page.url);
		if (!project) throw new Error('Open the request from the Requests page.');
		projectId = project.id;
		await refresh();
	}

	const ready = $derived(load());

	async function act(key: string, work: () => Promise<void>): Promise<void> {
		busy = key;
		actionError = null;
		try {
			await work();
			await refresh();
		} catch (error) {
			actionError = error instanceof Error ? error.message : String(error);
		} finally {
			busy = null;
		}
	}

	function invited(name: string, token: string | null): void {
		if (token) shown = { name, link: vendorLink(location.origin, token) };
		void refresh();
	}

	const reissue = (invitationId: string, name: string) =>
		act(`reissue:${invitationId}`, async () => {
			const { token } = await api.reissue(projectId!, invitationId);
			shown = { name, link: vendorLink(location.origin, token) };
		});

	const revoke = (invitationId: string) => act(`revoke:${invitationId}`, () => api.revoke(projectId!, invitationId).then(() => undefined));
	const uninvite = (invitationId: string) => act(`uninvite:${invitationId}`, () => api.uninvite(projectId!, invitationId).then(() => undefined));

	async function newRound(): Promise<void> {
		await act('round', async () => {
			const { request } = await api.newRound(projectId!, id);
			await goto(`/requests/new?id=${request.id}&project=${projectId}`);
		});
	}

	let deleteOpen = $state(false);

	// A vendor's bids: changed until it submits an answer.
	let editing = $state<InvitationView | null>(null);
	let editingOpen = $state(false);
	let bidsError = $state<string | null>(null);
	let savingBids = $state(false);

	function editBids(inv: InvitationView): void {
		editing = inv;
		bidsError = null;
		editingOpen = true;
	}

	async function saveBids(next: string[] | null): Promise<void> {
		if (!editing) return;
		savingBids = true;
		bidsError = null;
		try {
			await api.invitePackages(projectId!, editing.vendor.id, next);
			await refresh();
			editingOpen = false;
		} catch (error) {
			bidsError = error instanceof Error ? error.message : String(error);
		} finally {
			savingBids = false;
		}
	}

	/** Why a vendor's bids are fixed, or null. */
	function lockedWhy(inv: InvitationView): string | null {
		if (inv.state.kind === 'submitted' || inv.state.kind === 'withdrawn') return `${inv.vendor.name} has submitted an answer. Its bids are fixed: an answer is for the bids it was made for.`;
		if (loaded && loaded.status !== 'draft' && loaded.status !== 'issued') return 'The request no longer takes answers.';
		return null;
	}

	function bidsLabel(inv: InvitationView, names: ReadonlyMap<string, string>): string {
		if (!inv.vendor.packages) return 'Every bid';
		const known = inv.vendor.packages.filter((p) => names.has(p));
		if (known.length === 0) return 'No bid';
		return known.length <= 2 ? known.map((p) => names.get(p)).join(', ') : `${known.length} of ${names.size} bids`;
	}

	const time = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	const day = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	const number = new Intl.NumberFormat();
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	const TONE: Record<string, string> = {
		pending: 'bg-muted-foreground',
		not_opened: 'bg-muted-foreground',
		opened: 'bg-info',
		submitted: 'bg-success',
		withdrawn: 'bg-warning',
		revoked: 'bg-destructive',
		expired: 'bg-destructive'
	};
	const TH = 'text-muted-foreground border-border h-9 border-b px-3 text-left text-xs font-medium whitespace-nowrap';
	const TD = 'border-border border-b px-3 py-2.5';
</script>

<svelte:head><title>{loaded?.request.header.title ?? 'Request'} · SG Bids</title></svelte:head>

{#await ready}
	<PageState state="loading" title="Opening the request…" />
{:then}
	{#if loaded}
		{@const r = loaded.request}
		{@const counts = summarize(r)}
		{@const submitted = loaded.invitations.filter((inv) => inv.state.kind === 'submitted').length}
		{@const comparing = loaded.status !== 'draft' && submitted > 0}
		{@const packages = r.packages ?? []}
		{@const stats = packageStats(r)}
		{@const names = new Map(packages.map((p) => [p.id, p.name]))}
		<PageHeader measure="wide" title={r.header.title ?? 'Untitled request'} back={{ href: '/requests', label: 'Requests' }}>
			{#snippet context()}
				<StatusChip status={loaded!.status} />
				<span class="text-foreground">{r.header.project}</span>
				<span class="text-foreground font-mono text-xs">{r.header.code}</span>
				<span>Round {r.header.round}</span>
				<span class="tabular-nums">{plural(packages.length || 1, 'bid')}, {plural(counts.shots, 'shot')}, {plural(counts.assets, 'asset')}</span>
			{/snippet}
			{#snippet actions()}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger class="hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2" aria-label="More for this request" data-slot="request-more">
						<Ellipsis class="size-4" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end">
						<DropdownMenu.Item class="text-destructive" onSelect={() => (deleteOpen = true)} data-slot="request-delete">{loaded!.status === 'draft' ? 'Delete draft…' : 'Delete request…'}</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				{#if loaded!.status === 'draft'}
					<Button href={`/requests/new?id=${r.id}&project=${projectId}`} data-slot="edit-draft">Finish the draft</Button>
				{:else}
					<Button variant="outline" onclick={() => void newRound()} disabled={busy === 'round'} data-slot="new-round">{busy === 'round' ? 'Starting…' : 'New round'}</Button>
					<Button href={`/requests/${r.id}/compare`} variant={comparing ? 'default' : 'outline'} data-slot="open-comparison">
						<Columns3 data-icon="inline-start" />Compare {submitted === 0 ? 'the answers' : plural(submitted, 'answer')}
					</Button>
				{/if}
			{/snippet}
			{#if loaded.status === 'draft'}
				<Notice tone="info">This request is a draft. Its bids are read as they are now; issuing copies them. A vendor added now gets its link at the issue.</Notice>
			{/if}
			{#if actionError}<Notice tone="destructive">{actionError}</Notice>{/if}
		</PageHeader>

		<PageBody measure="wide" class="gap-10">
			{#if shown}
				<LinkOnce name={shown.name} link={shown.link} onDone={() => (shown = null)} />
			{/if}

			<UndoNote requestId={r.id} />
			{#if loaded.award}
				<AwardPanel projectId={projectId!} request={r} publication={loaded.award} {siteUrl} onChange={() => void refresh()} />
			{/if}

			<Section title="Bids" meta={loaded.status === 'draft' ? 'As they are now' : 'As issued'}>
				<ul class="flex flex-col rounded-lg border" data-slot="request-bids">
					{#each packages.length > 0 ? packages : [{ id: 'all', name: 'All shots and assets' }] as p (p.id)}
						{@const s = stats.get(p.id)}
						<li class="border-border flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2.5 text-sm last:border-b-0">
							<Layers class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
							<span class="min-w-0 flex-1 truncate font-medium">{p.name}</span>
							{#if s}<span class="text-muted-foreground tabular-nums">{plural(s.shots, 'shot')}, {number.format(s.frames)} frames, {plural(s.assets, 'asset')}{s.omitted > 0 ? `, ${s.omitted} omitted` : ''}</span>{/if}
							{#if 'bid' in p && p.bid}
								<a class="text-muted-foreground hover:text-foreground text-xs underline decoration-current/30 underline-offset-2" href={bidHref({ id: p.bid, projectId: projectId! })}>Open the bid</a>
							{/if}
						</li>
					{/each}
				</ul>
				{#if loaded.overlaps.length > 0}
					<Notice tone="destructive" title="A row is in two bids.">{' '}{loaded.overlaps[0].code} is in {loaded.overlaps[0].bids[0]} and in {loaded.overlaps[0].bids[1]}. A request takes each row once.</Notice>
				{/if}
			</Section>

			<Section title="Vendors" meta={`${loaded.invitations.length} invited, ${plural(submitted, 'answer')} in`}>
				{#if loaded.status === 'draft' || loaded.status === 'issued'}
					<InviteForm projectId={projectId!} requestId={r.id} onInvited={invited} primary={!comparing} pending={loaded.status === 'draft'} {packages} {stats} />
				{/if}
				{#if loaded.invitations.length === 0}
					<p class="text-muted-foreground text-sm">Nobody is invited yet.</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full min-w-[40rem] border-separate border-spacing-0 text-sm" data-slot="invitations">
							<thead>
								<tr>
									<th class={cn(TH, 'pl-0')}>Vendor</th>
									{#if packages.length > 1}<th class={TH}>Bids</th>{/if}
									<th class={TH}>Where it stands</th>
									<th class={TH}>Link works until</th>
									<th class={cn(TH, 'pr-0 text-right')}><span class="sr-only">Actions</span></th>
								</tr>
							</thead>
							<tbody>
								{#each loaded.invitations as inv (inv.vendor.id)}
									{@const s = inv.state}
									{@const dead = s.kind === 'revoked' || s.kind === 'expired'}
									<tr class="group" data-state={s.kind}>
										<td class={cn(TD, 'pl-0')}>
											<div class="flex min-w-0 flex-col">
												<span class="truncate font-medium">{inv.vendor.name}</span>
												<span class="text-muted-foreground truncate text-xs">{inv.vendor.email}{inv.vendor.fpt ? ', linked to a Flow PT Group' : ''}</span>
											</div>
										</td>
										{#if packages.length > 1}
											{@const why = lockedWhy(inv)}
											<td class={TD} data-slot="invitation-packages">
												<button
													type="button"
													class="hover:text-foreground text-muted-foreground inline-flex max-w-64 items-center gap-1.5 text-left underline-offset-2 hover:underline disabled:no-underline"
													onclick={() => editBids(inv)}
													title={why ?? 'Change the bids'}
												>
													<Layers class="size-3.5 shrink-0" aria-hidden="true" />
													<span class="text-foreground truncate">{bidsLabel(inv, names)}</span>
												</button>
											</td>
										{/if}
										<td class={TD}>
											<span class="inline-flex flex-wrap items-center gap-x-2">
												<span class={cn('size-1.5 rounded-full', TONE[s.kind])} aria-hidden="true"></span>
												{stateLabel(s)}
												{#if 'at' in s && s.at}<span class="text-muted-foreground text-xs tabular-nums">{time.format(new Date(s.at))}</span>{/if}
											</span>
										</td>
										<td class={cn(TD, 'text-muted-foreground tabular-nums')}>{dead || s.kind === 'pending' ? '' : day.format(new Date(inv.expiresAt))}</td>
										<td class={cn(TD, 'pr-0 text-right whitespace-nowrap')}>
											{#if s.kind === 'pending'}
												<Button size="sm" variant="ghost" class="hover:text-destructive" onclick={() => void uninvite(inv.vendor.id)} disabled={busy !== null}>
													{busy === `uninvite:${inv.vendor.id}` ? 'Removing…' : 'Remove'}
												</Button>
											{:else}
												{#if loaded.status !== 'closed'}
													<Button size="sm" variant="ghost" onclick={() => void reissue(inv.vendor.id, inv.vendor.name)} disabled={busy !== null}>
														{busy === `reissue:${inv.vendor.id}` ? 'Making…' : 'New link'}
													</Button>
												{/if}
												{#if !dead}
													<Button size="sm" variant="ghost" class="hover:text-destructive" onclick={() => void revoke(inv.vendor.id)} disabled={busy !== null}>
														{busy === `revoke:${inv.vendor.id}` ? 'Revoking…' : 'Revoke'}
													</Button>
												{/if}
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<p class="text-muted-foreground text-xs">A vendor's answer shows as opened until they submit it. Drafts stay theirs.</p>
				{/if}
			</Section>

			<Section title="The request as vendors get it">
				{#if issuedRows}<MatchLine builder={issuedRows} />{/if}
				<VendorSheet request={r} />
			</Section>
		</PageBody>

		{#if editing}
			<VendorBidsDialog
				bind:open={editingOpen}
				vendor={editing.vendor.name}
				{packages}
				{stats}
				value={editing.vendor.packages ?? null}
				locked={lockedWhy(editing)}
				busy={savingBids}
				error={bidsError}
				onSave={(next) => void saveBids(next)}
			/>
		{/if}

		<DeleteRequest
			bind:open={deleteOpen}
			projectId={projectId!}
			requestId={r.id}
			ondeleted={(gone) => {
				deletedNote.line = deletedLine(gone);
				void goto('/requests');
			}}
		/>
	{/if}
{:catch error}
	<PageState state="error" title="Could not open the request" line={error.message}>
		{#snippet action()}<Button href="/requests">Requests</Button>{/snippet}
	</PageState>
{/await}
