<!--
	A bid request draft, on one working page: the project once, the header, then the Shots and Assets
	as the main work, beside a summary of what the vendor gets and what is left before the issue.
	The field mapping is a setting that opens on demand. Review is the last look before Issue. The
	URL holds the stored id and the view. The draft is stored as it changes; an issued request opens
	read only, on its review, with New round. Nothing here writes to Flow PT but a field the person
	asks to create.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import FieldsDialog from '$lib/app/builder/fields-dialog.svelte';
	import HeaderPanel from '$lib/app/builder/header-panel.svelte';
	import ItemsPanel, { type ItemsView } from '$lib/app/builder/items-panel.svelte';
	import ProjectGate from '$lib/app/builder/project-gate.svelte';
	import ReviewView from '$lib/app/builder/review-view.svelte';
	import SaveLine from '$lib/app/builder/save-line.svelte';
	import SummaryRail from '$lib/app/builder/summary-rail.svelte';
	import { focusControl } from '$lib/app/builder/focus';
	import { Builder } from '$lib/app/builder.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { builderHref, parseView } from '$lib/pure/builder-view';
	import type { ItemKind } from '$lib/pure/field-map';
	import { foldOf, type Target } from '$lib/pure/readiness';

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
	let views = $state<Record<ItemKind, ItemsView>>({ shot: 'picked', asset: 'picked' });
	let revealed = $state<ReadonlySet<string>>(new Set());
	let fieldsOpen = $state(false);
	let projectOpen = $state(false);
	let confirming = $state(false);

	const go = (next: 'edit' | 'review') => goto(builderHref(builder.state.id, next), { noScroll: false });

	/** Take the person to the control a problem points at, from the summary or the review. */
	async function focusOn(target: Target): Promise<void> {
		if (view !== 'edit') await go('edit');
		revealed = new Set([...revealed, target]);
		const fold = foldOf(target);
		if (fold) folds = { ...folds, [fold]: true };
		if (target === 'items') {
			const k: ItemKind = builder.state.shots.length === 0 && builder.state.assets.length > 0 ? 'asset' : 'shot';
			kind = k;
			if (builder.state.shots.length + builder.state.assets.length === 0) views = { ...views, [k]: 'add' };
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
</script>

<svelte:head><title>{title} · SG Bids</title></svelte:head>

{#await builder.ready}
	<PageState state="loading" title="Opening the draft…" />
{:then}
	{#if builder.problem}
		<PageState state="empty" title="Not connected" line={builder.problem}>
			{#snippet action()}<Button href="/connect">Connect</Button>{/snippet}
		</PageState>
	{:else}
		<PageHeader {title}>
			{#snippet context()}
				{#if builder.state.project}
					<span class="text-foreground">{builder.state.project.name}</span>
					{#if !builder.readOnly && view === 'edit'}
						<button type="button" class="hover:text-foreground underline decoration-current/30 underline-offset-2" onclick={() => (projectOpen = true)} data-slot="change-project">Change</button>
					{/if}
					{#if builder.state.form.code.trim()}<span aria-hidden="true">·</span><span class="text-foreground font-mono text-xs">{builder.state.form.code.trim()}</span>{/if}
					<span aria-hidden="true">·</span><span>Round {builder.state.form.round || 1}</span>
					<span aria-hidden="true">·</span><SaveLine {builder} />
				{:else}
					<span>Pick the project first. The draft saves from then on.</span>
				{/if}
			{/snippet}
			{#snippet actions()}
				{#if builder.readOnly}
					<Button variant="outline" href={`/bids/${builder.state.id}`}>Open the request</Button>
					<Button onclick={() => void newRound()} disabled={rounding}>{rounding ? 'Starting…' : 'New round'}</Button>
				{:else if builder.state.project && view === 'review'}
					<Button variant="outline" onclick={() => void go('edit')} data-slot="back-to-edit"><ArrowLeft data-icon="inline-start" />Back to the request</Button>
					<Button onclick={() => (confirming = true)} disabled={!builder.readiness.canIssue || builder.saving.kind === 'waiting'} data-slot="issue">Issue the request</Button>
				{:else if builder.state.project}
					<Button onclick={review} data-slot="review">Review and issue</Button>
				{/if}
			{/snippet}
			{#if builder.readOnly}
				<Notice tone="info" title="Issued.">{' '}The items are frozen. A change is a new round with the same code.</Notice>
			{/if}
			{#if roundError}<Notice tone="destructive" title="Could not start the round.">{' '}{roundError}</Notice>{/if}
		</PageHeader>

		{#if !builder.state.project}
			<ProjectGate {builder} />
		{:else if view === 'review'}
			<ReviewView {builder} bind:confirming onFocus={(t) => void focusOn(t)} onIssued={(id) => void goto(`/bids/${id}`)} />
		{:else}
			<div class="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
				<div class="min-w-0 flex-1 lg:overflow-y-auto" data-slot="builder-main">
					<div class="flex w-full max-w-6xl flex-col gap-8 px-6 pt-5 pb-10">
						<HeaderPanel {builder} bind:folds {revealed} />
						{#if builder.data.state === 'error'}
							<Notice tone="destructive" title="Could not read the project.">{' '}{builder.data.message}</Notice>
						{/if}
						<ItemsPanel {builder} bind:kind bind:views onFields={() => (fieldsOpen = true)} />
					</div>
				</div>
				<div class="border-border order-first shrink-0 border-b lg:order-none lg:w-80 lg:overflow-y-auto lg:border-b-0 lg:border-l xl:w-[22rem]">
					<SummaryRail {builder} onFocus={(t) => void focusOn(t)} onFields={() => (fieldsOpen = true)} />
				</div>
			</div>
			<FieldsDialog {builder} bind:open={fieldsOpen} />
		{/if}
		{#if builder.state.project && !builder.readOnly}
			<ProjectGate {builder} dialog bind:open={projectOpen} />
		{/if}
	{/if}
{:catch error}
	<PageState state="error" title="Could not open the draft" line={error.message}>
		{#snippet action()}<Button href="/bids">Requests</Button>{/snippet}
	</PageState>
{/await}
