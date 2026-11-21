<!--
	An issued request, on the same page a draft was built on. First its vendors, one row each with
	where it stands and its link: right after the issue every link is there with Copy, Copy all and
	Email, shown once (`vendor-links`). Nothing else to fill. Then the award when there is one, and the
	request as vendors get it. Compare is the primary action once an answer is in. The menu duplicates
	the request, starts its next round, or deletes it. A late vendor is invited from here too.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Columns3 from '@lucide/svelte/icons/columns-3';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import DeleteRequest from '$lib/app/request/delete-request.svelte';
	import DuplicateRequest from '$lib/app/request/duplicate-request.svelte';
	import { deletedNote } from '$lib/app/request/deleted-note.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import Notice from '$lib/app/notice.svelte';
	import PageBody from '$lib/app/page-body.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import Section from '$lib/app/section.svelte';
	import StatusChip from '$lib/app/status-chip.svelte';
	import SetupNotice from '$lib/app/setup-notice.svelte';
	import InviteForm from './invite-form.svelte';
	import VendorBids from './vendor-bids.svelte';
	import VendorLinks from './vendor-links.svelte';
	import { IssuedRows } from './issued-rows.svelte';
	import MatchLine from '$lib/app/builder/match-line.svelte';
	import VendorSheet from '$lib/app/builder/vendor-sheet.svelte';
	import AwardPanel from '$lib/app/award/award-panel.svelte';
	import UndoNote from '$lib/app/award/undo-note.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { api, type InvitationView, type LoadedRequest } from '$lib/api';
	import { vendorLink } from '$lib/pure/invitations';
	import { requestName, deletedLine } from '$lib/pure/request-delete';
	import { requestHref } from '$lib/pure/routes';
	import { summarize } from '$lib/pure/request';

	let {
		loaded,
		projectId,
		siteUrl,
		links = new Map(),
		justIssued = false,
		onRefresh
	}: {
		loaded: LoadedRequest;
		projectId: number;
		siteUrl: string;
		/** The links made on this page, by invitation id: at the issue, or with New link. */
		links?: ReadonlyMap<string, string>;
		justIssued?: boolean;
		onRefresh: () => Promise<void>;
	} = $props();

	let busy = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	let made = $state<ReadonlyMap<string, string>>(new Map());
	let inviting = $state(false);
	let deleteOpen = $state(false);
	let duplicateOpen = $state(false);
	const shownLinks = $derived(new Map([...links, ...made]));
	const issuedRows = $derived(loaded.status === 'issued' ? new IssuedRows(projectId, loaded.request.id, loaded.request, () => void onRefresh()) : null);

	async function act(key: string, work: () => Promise<void>): Promise<void> {
		busy = key;
		actionError = null;
		try {
			await work();
			await onRefresh();
		} catch (error) {
			actionError = error instanceof Error ? error.message : String(error);
		} finally {
			busy = null;
		}
	}

	const newLink = (inv: InvitationView) =>
		act(`reissue:${inv.vendor.id}`, async () => {
			const { token } = await api.reissue(projectId, inv.vendor.id);
			made = new Map([...made, [inv.vendor.id, vendorLink(location.origin, token)]]);
		});
	const revoke = (inv: InvitationView) => act(`revoke:${inv.vendor.id}`, () => api.revoke(projectId, inv.vendor.id).then(() => undefined));

	async function newRound(): Promise<void> {
		await act('round', async () => {
			const { request } = await api.newRound(projectId, loaded.request.id);
			await goto(requestHref({ id: request.id, projectId }));
		});
	}

	// A vendor's bids: changed until it submits an answer.
	let editing = $state<InvitationView | null>(null);
	let editingOpen = $state(false);
	let bidsError = $state<string | null>(null);
	let savingBids = $state(false);
	async function saveBids(next: string[] | null): Promise<void> {
		if (!editing) return;
		savingBids = true;
		bidsError = null;
		try {
			await api.invitePackages(projectId, editing.vendor.id, next);
			await onRefresh();
			editingOpen = false;
		} catch (error) {
			bidsError = error instanceof Error ? error.message : String(error);
		} finally {
			savingBids = false;
		}
	}

	const r = $derived(loaded.request);
	const name = $derived(requestName({ code: r.header.code ?? '', title: r.header.title }));
	const counts = $derived(summarize(r));
	const packages = $derived(r.packages ?? []);
	const submitted = $derived(loaded.invitations.filter((inv) => inv.state.kind === 'submitted').length);
	const open = $derived(loaded.status === 'issued');
	const dayFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
	const due = $derived(r.header.dueDate ? dayFormat.format(new Date(`${r.header.dueDate}T00:00:00Z`)) : null);
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
</script>

