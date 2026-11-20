<!--
	The last look before the issue: the request as a vendor will get it (`vendor-sheet`), with what
	still stops the issue named above it, each a link back to its control. Issue asks once more in a
	dialog: the items freeze, and a change after is a new round. An issued request shows the sheet
	only. Problems from `$lib/pure/readiness`, counts from `$lib/pure/request`.
-->
<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Notice from '$lib/app/notice.svelte';
	import VendorSheet from './vendor-sheet.svelte';
	import MatchLine from './match-line.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { Target } from '$lib/pure/readiness';
	import { summarize } from '$lib/pure/request';
	import type { Builder } from '$lib/app/builder.svelte';

	let {
		builder,
		confirming = $bindable(false),
		onFocus,
		onIssued
	}: { builder: Builder; confirming?: boolean; onFocus: (target: Target) => void; onIssued: (id: string) => void } = $props();

	const request = $derived(builder.request());
	const counts = $derived(summarize(request));
	const blocking = $derived(builder.readiness.toIssue);
	const number = new Intl.NumberFormat();
	const plural = (n: number, word: string) => `${number.format(n)} ${word}${n === 1 ? '' : 's'}`;
	const goingOut = $derived([plural(counts.shots, 'shot'), plural(counts.frames, 'frame'), plural(counts.assets, 'asset')].join(', '));

	let issuing = $state(false);
	let issueError = $state<string | null>(null);

	async function issue(): Promise<void> {
		issuing = true;
		issueError = null;
		try {
			await builder.issue();
			confirming = false;
			onIssued(builder.state.id);
		} catch (error) {
			issueError = error instanceof Error ? error.message : String(error);
		} finally {
			issuing = false;
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div class="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-6">
		{#if !builder.readOnly}
			{#if blocking.length > 0}
				<div class="border-destructive/50 bg-destructive/10 flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm" role="alert" data-slot="review-blockers">
					<p class="font-medium">{blocking.length === 1 ? 'One thing to fix before you issue:' : `${blocking.length} things to fix before you issue:`}</p>
					<ul class="flex flex-col gap-1">
						{#each blocking as p (p.id)}
							<li>
								<button
									type="button"
									class="text-left underline decoration-current/40 underline-offset-2 hover:decoration-current"
									data-target={p.target}
									onclick={() => onFocus(p.target)}
								>
									<span class="font-medium">{p.label}:</span>
									{p.message}
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{:else}
				<p class="flex items-center gap-2 text-sm" data-slot="review-ready">
					<CircleCheck class="text-success size-4" aria-hidden="true" />Ready to issue. {goingOut} go out.
				</p>
			{/if}
		{/if}
		{#if builder.readOnly}<MatchLine {builder} />{/if}
		<VendorSheet {request} />
	</div>
</div>

<Dialog.Root bind:open={confirming}>
	<Dialog.Content class="sm:max-w-md" data-slot="issue-confirm">
		<Dialog.Header>
			<Dialog.Title>Issue {request.header.code ?? 'the request'}, round {request.header.round}?</Dialog.Title>
			<Dialog.Description>{goingOut} go out.</Dialog.Description>
		</Dialog.Header>
		<ul class="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
			<li>The items freeze. A change after this is a new round with the same code.</li>
			<li>Vendors you invite on the request page can open it.</li>
		</ul>
		{#if issueError}<Notice tone="destructive" title="Not issued.">{' '}{issueError}</Notice>{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (confirming = false)} disabled={issuing}>Not yet</Button>
			<Button onclick={() => void issue()} disabled={issuing || blocking.length > 0} data-slot="issue-now">{issuing ? 'Issuing…' : 'Issue'}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
