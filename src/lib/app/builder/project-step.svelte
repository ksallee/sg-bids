<!--
	Step 1, Project: one project per request, picked with the registry's ProjectPicker as
	sg-task-templates does. A change of project starts the picks over, and says so first.
-->
<script lang="ts">
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Notice from '$lib/app/notice.svelte';
	import ProjectPicker from '$lib/components/project-picker.svelte';
	import { liveContext } from '$lib/live';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder }: { builder: Builder } = $props();

	const picked = $derived(builder.state.shots.length + builder.state.assets.length);
	const value = $derived(builder.state.project ? { type: 'Project', id: builder.state.project.id, name: builder.state.project.name } : null);
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div class="flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
		<section class="flex flex-col gap-4" aria-label="Project">
			<div class="flex items-start gap-3">
				<span class="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full"><FolderOpen class="size-4" aria-hidden="true" /></span>
				<div class="flex flex-col gap-1">
					<h2 class="text-base font-semibold">Which show is this bid for?</h2>
					<p class="text-muted-foreground text-sm">One project per request. Its Shots and Assets are what vendors bid on.</p>
				</div>
			</div>
			<div class="max-w-md" data-slot="project-picker">
				<ProjectPicker
					context={liveContext()}
					{value}
					onValueChange={(next) => void builder.setProject(next ? { id: next.id, name: next.name ?? `Project ${next.id}` } : null)}
					placeholder="Pick a project"
				/>
			</div>
			{#if picked > 0}
				<Notice tone="info">Another project starts the picks over. {picked} {picked === 1 ? 'item is' : 'items are'} picked now.</Notice>
			{/if}
			{#if builder.data.state === 'error'}
				<Notice tone="destructive" title="Could not read the project.">{' '}{builder.data.message}</Notice>
			{/if}
		</section>
		{#if builder.data.state === 'loading'}
			<p class="text-muted-foreground text-sm" role="status">Reading the project's fields and Sequences…</p>
		{/if}
	</div>
</div>
