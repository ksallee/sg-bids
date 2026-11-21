<!--
	A draft request, on one page. The name is the title, typed in place. Issue is always in sight, with
	what still stops it beside it (`issue-bar`). The rows take the rest of the width: one table grouped
	by bid, the bids as chips above it (`items-panel`). The side panel holds the details and the
	vendors, nothing in steps. It hides to a narrow rail to give the table its room, and this browser
	remembers which (`side-panel.svelte.ts`); the issue list opens it when a problem is there. Everything saves as it changes, in one write
	(`$lib/drafts`). The menu duplicates or deletes the request.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import PanelRightClose from '@lucide/svelte/icons/panel-right-close';
	import PanelRightOpen from '@lucide/svelte/icons/panel-right-open';
	import { sidePanel } from '$lib/app/side-panel.svelte';
	import Notice from '$lib/app/notice.svelte';
	import StatusChip from '$lib/app/status-chip.svelte';
	import SetupNotice from '$lib/app/setup-notice.svelte';
	import DeleteRequest from '$lib/app/request/delete-request.svelte';
	import DuplicateRequest from '$lib/app/request/duplicate-request.svelte';
	import { deletedNote } from '$lib/app/request/deleted-note.svelte';
	import FieldsDialog from './fields-dialog.svelte';
	import ItemsPanel from './items-panel.svelte';
	import DetailsPanel from './details-panel.svelte';
	import VendorsPanel from './vendors-panel.svelte';
	import IssueBar from './issue-bar.svelte';
	import SaveLine from './save-line.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { Invited } from '$lib/api';
	import type { Builder } from '$lib/app/builder.svelte';
	import { mappingWords } from '$lib/pure/field-map';
	import { MAX_REQUEST_NAME } from '$lib/pure/wire';
	import { controlId } from '$lib/pure/readiness';
	import { deletedLine } from '$lib/pure/request-delete';
	import { cn } from '$lib/utils.js';

	let { builder, onIssued }: { builder: Builder; onIssued: (links: Invited[]) => void } = $props();

	let revealed = $state<ReadonlySet<string>>(new Set());
	let fieldsOpen = $state(false);
	let deleteOpen = $state(false);
	let duplicateOpen = $state(false);
	let nameLeft = $state(false);

	const readiness = $derived(builder.readiness);
	const nameProblem = $derived(readiness.problems.find((p) => p.target === 'title'));
	const showName = $derived(nameProblem && (nameLeft || revealed.has('*') || revealed.has('title')) ? nameProblem : undefined);
	const marked = $derived(
		new Set(
			readiness.toIssue
				.filter((p) => p.target.startsWith('bid:') && (revealed.has('*') || revealed.has(p.target)))
				.map((p) => p.target.slice(4))
		)
	);
	/** What the issue asks for in the panel: shown on its toggle while it is hidden. */
	const sideProblems = $derived(readiness.toIssue.filter((p) => !(p.target === 'title' || p.target === 'items' || p.target.startsWith('bid:') || p.target.startsWith('row:'))).length);
	const unmapped = $derived(builder.mappingStatus ? mappingWords(builder.mappingStatus).unmapped.length : 0);
	const round = $derived(Number(builder.form.round) || 1);
	const title = $derived(builder.form.title.trim() || 'Untitled request');
</script>

<svelte:head><title>{title} · SG Bids</title></svelte:head>

