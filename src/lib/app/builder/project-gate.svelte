<!--
	The project, picked once: one project per request, with the registry's ProjectPicker as
	sg-task-templates does. With no project yet it is the whole page, in the middle of it, and offers
	the project last worked in (or the one the address names) as a one-click start. After, it opens
	from the page header as a small dialog, and says first that another project starts the picks over.
-->
<script lang="ts">
	import { page } from '$app/state';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Notice from '$lib/app/notice.svelte';
	import FieldLabel from '$lib/app/field-label.svelte';
	import ProjectPicker from '$lib/components/project-picker.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { currentProject } from '$lib/current-project';
	import { liveContext, liveState } from '$lib/live';
	import { projectParam } from '$lib/pure/routes';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, dialog = false, open = $bindable(false) }: { builder: Builder; dialog?: boolean; open?: boolean } = $props();

	const picked = $derived(builder.state.shots.length + builder.state.assets.length);
	const value = $derived(builder.state.project ? { type: 'Project', id: builder.state.project.id, name: builder.state.project.name } : null);
	/** The project to offer first: the address's, else the last one worked in, in this browser. */
	const suggested = $derived.by(() => {
		const kept = currentProject(liveState().siteUrl);
		const named = projectParam(page.url.searchParams);
		if (named !== null) return kept?.id === named ? kept : { id: named, name: `Project ${named}` };
		return kept;
	});

	function pick(next: { id: number; name?: string | null } | null): void {
		void builder.setProject(next ? { id: next.id, name: next.name ?? `Project ${next.id}` } : null);
		open = false;
	}
</script>

{#snippet picker(label: string)}
	<div class="flex flex-col gap-1.5">
		<FieldLabel focus="f-project">{label}</FieldLabel>
		<div class="w-full" id="f-project" data-slot="project-picker">
			<ProjectPicker context={liveContext()} {value} onValueChange={pick} placeholder="Search the projects you can see" />
		</div>
	</div>
{/snippet}

{#if dialog}
	<Dialog.Root bind:open>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Change the project</Dialog.Title>
				<Dialog.Description>One project per request. Its Shots and Assets are what vendors bid on.</Dialog.Description>
			</Dialog.Header>
			{@render picker('Project')}
			{#if picked > 0}
				<Notice tone="warning">Another project starts the picks over. {picked} {picked === 1 ? 'item is' : 'items are'} picked now.</Notice>
			{/if}
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (open = false)}>Keep {builder.state.project?.name ?? 'this one'}</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{:else}
	<div class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-12">
		<section class="bg-card text-card-foreground flex w-full max-w-lg flex-col gap-5 rounded-xl border p-6 shadow-xs" aria-labelledby="gate-title" data-slot="project-gate">
			<div class="flex items-start gap-3">
				<span class="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full border"><FolderOpen class="size-5" aria-hidden="true" /></span>
				<div class="flex flex-col gap-1">
					<h1 id="gate-title" class="text-lg leading-tight font-semibold tracking-tight">New bid request</h1>
					<p class="text-muted-foreground text-sm">Pick the project first. Its Shots and Assets are what vendors bid on. One project per request.</p>
				</div>
			</div>
			{#if suggested}
				<Button class="w-full justify-center" onclick={() => pick(suggested)} data-slot="start-in-project">Start in {suggested.name}</Button>
				{@render picker('Or another project')}
			{:else}
				{@render picker('Project')}
			{/if}
			{#if builder.data.state === 'error'}
				<Notice tone="destructive" title="Could not read the project.">{' '}{builder.data.message}</Notice>
			{/if}
			<div class="border-border -mx-6 -mb-6 flex items-center justify-between rounded-b-xl border-t px-6 py-3">
				<a href="/bids" class="text-muted-foreground hover:text-foreground text-sm underline decoration-current/30 underline-offset-2">Back to the requests</a>
				<span class="text-muted-foreground text-xs">The draft saves once it has a project and a code.</span>
			</div>
		</section>
	</div>
{/if}
