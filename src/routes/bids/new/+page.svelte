<!--
	New bid request: seven steps, one at a time, the step in the URL. The draft lives in the
	builder's state and goes to the storage seam on every change. Nothing here writes to Flow PT.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import StepsNav from '$lib/app/builder/steps-nav.svelte';
	import ProjectStep from '$lib/app/builder/project-step.svelte';
	import DetailsStep from '$lib/app/builder/details-step.svelte';
	import FieldsStep from '$lib/app/builder/fields-step.svelte';
	import PickStep from '$lib/app/builder/pick-step.svelte';
	import ItemsStep from '$lib/app/builder/items-step.svelte';
	import ReviewStep from '$lib/app/builder/review-step.svelte';
	import { Builder } from '$lib/app/builder.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { validateHeader } from '$lib/pure/header';
	import { STEPS, neighbours, parseStep, stepStates, type StepKey } from '$lib/pure/steps';
	import { today } from '$lib/app/today';

	const builder = new Builder();

	const step = $derived(parseStep(page.url.searchParams.get('step'), builder.state.project !== null));
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
		if (key) void goto(`?step=${key}`, { keepFocus: true, noScroll: false });
	}

	// The step opened on is written to the URL, so picking a project does not move the page.
	void builder.ready.then(() => {
		if (!page.url.searchParams.get('step')) void goto(`?step=${step}`, { replaceState: true, keepFocus: true });
	});

	const title = $derived(builder.state.form.title.trim() || 'New bid request');
</script>

<svelte:head><title>New request · SG Bids</title></svelte:head>

{#await builder.ready}
	<PageState state="loading" title="Connecting to Flow PT…" />
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
					<span aria-hidden="true">·</span><span>Draft, saved in this tab</span>
				{:else}
					<span>Draft. Pick the project first.</span>
				{/if}
			{/snippet}
			{#snippet actions()}
				{#if near.back}
					<Button variant="outline" onclick={() => go(near.back)}><ArrowLeft data-icon="inline-start" />{label(near.back)}</Button>
				{/if}
				{#if near.next}
					<Button onclick={() => go(near.next)} disabled={states[near.next].state === 'blocked'}>
						Next: {label(near.next)}<ArrowRight data-icon="inline-end" />
					</Button>
				{/if}
			{/snippet}
		</PageHeader>
		<StepsNav {states} onPick={go} />

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
			<ReviewStep {builder} onPick={go} />
		{/if}
	{/if}
{:catch error}
	<PageState state="error" title="Could not open the draft" line={error.message} />
{/await}
