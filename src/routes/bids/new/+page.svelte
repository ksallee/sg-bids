<!--
	A bid request draft, on one working page. The project is picked once. The header folds to one line
	in the page header once it is filled, and opens as a form while a field needs a fix or on Edit
	details. The Shots and Assets table is the work: it takes the full width and the rest of the
	height, with what the vendor gets and what is left before the issue on its bar. The field mapping
	opens on demand. Review is the last look before Issue. The URL holds the stored id and the view.
	The draft is stored as it changes; an issued request opens read only, on its review, with New
	round. Nothing here writes to Flow PT but a field the person asks to create. The menu beside the
	actions deletes a stored draft, or discards one not stored yet.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import DeleteRequest from '$lib/app/request/delete-request.svelte';
	import { deletedNote } from '$lib/app/request/deleted-note.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { deletedLine } from '$lib/pure/request-delete';
	import { isLocalId } from '$lib/pure/persist';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import FieldsDialog from '$lib/app/builder/fields-dialog.svelte';
	import HeaderPanel from '$lib/app/builder/header-panel.svelte';
	import ItemsPanel from '$lib/app/builder/items-panel.svelte';
	import ProjectGate from '$lib/app/builder/project-gate.svelte';
	import ReviewView from '$lib/app/builder/review-view.svelte';
	import SaveLine from '$lib/app/builder/save-line.svelte';
	import { focusControl } from '$lib/app/builder/focus';
	import { Builder } from '$lib/app/builder.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { builderHref, parseView } from '$lib/pure/builder-view';
	import type { ItemKind } from '$lib/pure/field-map';
	import { mappingWords } from '$lib/pure/field-map';
	import { headerSummary } from '$lib/pure/header-summary';
	import { foldOf, type Target } from '$lib/pure/readiness';
	import { cn } from '$lib/utils.js';

	function open(id: string | null): Builder {
		const next = new Builder(id);
		next.onStored = (stored) => void goto(builderHref(stored, untrack(() => view)), { replaceState: true, keepFocus: true, noScroll: true });
		return next;
	}

	let builder = $state.raw(open(page.url.searchParams.get('id')));

	// Another request in the URL (a new round, the back button) opens it; the builder's own new id does not.
	$effect(() => {
		const id = page.url.searchParams.get('id');
		if (id !== null && id !== untrack(() => builder.state.id)) builder = open(id);
	});

	const view = $derived(parseView(page.url.searchParams, builder.readOnly));
	let folds = $state({ delivery: false, assumptions: false });
	let kind = $state<ItemKind>('shot');
	/** The kind the Flow PT picker is open for, over the items area. */
	let adding = $state<ItemKind | null>(null);
	let revealed = $state<ReadonlySet<string>>(new Set());
	let fieldsOpen = $state(false);
	let projectOpen = $state(false);
	let confirming = $state(false);
	/** The header form: open on Edit details, folded on Done; until then, open while a field needs a fix. */
	let details = $state<boolean | null>(null);

	const go = (next: 'edit' | 'review') => goto(builderHref(builder.state.id, next), { noScroll: false });

	const dayFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
	const summary = $derived(headerSummary(builder.state.form, builder.readiness.problems, (iso) => dayFormat.format(new Date(`${iso}T00:00:00Z`))));
	const showDetails = $derived(details ?? summary.toFix > 0);
	const unmapped = $derived(builder.mappingStatus ? mappingWords(builder.mappingStatus).unmapped.length : 0);

	/** Take the person to the control a problem points at, from the summary or the review. */
	async function focusOn(target: Target): Promise<void> {
		if (view !== 'edit') await go('edit');
		revealed = new Set([...revealed, target]);
		const fold = foldOf(target);
		if (fold) folds = { ...folds, [fold]: true };
		if (target !== 'items' && target !== 'project') details = true;
		if (target === 'items') {
			const k: ItemKind = builder.state.shots.length === 0 && builder.state.assets.length > 0 ? 'asset' : 'shot';
			kind = k;
			if (builder.state.shots.length + builder.state.assets.length === 0) adding = k;
		}
		if (target === 'project') projectOpen = true;
		else await focusControl(target);
	}

	function review(): void {
		revealed = new Set(['*']);
		void go('review');
	}

	let rounding = $state(false);
	let roundError = $state<string | null>(null);
	async function newRound(): Promise<void> {
		rounding = true;
		roundError = null;
		try {
			const id = await builder.newRound();
			await goto(builderHref(id, 'edit'));
		} catch (error) {
			roundError = error instanceof Error ? error.message : String(error);
		} finally {
			rounding = false;
		}
	}

	const title = $derived(builder.state.form.title.trim() || 'New bid request');

	// Deleting the draft: a stored one through the server, one not stored yet from this tab only.
	let deleteOpen = $state(false);
	let discardOpen = $state(false);
	const stored = $derived(!isLocalId(builder.state.id));
	async function discardLocal(): Promise<void> {
		await builder.discard();
		discardOpen = false;
		await goto('/bids');
	}
	async function afterDelete(line: string): Promise<void> {
		await builder.discard();
		deletedNote.line = line;
		await goto('/bids');
	}
</script>

<svelte:head><title>{title} · SG Bids</title></svelte:head>