<header class="border-border bg-background shrink-0 border-b px-6 py-3" data-slot="page-header">
	<div class="flex flex-wrap items-center gap-x-6 gap-y-3">
		<div class="flex min-w-0 flex-1 flex-col gap-0.5">
			<a href="/requests" class="text-muted-foreground hover:text-foreground focus-visible:ring-ring -ml-0.5 flex w-fit items-center gap-1 rounded-md text-xs outline-none focus-visible:ring-2" data-slot="page-back"><ArrowLeft class="size-3.5" aria-hidden="true" />Requests</a>
			<label class="sr-only" for={controlId('title')}>Request name, required</label>
			<input
				id={controlId('title')}
				class={cn(
					'hover:border-input focus-visible:border-ring focus-visible:ring-ring/50 -ml-1.5 w-full max-w-3xl min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-xl leading-tight font-semibold tracking-tight outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-3',
					showName && 'border-destructive'
				)}
				value={builder.form.title}
				maxlength={MAX_REQUEST_NAME}
				placeholder="Name the request"
				autocomplete="off"
				aria-required="true"
				aria-invalid={showName ? 'true' : undefined}
				aria-describedby={showName ? 'name-problem' : undefined}
				oninput={(e) => builder.setName(e.currentTarget.value)}
				onblur={() => (nameLeft = true)}
				title="Click to rename"
				data-slot="request-name"
			/>
			{#if showName}<p id="name-problem" class="text-destructive flex items-center gap-1.5 text-xs"><CircleAlert class="size-3.5" aria-hidden="true" />{showName.message}</p>{/if}
			<div class="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-slot="page-context">
				<StatusChip status="draft" />
				<span class="text-foreground">{builder.state.project.name}</span>
				{#if round > 1}<span>Round {round}</span>{/if}
				<SaveLine {builder} />
			</div>
		</div>
		<div class="flex max-w-full min-w-0 flex-wrap items-center gap-2" data-slot="page-actions">
			<Button variant="ghost" onclick={() => (fieldsOpen = true)} disabled={!builder.mappingStatus} title="Which Flow PT field fills each column" data-slot="open-fields">
				<Settings2 data-icon="inline-start" />Fields
				{#if unmapped > 0}<span class="border-warning/60 text-foreground rounded-full border px-1.5 text-xs leading-4 tabular-nums" title={`${unmapped} with no Flow PT field`}>{unmapped}</span>{/if}
			</Button>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger class="hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2" aria-label="More for this request" data-slot="request-more">
					<Ellipsis class="size-4" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end">
					<DropdownMenu.Item onSelect={() => void builder.flush().then(() => (duplicateOpen = true))} data-slot="request-duplicate">Duplicate…</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Item class="text-destructive" onSelect={() => (deleteOpen = true)} data-slot="request-delete">Delete draft…</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<IssueBar {builder} bind:revealed {onIssued} />
		</div>
	</div>
</header>
<SetupNotice />
{#if builder.data.state === 'error'}
	<div class="px-6 pt-3"><Notice tone="destructive" title="Could not read the project.">{' '}{builder.data.message}</Notice></div>
{/if}

<div class="flex min-h-0 flex-1 flex-col lg:flex-row">
	<ItemsPanel {builder} {marked} onFields={() => (fieldsOpen = true)} />
	{#if sidePanel.open}
		<aside class="border-border bg-muted/20 flex shrink-0 flex-col overflow-y-auto border-t lg:w-[26rem] lg:border-t-0 lg:border-l xl:w-[28rem] 2xl:w-[30rem]" aria-label="Details and vendors" data-slot="side-panel" data-state="open">
			<div class="flex items-center justify-between gap-2 px-5 pt-3">
				<span class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Details and vendors</span>
				<Button size="sm" variant="ghost" class="text-muted-foreground" onclick={() => (sidePanel.open = false)} title="Hide the details and vendors. The table takes the room." aria-expanded="true" data-slot="side-panel-toggle">
					<PanelRightClose data-icon="inline-start" />Hide
				</Button>
			</div>
			<div class="flex flex-col gap-6 px-5 pt-2 pb-4">
				<DetailsPanel form={builder.form} problems={readiness.problems} {revealed} onChange={(f) => builder.setForm(f)} />
				<div class="bg-border h-px shrink-0"></div>
				<VendorsPanel {builder} {revealed} />
			</div>
		</aside>
	{:else}
		<aside class="border-border bg-muted/20 flex shrink-0 items-center border-t px-3 py-2 lg:w-12 lg:flex-col lg:border-t-0 lg:border-l lg:px-0 lg:py-3" aria-label="Details and vendors, hidden" data-slot="side-panel" data-state="closed">
			<button
				type="button"
				class="hover:bg-accent focus-visible:ring-ring/50 text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-2 lg:flex-col lg:gap-3 lg:px-1.5 lg:py-2"
				onclick={() => (sidePanel.open = true)}
				title="Show the details and vendors"
				aria-expanded="false"
				data-slot="side-panel-toggle"
			>
				<PanelRightOpen class="size-4" aria-hidden="true" />
				<span class="lg:[writing-mode:vertical-rl]">Details and vendors</span>
				{#if sideProblems > 0}<span class="border-destructive/50 text-destructive rounded-full border px-1.5 text-xs leading-4 tabular-nums" title={`${sideProblems} to fix in the details or vendors`}>{sideProblems}</span>{/if}
			</button>
		</aside>
	{/if}
</div>

<FieldsDialog {builder} bind:open={fieldsOpen} />
<DuplicateRequest bind:open={duplicateOpen} projectId={builder.state.project.id} requestId={builder.state.id} name={builder.form.title} />
<DeleteRequest
	bind:open={deleteOpen}
	projectId={builder.state.project.id}
	requestId={builder.state.id}
	ondeleted={(gone) => {
		builder.discard();
		deletedNote.line = deletedLine(gone);
		void goto('/requests');
	}}
/>
