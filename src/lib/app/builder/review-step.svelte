<!--
	Step 7, Review: the draft as a vendor will get it (`vendor-sheet`), beside a rail with the
	counts, what still blocks it, and Issue. Issuing freezes the items; a change after that is a new
	round. Counts and blockers from `$lib/pure/request`.
-->
<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import VendorSheet from './vendor-sheet.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { blockers, summarize } from '$lib/pure/request';
	import type { StepKey } from '$lib/pure/steps';
	import { today } from '$lib/app/today';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, onPick, onIssued }: { builder: Builder; onPick: (key: StepKey) => void; onIssued: (id: string) => void } = $props();

	const request = $derived(builder.request());
	const counts = $derived(summarize(request));
	const blocked = $derived(blockers(builder.state, today()));
	const number = new Intl.NumberFormat();

	const FIX: Record<string, StepKey> = { 'Pick a project.': 'project', 'Pick at least one shot or asset.': 'shots', 'Every item is omitted.': 'items' };

	let confirming = $state(false);
	let issuing = $state(false);
	let issueError = $state<string | null>(null);

	async function issue(): Promise<void> {
		issuing = true;
		issueError = null;
		try {
			await builder.issue();
			onIssued(builder.state.id);
		} catch (error) {
			issueError = error instanceof Error ? error.message : String(error);
		} finally {
			issuing = false;
			confirming = false;
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div class="grid w-full items-start gap-6 px-6 py-6 xl:grid-cols-[16rem_minmax(0,1fr)]">
		<aside class="flex flex-col gap-5 xl:sticky xl:top-6" aria-label="Draft status" data-slot="review-rail">
			<dl class="grid grid-cols-2 gap-x-4 gap-y-3 xl:grid-cols-1">
				<div>
					<dt class="text-muted-foreground text-xs">Shots going out</dt>
					<dd class="text-2xl font-semibold tabular-nums">{counts.shots}</dd>
					{#if counts.shotsOmitted > 0}<dd class="text-muted-foreground text-xs">{counts.shotsOmitted} omitted</dd>{/if}
				</div>
				<div>
					<dt class="text-muted-foreground text-xs">Assets going out</dt>
					<dd class="text-2xl font-semibold tabular-nums">{counts.assets}</dd>
					{#if counts.assetsOmitted > 0}<dd class="text-muted-foreground text-xs">{counts.assetsOmitted} omitted</dd>{/if}
				</div>
				<div>
					<dt class="text-muted-foreground text-xs">Frames</dt>
					<dd class="text-lg font-semibold tabular-nums">{number.format(counts.frames)}</dd>
					{#if counts.shotsWithoutFrames > 0}<dd class="text-muted-foreground text-xs">{counts.shotsWithoutFrames} shots have no count</dd>{/if}
				</div>
				<div>
					<dt class="text-muted-foreground text-xs">Sequences</dt>
					<dd class="text-lg font-semibold tabular-nums">{counts.sequences}</dd>
				</div>
			</dl>

			{#if blocked.length > 0}
				<div class="border-warning/60 bg-warning/10 flex flex-col gap-2 rounded-lg border p-3 text-sm" role="alert" data-slot="review-blockers">
					<p class="flex items-center gap-2 font-medium"><TriangleAlert class="text-warning size-4" aria-hidden="true" />Not ready yet</p>
					<ul class="flex flex-col gap-1">
						{#each blocked as line (line)}
							<li>
								<button type="button" class="text-left underline decoration-current/40 underline-offset-2 hover:decoration-current" onclick={() => onPick(FIX[line] ?? 'details')}>{line}</button>
							</li>
						{/each}
					</ul>
				</div>
			{:else}
				<p class="flex items-center gap-2 text-sm" data-slot="review-ready"><CircleCheck class="text-success size-4" aria-hidden="true" />The draft is complete.</p>
			{/if}

			{#if builder.readOnly}
				<p class="text-muted-foreground text-sm">Issued. The items are frozen. A change is a new round.</p>
			{:else if confirming}
				<div class="border-border flex flex-col gap-2 rounded-lg border p-3 text-sm" data-slot="issue-confirm">
					<p>Issue the request? Its items freeze. Vendors you invite can open it. A change after this is a new round.</p>
					<div class="flex flex-wrap gap-2">
						<Button size="sm" onclick={() => void issue()} disabled={issuing}>{issuing ? 'Issuing…' : 'Issue'}</Button>
						<Button size="sm" variant="ghost" onclick={() => (confirming = false)}>Not yet</Button>
					</div>
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					<Button onclick={() => (confirming = true)} disabled={blocked.length > 0 || builder.saving.kind === 'waiting'} data-slot="issue">Issue the request</Button>
					<p class="text-muted-foreground text-xs">Saved as you go. Issue when the list is final.</p>
				</div>
			{/if}
			{#if issueError}<p class="text-destructive text-sm" role="alert">{issueError}</p>{/if}
		</aside>

		<VendorSheet {request} />
	</div>
</div>