{#await builder.ready}
	<PageState state="loading" title="Opening the draft…" />
{:then}
	{#if builder.problem}
		<PageState state="empty" title="Not connected" line={builder.problem}>
			{#snippet action()}<Button href="/connect">Connect</Button>{/snippet}
		</PageState>
	{:else if !builder.state.project}
		<ProjectGate {builder} />
	{:else}
		<PageHeader {title} back={{ href: '/bids', label: 'Bid requests' }}>
			{#snippet context()}
				<span class="text-foreground">{builder.state.project?.name}</span>
				{#if !builder.readOnly && view === 'edit'}
					<button type="button" class="hover:text-foreground -ml-1.5 underline decoration-current/30 underline-offset-2" onclick={() => (projectOpen = true)} data-slot="change-project">Change</button>
				{/if}
				{#each summary.parts as part (part.key)}
					<span class={cn(part.mono && 'text-foreground font-mono text-xs', part.key === 'dueDate' && 'tabular-nums')}>{part.text}</span>
				{/each}
				<SaveLine {builder} />
				{#if !builder.readOnly && view === 'edit' && !showDetails}
					<button
						type="button"
						class={cn(
							'focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm underline decoration-current/30 underline-offset-2 outline-none focus-visible:ring-2',
							summary.toFix > 0 ? 'text-destructive' : 'hover:text-foreground'
						)}
						onclick={() => (details = true)}
						data-slot="edit-details"
					>
						<Pencil class="size-3" aria-hidden="true" />{summary.toFix > 0 ? `${summary.toFix} to fix in the details` : 'Edit details'}
					</button>
				{/if}
			{/snippet}
			{#snippet actions()}
				{#if builder.readOnly}
					<Button variant="outline" href={`/bids/${builder.state.id}`}>Open the request</Button>
					<Button onclick={() => void newRound()} disabled={rounding}>{rounding ? 'Starting…' : 'New round'}</Button>
				{:else if view === 'review'}
					<Button variant="outline" onclick={() => void go('edit')} data-slot="back-to-edit"><ArrowLeft data-icon="inline-start" />Back to the request</Button>
					<Button onclick={() => (confirming = true)} disabled={!builder.readiness.canIssue || builder.saving.kind === 'waiting'} data-slot="issue">Issue the request</Button>
				{:else}
					<DropdownMenu.Root>
						<DropdownMenu.Trigger class="hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2" aria-label="More for this draft" data-slot="draft-more">
							<Ellipsis class="size-4" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end">
							<DropdownMenu.Item class="text-destructive" onSelect={() => (stored ? (deleteOpen = true) : (discardOpen = true))} data-slot="draft-delete">
								{stored ? 'Delete draft…' : 'Discard draft…'}
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
					<Button variant="ghost" onclick={() => (fieldsOpen = true)} disabled={!builder.mappingStatus} data-slot="open-fields">
						<Settings2 data-icon="inline-start" />Fields
						{#if unmapped > 0}<span class="border-warning/60 text-foreground rounded-full border px-1.5 text-xs leading-4 tabular-nums" title={`${unmapped} with no Flow PT field`}>{unmapped}</span>{/if}
					</Button>
					<Button onclick={review} data-slot="review">Review and issue</Button>
				{/if}
			{/snippet}
			{#if builder.readOnly}
				<Notice tone="info" title="Issued.">{' '}The items are frozen. A change is a new round with the same code.</Notice>
			{/if}
			{#if roundError}<Notice tone="destructive" title="Could not start the round.">{' '}{roundError}</Notice>{/if}
		</PageHeader>

		{#if view === 'review'}
			<ReviewView {builder} bind:confirming onFocus={(t) => void focusOn(t)} onIssued={(id) => void goto(`/bids/${id}`)} />
		{:else}
			{#if showDetails}
				<div class="border-border bg-card/60 max-h-[55dvh] shrink-0 overflow-y-auto border-b px-6 py-4" onfocusin={() => (details ??= true)} data-slot="builder-details">
					<HeaderPanel {builder} bind:folds {revealed} onDone={() => (details = false)} />
				</div>
			{/if}
			{#if builder.data.state === 'error'}
				<div class="px-6 pt-3"><Notice tone="destructive" title="Could not read the project.">{' '}{builder.data.message}</Notice></div>
			{/if}
			<ItemsPanel {builder} bind:kind bind:adding onFields={() => (fieldsOpen = true)} onFocus={(t) => void focusOn(t)} />
			<FieldsDialog {builder} bind:open={fieldsOpen} />
		{/if}
		{#if !builder.readOnly}
			<ProjectGate {builder} dialog bind:open={projectOpen} />
			{#if stored && builder.state.project}
				<DeleteRequest bind:open={deleteOpen} projectId={builder.state.project.id} requestId={builder.state.id} ondeleted={(gone) => void afterDelete(deletedLine(gone))} />
			{/if}
			<Dialog.Root bind:open={discardOpen}>
				<Dialog.Content class="sm:max-w-md">
					<Dialog.Header>
						<Dialog.Title>Discard the unsaved draft?</Dialog.Title>
						<Dialog.Description>{title}. It lives in this tab only. This cannot be undone.</Dialog.Description>
					</Dialog.Header>
					<Dialog.Footer>
						<Button variant="outline" onclick={() => (discardOpen = false)}>Keep it</Button>
						<Button variant="destructive" onclick={() => void discardLocal()}>Discard draft</Button>
					</Dialog.Footer>
				</Dialog.Content>
			</Dialog.Root>
		{/if}
	{/if}
{:catch error}
	<PageState state="error" title="Could not open the draft" line={error.message}>
		{#snippet action()}<Button href="/bids">Bid requests</Button>{/snippet}
	</PageState>
{/await}