<svelte:head><title>{name} · SG Bids</title></svelte:head>

<PageHeader measure="full" title={name} back={{ href: '/requests', label: 'Requests' }}>
	{#snippet context()}
		<StatusChip status={loaded.status} />
		<span class="text-foreground">{r.header.project}</span>
		{#if r.header.round > 1}<span>Round {r.header.round}</span>{/if}
		<span class="tabular-nums">{plural(packages.length || 1, 'bid')}, {plural(counts.shots, 'shot')}{counts.assets > 0 ? `, ${plural(counts.assets, 'asset')}` : ''}</span>
		{#if due}<span>Answers due {due}</span>{/if}
	{/snippet}
	{#snippet actions()}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger class="hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2" aria-label="More for this request" data-slot="request-more">
				<Ellipsis class="size-4" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				<DropdownMenu.Item onSelect={() => (duplicateOpen = true)} data-slot="request-duplicate">Duplicate…</DropdownMenu.Item>
				<DropdownMenu.Item onSelect={() => void newRound()} disabled={busy === 'round'} data-slot="new-round">Start the next round</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item class="text-destructive" onSelect={() => (deleteOpen = true)} data-slot="request-delete">Delete request…</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<Button href={`/requests/${r.id}/compare?project=${projectId}`} variant={submitted > 0 ? 'default' : 'outline'} data-slot="open-comparison">
			<Columns3 data-icon="inline-start" />{submitted === 0 ? 'Compare answers' : `Compare ${plural(submitted, 'answer')}`}
		</Button>
	{/snippet}
	{#if justIssued}
		<p class="flex items-center gap-2 text-sm" data-slot="issued-note"><CircleCheck class="text-success size-4" aria-hidden="true" />Issued. Send each vendor its link below. Nothing else to fill.</p>
	{/if}
	{#if actionError}<Notice tone="destructive">{actionError}</Notice>{/if}
</PageHeader>
<SetupNotice />

<PageBody measure="full" class="gap-10">
	<UndoNote requestId={r.id} />
	{#if loaded.award}
		<AwardPanel {projectId} request={r} publication={loaded.award} {siteUrl} onChange={() => void onRefresh()} />
	{/if}

	<Section title="Vendors" meta={`${loaded.invitations.length} invited, ${plural(submitted, 'answer')} in`}>
		{#snippet actions()}
			{#if open && !inviting}<Button size="sm" variant="outline" onclick={() => (inviting = true)} data-slot="invite-late"><UserPlus data-icon="inline-start" />Invite another vendor</Button>{/if}
		{/snippet}
		{#if inviting && open}
			<InviteForm
				{projectId}
				requestId={r.id}
				{packages}
				onInvited={(_, token, id) => {
					if (token && id) made = new Map([...made, [id, vendorLink(location.origin, token)]]);
					inviting = false;
					void onRefresh();
				}}
				onCancel={() => (inviting = false)}
			/>
		{/if}
		{#if loaded.invitations.length === 0}
			<p class="text-muted-foreground text-sm">Nobody is invited yet.</p>
		{:else}
			<VendorLinks
				invitations={loaded.invitations}
				{packages}
				links={shownLinks}
				request={name}
				project={r.header.project}
				{due}
				{busy}
				closed={!open && loaded.status !== 'awarded'}
				onNewLink={(inv) => void newLink(inv)}
				onRevoke={(inv) => void revoke(inv)}
				onBids={open ? (inv) => ((editing = inv), (bidsError = null), (editingOpen = true)) : undefined}
			/>
		{/if}
	</Section>

	<Section title="The request as vendors get it">
		{#if issuedRows}<MatchLine builder={issuedRows} />{/if}
		<VendorSheet request={r} />
	</Section>
</PageBody>

{#if editing}
	<VendorBids bind:open={editingOpen} vendor={editing.vendor.name} {packages} value={editing.vendor.packages ?? null} busy={savingBids} error={bidsError} onSave={(next) => void saveBids(next)} />
{/if}
<DuplicateRequest bind:open={duplicateOpen} {projectId} requestId={r.id} name={r.header.title ?? ''} />
<DeleteRequest
	bind:open={deleteOpen}
	{projectId}
	requestId={r.id}
	ondeleted={(gone) => {
		deletedNote.line = deletedLine(gone);
		void goto('/requests');
	}}
/>
