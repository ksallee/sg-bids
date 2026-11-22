<!--
	A new request: a small dialog asks for its name and its project, both required, then the request's
	page opens with one empty bid, named after the request with 01. The project starts as the one last worked in. The name is the
	request's one name: its code is made from it and stays out of sight.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import FieldLabel from '$lib/app/field-label.svelte';
	import Notice from '$lib/app/notice.svelte';
	import RequiredLegend from '$lib/app/required-legend.svelte';
	import ProjectPicker from '$lib/components/project-picker.svelte';
	import { api } from '$lib/api';
	import { currentProject, setCurrentProject } from '$lib/current-project';
	import { liveContext, liveState } from '$lib/live';
	import type { ProjectPick } from '$lib/pure/header';
	import { requestHref } from '$lib/pure/routes';
	import { MAX_REQUEST_NAME } from '$lib/pure/wire';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let name = $state('');
	let project = $state<ProjectPick | null>(null);
	let tried = $state(false);
	let busy = $state(false);
	let failure = $state<string | null>(null);
	const uid = $props.id();

	$effect(() => {
		if (!open) return;
		name = '';
		tried = false;
		failure = null;
		project = currentProject(liveState().siteUrl);
	});

	const nameProblem = $derived(name.trim() === '' ? 'Name the request.' : null);
	const projectProblem = $derived(project ? null : 'Pick the project.');

	async function create(): Promise<void> {
		tried = true;
		if (nameProblem || !project) {
			document.getElementById(nameProblem ? `${uid}-name` : `${uid}-project`)?.querySelector<HTMLElement>('input, button')?.focus();
			document.getElementById(`${uid}-name`)?.focus();
			return;
		}
		busy = true;
		failure = null;
		try {
			const header = { title: name.trim(), project: project.name, projectRef: { type: 'Project', id: project.id }, round: 1, baseCurrency: 'USD', assumptions: [] };
			const { request } = await api.create(project.id, { name: name.trim(), header });
			setCurrentProject(liveState().siteUrl, project);
			open = false;
			await goto(requestHref({ id: request.id, projectId: project.id }));
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md" data-slot="new-request">
		<Dialog.Header>
			<Dialog.Title>New request</Dialog.Title>
			<Dialog.Description>Name it and pick its project. You add the shots, the vendors and the details next, on one page.</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-4" onsubmit={(e) => (e.preventDefault(), void create())} novalidate>
			<div class="flex flex-col gap-1.5">
				<FieldLabel for={`${uid}-name`} required>Name</FieldLabel>
				<Input
					id={`${uid}-name`}
					bind:value={name}
					maxlength={MAX_REQUEST_NAME}
					placeholder="Rooftop chase, round one"
					autocomplete="off" data-lpignore="true" data-1p-ignore data-form-type="other"
					aria-required="true"
					aria-invalid={tried && nameProblem ? 'true' : undefined}
					data-slot="new-request-name"
				/>
				{#if tried && nameProblem}<p class="text-destructive text-xs">{nameProblem}</p>{:else}<p class="text-muted-foreground text-xs">Vendors see it. One name: no code to make up.</p>{/if}
			</div>
			<div class="flex flex-col gap-1.5">
				<FieldLabel focus={`${uid}-project`} required>Project</FieldLabel>
				<div id={`${uid}-project`} data-slot="new-request-project">
					<ProjectPicker
						context={liveContext()}
						value={project ? { type: 'Project', id: project.id, name: project.name } : null}
						placeholder="Search the projects you can see"
						onValueChange={(v) => (project = v ? { id: v.id, name: v.name ?? `Project ${v.id}` } : null)}
					/>
				</div>
				{#if tried && projectProblem}<p class="text-destructive text-xs">{projectProblem}</p>{/if}
			</div>
			<RequiredLegend />
			{#if failure}<Notice tone="destructive" title="Not made.">{' '}{failure}</Notice>{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
				<Button type="submit" disabled={busy} data-slot="new-request-create">{busy ? 'Making…' : 'Make the request'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
