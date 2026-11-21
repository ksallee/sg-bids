<!--
	A bid, on one working page, full width. The project is picked once. The name is the page's title,
	typed in place. The Shots and Assets table is the work: it takes the rest of the width and the
	height. The bid is stored as it changes, once it has a name or a row, and is always editable: a
	request copies its rows when it is issued. The context line says the requests it went out in. Send
	in a request starts the send flow with this bid; the menu clones or deletes it. A bid's rows are
	live: editing a column fed by Flow PT writes Flow PT as the signed in person (`request-table`).
	An address that names a request, from before bids came first, goes to the request's page.
-->
<script lang="ts">
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Send from '@lucide/svelte/icons/send';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import Notice from '$lib/app/notice.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import StatusChip from '$lib/app/status-chip.svelte';
	import FieldsDialog from '$lib/app/builder/fields-dialog.svelte';
	import ItemsPanel from '$lib/app/builder/items-panel.svelte';
	import ProjectGate from '$lib/app/builder/project-gate.svelte';
	import SaveLine from '$lib/app/builder/save-line.svelte';
	import EditToast, { type Toast } from '$lib/app/builder/edit-toast.svelte';
	import DeleteBid from './delete-bid.svelte';
	import SendRowsDialog from './send-rows-dialog.svelte';
	import { Builder } from '$lib/app/builder.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { api, ApiError, bidsApi, type BidOverview } from '$lib/api';
	import { workingProject } from '$lib/current-project';
	import { liveState } from '$lib/live';
	import { bidHref, newRequestHref } from '$lib/pure/bid-list';
	import type { ItemKind } from '$lib/pure/field-map';
	import { mappingWords } from '$lib/pure/field-map';
	import type { Target } from '$lib/pure/model';
	import { MAX_BID_NAME, UNTITLED_BID } from '$lib/pure/production-bid';
	import { wentOutIn } from '$lib/pure/request-bids';
	import { movedRequestPath, requestHref } from '$lib/pure/routes';

	let { bidId }: { bidId: string | null } = $props();

	function open(id: string | null): Builder {
		const next = new Builder(id);
		next.onStored = (stored) => {
			const project = untrack(() => next.state.project);
			// The address names the stored bid, with no navigation: the page and its open dialogs stay as they are.
			replaceState(project ? bidHref({ id: stored, projectId: project.id }) : `/bids/${stored}`, {});
		};
		return next;
	}

	// svelte-ignore state_referenced_locally
	let builder = $state.raw(open(bidId));
	/** The bid the address asked for when the editor opened: another one opens a new editor. */
	// svelte-ignore state_referenced_locally
	let opened = bidId;

	// Another bid in the address (a clone, the back button) opens it; the editor's own new id does not.
	$effect(() => {
		const id = bidId;
		if (id !== null && id !== opened && id !== untrack(() => builder.state.id)) {
			opened = id;
			builder = open(id);
		}
	});

	/** An address from before bids came first: the request it names, when it names one. */
	async function moved(error: unknown): Promise<boolean> {
		if (!(error instanceof ApiError) || error.status !== 404 || !bidId) return false;
		const project = workingProject(liveState().siteUrl, page.url);
		if (!project) return false;
		try {
			await api.get(project.id, bidId);
		} catch {
			return false;
		}
		const to = movedRequestPath(page.url.pathname, page.url.search, true);
		if (to) await goto(to, { replaceState: true });
		return to !== null;
	}

	let kind = $state<ItemKind>('shot');
	let adding = $state<ItemKind | null>(null);
	let fieldsOpen = $state(false);
	let projectOpen = $state(false);
	let deleteOpen = $state(false);
	let discardOpen = $state(false);
	let toast = $state<Toast | null>(null);
	let toastId = 0;

	const unmapped = $derived(builder.mappingStatus ? mappingWords(builder.mappingStatus).unmapped.length : 0);
	const title = $derived(builder.state.name.trim() || (builder.stored ? UNTITLED_BID : 'New bid'));
	const rows = $derived(builder.state.shots.length + builder.state.assets.length);
	const requests = $derived(wentOutIn(builder.requests));

	async function sendInRequest(): Promise<void> {
		await builder.flush();
		if (!builder.stored || !builder.state.project) return;
		await goto(newRequestHref({ projectId: builder.state.project.id, bids: [builder.state.id] }));
	}

	let cloning = $state(false);
	async function clone(): Promise<void> {
		if (!builder.state.project) return;
		cloning = true;
		try {
			await builder.flush();
			const copy = await bidsApi.clone(builder.state.project.id, builder.state.id);
			await goto(bidHref({ id: copy.bid.id, projectId: builder.state.project.id }));
			toast = { id: ++toastId, line: `This is ${copy.bid.name}, a copy with every row.` };
		} catch (error) {
			toast = { id: ++toastId, line: `Not cloned. ${error instanceof Error ? error.message : String(error)}` };
		} finally {
			cloning = false;
		}
	}

	// Moving or copying the selected rows to another bid: saved first, then one write on the server.
	let sending = $state<{ rows: Target[]; move: boolean } | null>(null);
	let sendOpen = $state(false);
	function sendRows(targets: Target[], move: boolean): void {
		sending = { rows: targets, move };
		sendOpen = true;
	}
	async function send(to: BidOverview): Promise<void> {
		if (!sending || !builder.state.project) return;
		await builder.flush();
		const answer = await bidsApi.moveRows(builder.state.project.id, { from: builder.state.id, to: to.id, rows: sending.rows.map((r) => ({ kind: r.kind, id: r.id })), move: sending.move });
		if (sending.move) builder.replaceWith(answer.from);
		const skipped = sending.rows.length - answer.taken;
		const n = (k: number) => `${k} ${k === 1 ? 'row' : 'rows'}`;
		toast = { id: ++toastId, line: `${n(answer.taken)} ${sending.move ? 'moved' : 'copied'} to ${to.name}.${skipped > 0 ? ` ${n(skipped)} it held already ${skipped === 1 ? 'stays' : 'stay'} as ${skipped === 1 ? 'it was' : 'they were'} there.` : ''}` };
	}

	async function afterDelete(name: string): Promise<void> {
		await builder.discard();
		await goto('/bids');
		toast = { id: ++toastId, line: `${name} is deleted.` };
	}

	async function discardLocal(): Promise<void> {
		await builder.discard();
		discardOpen = false;
		await goto('/bids');
	}
