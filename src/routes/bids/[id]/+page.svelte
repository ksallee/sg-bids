<!--
	A request's page, on a centred reading measure: who is invited and where each stands, inviting a
	vendor (the link shows once), revoking and making a new link, then the request as vendors get it.
	The way to the comparison is the page's primary action once a bid is in; before that, inviting
	is. Vendor names and Groups live on the invitations, never in the request. The menu beside the
	actions deletes the request (`$lib/app/request/delete-request`).
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Columns3 from '@lucide/svelte/icons/columns-3';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
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
	import PackagesDialog from '$lib/app/request/packages-dialog.svelte';
	import Package from '@lucide/svelte/icons/package';
	import { packageStats } from '$lib/pure/packages';
	import type { InvitationView } from '$lib/api';
	import AwardPanel from '$lib/app/award/award-panel.svelte';
	import UndoNote from '$lib/app/award/undo-note.svelte';
	import VendorSheet from '$lib/app/builder/vendor-sheet.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { api, type LoadedRequest } from '$lib/api';
	import { workingProject } from '$lib/current-project';
	import { prepareLive } from '$lib/live';
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

	async function load(): Promise<void> {
		const live = await prepareLive();
		if (live.problem) throw new Error(live.problem);
		siteUrl = live.siteUrl;
		const project = workingProject(live.siteUrl, page.url);
		if (!project) throw new Error('Open the request from the requests list.');
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
			await goto(`/bids/new?id=${request.id}`);
		});
	}

	let deleteOpen = $state(false);

	// A vendor's packages: changed until it submits a bid.
	let editing = $state<InvitationView | null>(null);
	let editingOpen = $state(false);
	let packageError = $state<string | null>(null);
	let savingPackages = $state(false);

	function editPackages(inv: InvitationView): void {
		editing = inv;
		packageError = null;
		editingOpen = true;
	}

	async function savePackages(next: string[] | null): Promise<void> {
		if (!editing) return;
		savingPackages = true;
		packageError = null;
		try {
			await api.invitePackages(projectId!, editing.vendor.id, next);
			loaded = await api.get(projectId!, id);
			editingOpen = false;
		} catch (error) {
			packageError = error instanceof Error ? error.message : String(error);
		} finally {
			savingPackages = false;
		}
	}

	/** Why a vendor's packages are fixed, or null. */
	function lockedWhy(inv: InvitationView): string | null {
		if (inv.state.kind === 'submitted' || inv.state.kind === 'withdrawn') return `${inv.vendor.name} has submitted a bid. Its packages are fixed: a bid answers the packages it was made for.`;
		if (loaded && loaded.status !== 'draft' && loaded.status !== 'issued') return 'The request no longer takes bids.';
		return null;
	}

	function packagesLabel(inv: InvitationView, names: ReadonlyMap<string, string>): string {
		if (!inv.vendor.packages) return 'Every package';
		const known = inv.vendor.packages.filter((p) => names.has(p));
		if (known.length === 0) return 'No package';
		return known.length <= 2 ? known.map((p) => names.get(p)).join(', ') : `${known.length} of ${names.size} packages`;
	}

	const time = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	const day = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	const TONE: Record<string, string> = {
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
		<PageHeader measure="wide" title={r.header.title ?? 'Untitled request'} back={{ href: '/bids', label: 'Bid requests' }}>
			{#snippet context()}
				<StatusChip status={loaded!.status} />
				<span class="text-foreground">{r.header.project}</span>
				<span class="text-foreground font-mono text-xs">{r.header.code}</span>
				<span>Round {r.header.round}</span>
				<span class="tabular-nums">{plural(counts.shots, 'shot')}, {plural(counts.assets, 'asset')}</span>
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
					<Button href={`/bids/new?id=${r.id}`}>Edit the draft</Button>
				{:else}
					<Button variant="outline" onclick={() => void newRound()} disabled={busy === 'round'}>{busy === 'round' ? 'Starting…' : 'New round'}</Button>
					<Button href={`/bids/${r.id}/compare`} variant={comparing ? 'default' : 'outline'} data-slot="open-comparison">
						<Columns3 data-icon="inline-start" />Compare {submitted === 0 ? 'the bids' : plural(submitted, 'bid')}
					</Button>
				{/if}
			{/snippet}
			{#if loaded.status === 'draft'}
				<Notice tone="info">This request is a draft. Vendors you invite can open their link once it is issued.</Notice>
			{/if}
			{#if actionError}<Notice tone="destructive">{actionError}</Notice>{/if}
		</PageHeader>

		<PageBody measure="wide" class="gap-10">
			{#if shown}
				<LinkOnce name={shown.name} link={shown.link} onDone={() => (shown = null)} />
			{/if}

			<UndoNote requestId={r.id} />
			{#if loaded.award}
				<AwardPanel projectId={projectId!} request={r} publication={loaded.award} {siteUrl} onChange={() => void api.get(projectId!, id).then((next) => (loaded = next))} />
			{/if}

			<Section title="Vendors" meta={`${loaded.invitations.length} invited, ${submitted} ${submitted === 1 ? 'bid' : 'bids'} in`}>
				{#if loaded.status === 'draft' || loaded.status === 'issued'}
					<InviteForm projectId={projectId!} requestId={r.id} onInvited={invited} primary={!comparing} {packages} {stats} />
				{/if}
				{#if loaded.invitations.length === 0}
					<p class="text-muted-foreground text-sm">Nobody is invited yet.</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full min-w-[40rem] border-separate border-spacing-0 text-sm" data-slot="invitations">
							<thead>
								<tr>
									<th class={cn(TH, 'pl-0')}>Vendor</th>
									{#if packages.length > 0}<th class={TH}>Packages</th>{/if}
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
										{#if packages.length > 0}
											{@const why = lockedWhy(inv)}
											<td class={TD} data-slot="invitation-packages">
												<button
													type="button"
													class="hover:text-foreground text-muted-foreground inline-flex max-w-64 items-center gap-1.5 text-left underline-offset-2 hover:underline disabled:no-underline"
													onclick={() => editPackages(inv)}
													title={why ?? 'Change the packages'}
												>
													<Package class="size-3.5 shrink-0" aria-hidden="true" />
													<span class="text-foreground truncate">{packagesLabel(inv, names)}</span>
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
										<td class={cn(TD, 'text-muted-foreground tabular-nums')}>{dead ? '' : day.format(new Date(inv.expiresAt))}</td>
										<td class={cn(TD, 'pr-0 text-right whitespace-nowrap')}>
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
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<p class="text-muted-foreground text-xs">A vendor's bid shows as opened until they submit it. Drafts stay theirs.</p>
				{/if}
			</Section>

			<Section title="The request as vendors get it">
				<VendorSheet request={r} />
			</Section>
		</PageBody>

		{#if editing}
			<PackagesDialog
				bind:open={editingOpen}
				vendor={editing.vendor.name}
				{packages}
				{stats}
				value={editing.vendor.packages ?? null}
				locked={lockedWhy(editing)}
				busy={savingPackages}
				error={packageError}
				onSave={(next) => void savePackages(next)}
			/>
		{/if}

		<DeleteRequest
			bind:open={deleteOpen}
			projectId={projectId!}
			requestId={r.id}
			ondeleted={(gone) => {
				deletedNote.line = deletedLine(gone);
				void goto('/bids');
			}}
		/>
	{/if}
{:catch error}
	<PageState state="error" title="Could not open the request" line={error.message}>
		{#snippet action()}<Button href="/bids">Bid requests</Button>{/snippet}
	</PageState>
{/await}
