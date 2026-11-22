<!--
	Issue, always in sight in the page header, with what still stops it beside it. Pressing Issue
	when something is missing does not just refuse: it lists every problem, each a link that takes
	the person to the exact field or row and marks it, and every field shows its problem from then on.
	With nothing missing it asks once, then issues: each bid's rows copied, each vendor's link made
	and shown once on the page that follows. Words in `$lib/pure/readiness` and `$lib/pure/issue-words`.
-->
<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Send from '@lucide/svelte/icons/send';
	import Notice from '$lib/app/notice.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { api, type Invited } from '$lib/api';
	import { cn } from '$lib/utils.js';
	import { issueLine } from '$lib/pure/issue-words';
	import type { Target } from '$lib/pure/readiness';
	import { focusControl } from './focus';
	import { sidePanel } from '$lib/app/side-panel.svelte';
	import type { Builder } from '$lib/app/builder.svelte';

	let {
		builder,
		revealed = $bindable(new Set()),
		onIssued
	}: {
		builder: Builder;
		/** The problems shown on their fields whatever their state: `*` once Issue was pressed. */
		revealed?: ReadonlySet<string>;
		onIssued: (links: Invited[]) => void;
	} = $props();

	const readiness = $derived(builder.readiness);
	const toFix = $derived(readiness.toIssue);
	const warnings = $derived(readiness.problems.filter((p) => p.tone === 'warning' && !toFix.some((f) => f.id === p.id)));
	let listOpen = $state(false);
	let confirming = $state(false);
	let issuing = $state(false);
	let failure = $state<string | null>(null);

	function press(): void {
		failure = null;
		if (toFix.length > 0) {
			revealed = new Set([...revealed, '*']);
			listOpen = true;
			return;
		}
		confirming = true;
	}

	async function go(target: Target): Promise<void> {
		listOpen = false;
		revealed = new Set([...revealed, target]);
		if (target.startsWith('bid:')) builder.current = target.slice(4);
		// A row: the table takes its cursor there, the code cell open to type in.
		const row = /^row:(shot|asset):(.+)$/.exec(target);
		if (row) {
			builder.focusRow(row[1] as 'shot' | 'asset', row[2]);
			return;
		}
		// The details and the vendors are in the side panel: it opens to show the field.
		if (target !== 'title' && target !== 'items' && !target.startsWith('bid:')) sidePanel.open = true;
		await focusControl(target);
	}

	async function issue(): Promise<void> {
		issuing = true;
		failure = null;
		try {
			await builder.flush();
			if (builder.saving.kind === 'error') throw new Error(`The draft is not saved. ${builder.saving.message}`);
			const { links } = await api.issue(builder.state.project.id, builder.state.id);
			builder.discard();
			confirming = false;
			onIssued(links);
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			issuing = false;
		}
	}

	const vendors = $derived(builder.namedVendors.length);
</script>

<div class="flex items-center gap-2" data-slot="issue-bar">
	<Popover.Root bind:open={listOpen}>
		<Popover.Trigger
			class={cn(
				'focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm outline-none focus-visible:ring-3',
				toFix.length > 0 ? 'border-destructive/50 text-destructive hover:bg-destructive/10' : 'border-success/50 text-foreground hover:bg-success/10'
			)}
			data-slot="readiness-chip"
		>
			{#if toFix.length > 0}
				<CircleAlert class="size-4" aria-hidden="true" />{toFix.length === 1 ? '1 thing to fix' : `${toFix.length} things to fix`}
			{:else}
				<CircleCheck class="text-success size-4" aria-hidden="true" />Ready to issue
			{/if}
		</Popover.Trigger>
		<Popover.Content class="w-96 p-0" align="end" data-slot="readiness-list">
			{#if toFix.length > 0}
				<div class="border-border border-b px-4 py-3">
					<p class="text-sm font-semibold">Before you issue</p>
					<p class="text-muted-foreground text-xs">Each takes you to its field.</p>
				</div>
				<ul class="flex max-h-96 flex-col overflow-y-auto py-1">
					{#each toFix as p (p.id)}
						<li>
							<button type="button" class="hover:bg-accent flex w-full items-start gap-2 px-4 py-2 text-left text-sm" onclick={() => void go(p.target)} data-target={p.target} data-slot="readiness-item">
								<CircleAlert class="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />
								<span><span class="font-medium">{p.label}:</span> {p.message}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="px-4 py-3 text-sm">Ready. {issueLine(builder.bids.length, vendors)}</p>
			{/if}
			{#if warnings.length > 0}
				<ul class="border-border flex flex-col border-t py-1">
					{#each warnings as p (p.id)}
						<li><button type="button" class="hover:bg-accent w-full px-4 py-2 text-left text-sm" onclick={() => void go(p.target)}><span class="font-medium">{p.label}:</span> {p.message}</button></li>
					{/each}
				</ul>
			{/if}
		</Popover.Content>
	</Popover.Root>
	<Button onclick={press} data-slot="issue"><Send data-icon="inline-start" />Issue</Button>
</div>

<Dialog.Root bind:open={confirming}>
	<Dialog.Content class="sm:max-w-md" data-slot="issue-confirm">
		<Dialog.Header>
			<Dialog.Title>Issue {builder.form.title.trim() || 'the request'}?</Dialog.Title>
			<Dialog.Description>{issueLine(builder.bids.length, vendors)}</Dialog.Description>
		</Dialog.Header>
		<ul class="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
			<li>The rows go out as they are now. They stay as issued.</li>
			<li>The links show on the next page, once. Copy them or email them there.</li>
		</ul>
		{#if failure}<Notice tone="destructive" title="Not issued.">{' '}{failure}</Notice>{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (confirming = false)} disabled={issuing}>Not yet</Button>
			<Button onclick={() => void issue()} disabled={issuing} data-slot="issue-now">{issuing ? 'Issuing…' : 'Issue'}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