</script>

<svelte:head><title>{title} · SG Bids</title></svelte:head>

{#await builder.ready}
	<PageState state="loading" title="Opening the bid…" />
{:then}
	{#if builder.problem}
		<PageState state="empty" title="Not connected" line={builder.problem}>
			{#snippet action()}<Button href="/connect">Connect</Button>{/snippet}
		</PageState>
	{:else if !builder.state.project}
		<ProjectGate {builder} />
	{:else}
		<header class="border-border bg-background shrink-0 border-b px-6 py-3.5" data-slot="page-header">
			<div class="flex flex-wrap items-center gap-x-6 gap-y-3">
				<div class="flex min-w-0 flex-1 flex-col gap-0.5">
					<a href="/bids" class="text-muted-foreground hover:text-foreground focus-visible:ring-ring -ml-0.5 flex w-fit items-center gap-1 rounded-md text-xs outline-none focus-visible:ring-2" data-slot="page-back"><ArrowLeft class="size-3.5" aria-hidden="true" />Bids</a>
					<label class="sr-only" for="bid-name">Bid name</label>
					<input
						id="bid-name"
						class="hover:border-input focus-visible:border-ring focus-visible:ring-ring/50 -ml-1.5 w-full max-w-2xl min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-xl leading-tight font-semibold tracking-tight outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-3"
						value={builder.state.name}
						maxlength={MAX_BID_NAME}
						placeholder="Name the bid"
						autocomplete="off"
						oninput={(e) => builder.setName(e.currentTarget.value)}
						data-slot="bid-name"
					/>
					<div class="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-slot="page-context">
						<span class="text-foreground">{builder.state.project.name}</span>
						{#if !builder.stored}
							<button type="button" class="hover:text-foreground -ml-1.5 underline decoration-current/30 underline-offset-2" onclick={() => (projectOpen = true)} data-slot="change-project">Change</button>
						{/if}
						<SaveLine {builder} />
						{#if requests.length === 0}
							<span>In no request yet</span>
						{:else}
							<span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-slot="bid-requests">
								Went out in
								{#each requests as r (r.id)}
									<a class="hover:text-foreground inline-flex items-center gap-1.5 underline-offset-2 hover:underline" href={requestHref({ ...r, projectId: builder.state.project.id })} title={r.title ?? r.label}>
										<span class="text-foreground font-mono text-xs">{r.label}</span><StatusChip status={r.status} />
									</a>
								{/each}
							</span>
						{/if}
					</div>
				</div>
				<div class="flex max-w-full min-w-0 flex-wrap items-center gap-2" data-slot="page-actions">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger class="hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2" aria-label="More for this bid" data-slot="bid-more">
							<Ellipsis class="size-4" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end">
							<DropdownMenu.Item onSelect={() => void clone()} disabled={!builder.stored || cloning} data-slot="bid-clone">Clone</DropdownMenu.Item>
							<DropdownMenu.Separator />
							<DropdownMenu.Item class="text-destructive" onSelect={() => (builder.stored ? (deleteOpen = true) : (discardOpen = true))} data-slot="bid-delete">
								{builder.stored ? 'Delete bid…' : 'Discard bid…'}
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
					<Button variant="ghost" onclick={() => (fieldsOpen = true)} disabled={!builder.mappingStatus} data-slot="open-fields">
						<Settings2 data-icon="inline-start" />Fields
						{#if unmapped > 0}<span class="border-warning/60 text-foreground rounded-full border px-1.5 text-xs leading-4 tabular-nums" title={`${unmapped} with no Flow PT field`}>{unmapped}</span>{/if}
					</Button>
					<Button onclick={() => void sendInRequest()} disabled={!builder.stored || rows === 0} title={rows === 0 ? 'Add a row first.' : undefined} data-slot="send-bid">
						<Send data-icon="inline-start" />Send in a request
					</Button>
				</div>
			</div>
		</header>
		{#if builder.data.state === 'error'}
			<div class="px-6 pt-3"><Notice tone="destructive" title="Could not read the project.">{' '}{builder.data.message}</Notice></div>
		{/if}
		<ItemsPanel {builder} bind:kind bind:adding onFields={() => (fieldsOpen = true)} onSendRows={builder.stored ? sendRows : undefined} />
		<FieldsDialog {builder} bind:open={fieldsOpen} />
		{#if !builder.stored}<ProjectGate {builder} dialog bind:open={projectOpen} />{/if}
		{#if builder.stored}
			<DeleteBid bind:open={deleteOpen} projectId={builder.state.project.id} bidId={builder.state.id} ondeleted={(gone) => void afterDelete(gone.name)} />
			{#if sending}
				<SendRowsDialog bind:open={sendOpen} projectId={builder.state.project.id} bidId={builder.state.id} count={sending.rows.length} move={sending.move} onSend={send} />
			{/if}
		{/if}
		<Dialog.Root bind:open={discardOpen}>
			<Dialog.Content class="sm:max-w-md">
				<Dialog.Header>
					<Dialog.Title>Discard the unsaved bid?</Dialog.Title>
					<Dialog.Description>{title}. It lives in this tab only. This cannot be undone.</Dialog.Description>
				</Dialog.Header>
				<Dialog.Footer>
					<Button variant="outline" onclick={() => (discardOpen = false)}>Keep it</Button>
					<Button variant="destructive" onclick={() => void discardLocal()}>Discard bid</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>
	{/if}
{:catch error}
	{#await moved(error)}
		<PageState state="loading" title="Opening…" />
	{:then went}
		{#if !went}
			<PageState state="error" title="Could not open the bid" line={error.message}>
				{#snippet action()}<Button href="/bids">Bids</Button>{/snippet}
			</PageState>
		{/if}
	{/await}
{/await}

<EditToast bind:toast />
