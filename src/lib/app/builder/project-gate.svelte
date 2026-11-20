<!--
	The project, picked once: one project per request, with the registry's ProjectPicker as
	sg-task-templates does. With no project yet it is the whole page; after, it opens from the page
	header as a small dialog, and says first that another project starts the picks over.
-->
<script lang="ts">
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Notice from '$lib/app/notice.svelte';
	import ProjectPicker from '$lib/components/project-picker.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { liveContext } from '$lib/live';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, dialog = false, open = $bindable(false) }: { builder: Builder; dialog?: boolean; open?: boolean } = $props();

	const picked = $derived(builder.state.shots.length + builder.state.assets.length);
	const value = $derived(builder.state.project ? { type: 'Project', id: builder.state.project.id, name: builder.state.project.name } : null);

	function pick(next: { id: number; name?: string | null } | null): void {
		void builder.setProject(next ? { id: next.id, name: next.name ?? `Project ${next.id}` } : null);
		open = false;
	}
</script>

{#snippet picker()}
	<div class="w-full" id="f-project" data-slot="project-picker">
		<ProjectPicker context={liveContext()} {value} onValueChange={pick} placeholder="Pick a project" />
	</div>
{/snippet}

{#if dialog}
	<Dialog.Root bind:open>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Change the project</Dialog.Title>
				<Dialog.Description>One project per request. Its Shots and Assets are what vendors bid on.</Dialog.Description>
			</Dialog.Header>
			{@render picker()}
			{#if picked > 0}
				<Notice tone="warning">Another project starts the picks over. {picked} {picked === 1 ? 'item is' : 'items are'} picked now.</Notice>
			{/if}
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (open = false)}>Keep {builder.state.project?.name ?? 'this one'}</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{:else}
	<div class="flex flex-1 items-start justify-center overflow-y-auto px-6 py-16">
		<section class="bg-card text-card-foreground flex w-full max-w-lg flex-col gap-5 rounded-lg border p-6" aria-labelledby="gate-title" data-slot="project-gate">
			<div class="flex items-start gap-3">
				<span class="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full"><FolderOpen class="size-4" aria-hidden="true" /></span>
				<div class="flex flex-col gap-1">
					<h2 id="gate-title" class="text-base font-semibold">Which project is this bid for?</h2>
					<p class="text-muted-foreground text-sm">One project per request. Its Shots and Assets are what vendors bid on. Then you give it a title and pick what goes out.</p>
				</div>
			</div>
			{@render picker()}
			{#if builder.data.state === 'error'}
				<Notice tone="destructive" title="Could not read the project.">{' '}{builder.data.message}</Notice>
			{/if}
		</section>
	</div>
{/if}
