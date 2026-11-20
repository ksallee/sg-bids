<!--
	A bid request draft: seven steps, one at a time, the step and the stored id in the URL. The draft
	lives in the builder's state and is stored as it changes. An issued request opens read only, on
	its review, with New round. Nothing here writes to Flow PT.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import StepsNav from '$lib/app/builder/steps-nav.svelte';
	import ProjectStep from '$lib/app/builder/project-step.svelte';
	import DetailsStep from '$lib/app/builder/details-step.svelte';
	import FieldsStep from '$lib/app/builder/fields-step.svelte';
	import PickStep from '$lib/app/builder/pick-step.svelte';
	import ItemsStep from '$lib/app/builder/items-step.svelte';
	import ReviewStep from '$lib/app/builder/review-step.svelte';
	import SaveLine from '$lib/app/builder/save-line.svelte';
	import { Builder } from '$lib/app/builder.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { validateHeader } from '$lib/pure/header';
	import { STEPS, neighbours, parseStep, stepStates, type StepKey } from '$lib/pure/steps';
	import { today } from '$lib/app/today';

	function open(id: string | null): Builder {
		const next = new Builder(id);
		next.onStored = (stored) => void goto(`?id=${stored}&step=${untrack(() => step)}`, { replaceState: true, keepFocus: true, noScroll: true });
		return next;
	}

	let builder = $state.raw(open(page.url.searchParams.get('id')));

	// Another request in the URL (a new round, the back button) opens it; the builder's own new id does not.
	$effect(() => {
		const id = page.url.searchParams.get('id');
		if (id !== null && id !== untrack(() => builder.state.id)) builder = open(id);
	});

	const step = $derived(builder.readOnly ? 'review' : parseStep(page.url.searchParams.get('step'), builder.state.project !== null));
	const states = $derived(
		stepStates(step, {
			project: builder.state.project !== null,
			details: Object.keys(validateHeader(builder.state.form, today())).length === 0,
			mapping: builder.mapping !== null,
			shots: builder.state.shots.length,
			assets: builder.state.assets.length
		})
	);
	const near = $derived(neighbours(step));
	const label = (key: StepKey | null) => STEPS.find((s) => s.key === key)?.label ?? '';

	function go(key: StepKey | null): void {
		if (!key) return;
		const id = builder.state.id.startsWith('local-') ? '' : `id=${builder.state.id}&`;
		void goto(`?${id}step=${key}`, { keepFocus: true });
	}

	// The step opened on is written to the URL, so picking a project does not move the page.
	$effect(() => {
		void builder.ready.then(() => {
			if (!page.url.searchParams.get('step')) go(untrack(() => step));
		});
	});

	let rounding = $state(false);
	let roundError = $state<string | null>(null);
	async function newRound(): Promise<void> {
		rounding = true;
		roundError = null;
		try {
			const id = await builder.newRound();
			await goto(`/bids/new?id=${id}&step=details`);
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
					{#if builder.state.form.code.trim()}<span aria-hidden="true">·</span><span class="font-mono text-xs">{builder.state.form.code.trim()}</span>{/if}
					<span aria-hidden="true">·</span><span>Round {builder.state.form.round || 1}</span>
					<span aria-hidden="true">·</span><SaveLine {builder} />
				{:else}
					<span>Draft. Pick the project first.</span>
				{/if}
			{/snippet}
			{#snippet actions()}
				{#if builder.readOnly}
					<Button variant="outline" href={`/bids/${builder.state.id}`}>Open the request</Button>
					<Button onclick={() => void newRound()} disabled={rounding}>{rounding ? 'Starting…' : 'New round'}</Button>
				{:else}
					{#if near.back}
						<Button variant="outline" onclick={() => go(near.back)}><ArrowLeft data-icon="inline-start" />{label(near.back)}</Button>
					{/if}
					{#if near.next}
						<Button onclick={() => go(near.next)} disabled={states[near.next].state === 'blocked'}>
							Next: {label(near.next)}<ArrowRight data-icon="inline-end" />
						</Button>
					{/if}
				{/if}
			{/snippet}
			{#if builder.readOnly}
				<Notice tone="info" title="Issued.">{' '}The items are frozen. A change is a new round with the same code.</Notice>
			{/if}
			{#if roundError}<Notice tone="destructive" title="Could not start the round.">{' '}{roundError}</Notice>{/if}
		</PageHeader>
		{#if !builder.readOnly}<StepsNav {states} onPick={go} />{/if}

		{#if step === 'project'}
			<ProjectStep {builder} />
		{:else if step === 'details'}
			<DetailsStep {builder} />
		{:else if step === 'fields'}
			<FieldsStep {builder} />
		{:else if step === 'shots'}
			<PickStep {builder} kind="shot" />
		{:else if step === 'assets'}
			<PickStep {builder} kind="asset" />
		{:else if step === 'items'}
			<ItemsStep {builder} onPick={go} />
		{:else}
			<ReviewStep {builder} onPick={go} onIssued={(id) => void goto(`/bids/${id}`)} />
		{/if}
	{/if}
{:catch error}
	<PageState state="error" title="Could not open the draft" line={error.message}>
		{#snippet action()}<Button href="/bids">Requests</Button>{/snippet}
	</PageState>
{/await}
