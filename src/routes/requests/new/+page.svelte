<!--
	The send flow: a request made from bids, in four steps on one page. Bids: the bids it is made from,
	read as they are now, in order, one more added or one taken out. Details: what every bid shares,
	the common header. Vendors: who it goes to, each invited to every bid or to some; a vendor's link
	is made at the issue. Review: what goes out and to whom, what still stops it, then Issue, which
	copies each bid's rows into the request and shows each vendor's link once. The URL holds the
	draft and the step. The draft is stored at once; its header as it changes. State in
	`$lib/app/request/send.svelte`, rules in `$lib/pure/readiness` and `$lib/pure/request-bids`.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Check from '@lucide/svelte/icons/check';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Layers from '@lucide/svelte/icons/layers';
	import Send from '@lucide/svelte/icons/send';
	import Users from '@lucide/svelte/icons/users';
	import X from '@lucide/svelte/icons/x';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import Section from '$lib/app/section.svelte';
	import HeaderPanel from '$lib/app/builder/header-panel.svelte';
	import VendorSheet from '$lib/app/builder/vendor-sheet.svelte';
	import InviteForm from '$lib/app/request/invite-form.svelte';
	import LinkOnce from '$lib/app/request/link-once.svelte';
	import VendorBidsDialog from '$lib/app/request/vendor-bids-dialog.svelte';
	import { SendFlow, STEPS, type Step } from '$lib/app/request/send.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import ListPicker from '$lib/components/list-picker.svelte';
	import type { InvitationView } from '$lib/api';
	import { bidHref } from '$lib/pure/bid-list';
	import { vendorLink } from '$lib/pure/invitations';
	import { packageStats } from '$lib/pure/packages';
	import { controlId, type Target } from '$lib/pure/readiness';
	import { buildRequest } from '$lib/pure/request';
	import { cn } from '$lib/utils.js';

	function open(): SendFlow {
		const params = page.url.searchParams;
		const bids = (params.get('bids') ?? '').split(',').filter(Boolean);
		const flow = new SendFlow({ id: params.get('id'), bids });
		flow.onStored = (id) => {
			const url = new URL(page.url);
			url.searchParams.delete('bids');
			url.searchParams.set('id', id);
			void goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
		};
		return flow;
	}

	const flow = open();
	const step = $derived<Step>((STEPS.find((s) => s.step === page.url.searchParams.get('step'))?.step ?? 'bids') as Step);
	const at = $derived(STEPS.findIndex((s) => s.step === step));
	let revealed = $state<ReadonlySet<string>>(new Set());
	let folds = $state({ delivery: true, assumptions: true });
	let confirming = $state(false);
	let issuing = $state(false);
	let issueError = $state<string | null>(null);
	/** The links copied and put away, on the issued screen. */
	let done = $state<ReadonlySet<string>>(new Set());

	// A draft that is issued already goes to its page.
	$effect(() => {
		const loaded = flow.loaded;
		if (loaded && loaded.status !== 'draft' && !untrack(() => flow.issued)) void goto(`/requests/${loaded.request.id}?project=${flow.project?.id}`, { replaceState: true });
	});

	function go(next: Step): void {
		const url = new URL(page.url);
		url.searchParams.set('step', next);
		void goto(`${url.pathname}${url.search}`, { noScroll: false, keepFocus: true });
	}

	const readiness = $derived(flow.readiness);
	const problemsAt = (s: Step) =>
		readiness.toIssue.filter((p) => (s === 'bids' ? p.target === 'bids' || p.target === 'items' : s === 'vendors' ? p.target === 'vendors' : s === 'details' ? p.target !== 'bids' && p.target !== 'items' && p.target !== 'vendors' && p.target !== 'project' : false));

	async function focusOn(target: Target): Promise<void> {
		if (target === 'bids' || target === 'items') return go('bids');
		if (target === 'vendors') return go('vendors');
		revealed = new Set([...revealed, target]);
		if (step !== 'details') go('details');
		setTimeout(() => document.getElementById(controlId(target))?.querySelector<HTMLElement>('input, button, textarea')?.focus(), 50);
	}

	function next(): void {
		if (step === 'details') revealed = new Set(['*']);
		if (at < STEPS.length - 1) go(STEPS[at + 1].step);
	}

	async function issue(): Promise<void> {
		issuing = true;
		issueError = null;
		try {
			await flow.issue();
			confirming = false;
		} catch (error) {
			issueError = error instanceof Error ? error.message : String(error);
		} finally {
			issuing = false;
		}
	}

	// A vendor's bids, changed in its dialog.
	let editing = $state<InvitationView | null>(null);
	let editingOpen = $state(false);
	function editBids(inv: InvitationView): void {
		editing = inv;
		editingOpen = true;
	}

	const request = $derived(flow.loaded ? buildRequest({ id: flow.loaded.request.id, project: flow.project, form: flow.form, shots: flow.loaded.request.shots, assets: flow.loaded.request.assets, packages: flow.loaded.request.packages }) : null);
	const packages = $derived(flow.loaded?.request.packages ?? []);
	const stats = $derived(flow.loaded ? packageStats(flow.loaded.request) : new Map());
	const vendors = $derived(flow.loaded?.invitations ?? []);
	const addable = $derived(flow.projectBids.filter((b) => !flow.bids.some((x) => x.id === b.id)).map((b) => ({ code: b.id, label: b.name })));
	const counts = $derived(new Map(flow.projectBids.map((b) => [b.id, `${b.shots} shots, ${b.assets} assets`])));
	const title = $derived(flow.form.title.trim() || 'New request');
	const number = new Intl.NumberFormat();
	const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
	const plural = (n: number, word: string) => `${number.format(n)} ${word}${n === 1 ? '' : 's'}`;
	function bidsOf(inv: InvitationView): string {
		if (!inv.vendor.packages) return packages.length === 1 ? (packages[0]?.name ?? 'The bid') : 'Every bid';
		const names = inv.vendor.packages.flatMap((k) => packages.find((p) => p.id === k)?.name ?? []);
		return names.length === 0 ? 'No bid' : names.join(', ');
	}
</script>

<svelte:head><title>{title} · SG Bids</title></svelte:head>

{#await flow.ready}
	<PageState state="loading" title="Opening the request…" />
{:then}
	{#if flow.problem}
		<PageState state="empty" title="Not connected" line={flow.problem}>
			{#snippet action()}<Button href="/connect">Connect</Button>{/snippet}
		</PageState>
	{:else if flow.issued}
		{@const issued = flow.issued}
		<PageHeader measure="wide" title={`${issued.request.header.code ?? 'The request'} is issued`} back={{ href: '/requests', label: 'Requests' }} context={`${plural(issued.request.packages?.length ?? 1, 'bid')} went out to ${plural(issued.links.length, 'vendor')}. The bids can change now: what went out stays as it was.`}>
			{#snippet actions()}
				<Button href={`/requests/${issued.request.id}?project=${flow.project?.id}`} data-slot="open-issued">Open the request</Button>
			{/snippet}
		</PageHeader>
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-6">
			<div class="mx-auto flex w-full max-w-6xl flex-col gap-4 py-6" data-slot="issued-links">
				{#if issued.links.length === 0}
					<Notice tone="info">No vendor was added. Invite one on the request's page.</Notice>
				{/if}
				{#each issued.links.filter((l) => !done.has(l.invitation.id)) as l (l.invitation.id)}
					<LinkOnce name={l.invitation.name} link={vendorLink(location.origin, l.token)} onDone={() => (done = new Set([...done, l.invitation.id]))} />
				{/each}
				{#if issued.links.length > 0 && issued.links.every((l) => done.has(l.invitation.id))}
					<Notice tone="info">Every link is put away. A lost one is made again with New link on the request's page.</Notice>
				{/if}
			</div>
		</div>
	{:else if flow.loaded}
		<PageHeader measure="wide" {title} back={{ href: '/requests', label: 'Requests' }}>
			{#snippet context()}
				<span class="text-foreground">{flow.project?.name}</span>
				<span class="text-foreground font-mono text-xs">{flow.form.code}</span>
				<span>Round {flow.form.round || '1'}</span>
				<span data-slot="save-line" role="status">
					{#if flow.saving.kind === 'saving'}Saving…{:else if flow.saving.kind === 'saved'}Saved {time.format(flow.saving.at)}{:else if flow.saving.kind === 'error'}<span class="text-destructive">Not saved. {flow.saving.message}</span>{:else}Draft{/if}
				</span>
			{/snippet}
			{#snippet actions()}
				{#if at > 0}<Button variant="outline" onclick={() => go(STEPS[at - 1].step)} data-slot="step-back"><ArrowLeft data-icon="inline-start" />Back</Button>{/if}
				{#if step === 'review'}
					<Button onclick={() => (confirming = true)} disabled={!readiness.canIssue || flow.busy} data-slot="issue"><Send data-icon="inline-start" />Issue the request</Button>
				{:else}
					<Button onclick={next} data-slot="step-next">Next: {STEPS[at + 1].label}<ArrowRight data-icon="inline-end" /></Button>
				{/if}
			{/snippet}
			<ol class="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Steps" data-slot="steps">
				{#each STEPS as s, i (s.step)}
					{@const left = problemsAt(s.step).length}
					{@const on = s.step === step}
					<li class="flex items-center gap-1">
						{#if i > 0}<span class="bg-border mx-1 h-px w-6" aria-hidden="true"></span>{/if}
						<button
							type="button"
							class={cn(
								'focus-visible:ring-ring flex h-8 items-center gap-2 rounded-full border px-3 text-sm outline-none focus-visible:ring-2',
								on ? 'border-primary bg-primary/5 text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground hover:bg-muted border-transparent'
							)}
							aria-current={on ? 'step' : undefined}
							onclick={() => go(s.step)}
							data-step={s.step}
						>
							<span class={cn('flex size-5 items-center justify-center rounded-full border text-xs tabular-nums', i < at && left === 0 && 'border-success text-success')}>
								{#if i < at && left === 0}<Check class="size-3" aria-hidden="true" />{:else}{i + 1}{/if}
							</span>
							{s.label}
							{#if left > 0 && (i < at || s.step === 'review')}<span class="text-destructive text-xs">{left} to fix</span>{/if}
						</button>
					</li>
				{/each}
			</ol>
			{#if flow.failure}<Notice tone="destructive">{flow.failure}</Notice>{/if}
		</PageHeader>

		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-6" data-slot="send-body">
			<div class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 py-6">
				{#if step === 'bids'}
					<Section title="The bids it is made from" meta="Read as they are now. Issuing copies them.">
						{#snippet actions()}
							{#if addable.length > 0}
								<div class="w-72">
									<ListPicker options={addable} value={null} searchable={addable.length > 8} clearable={false} placeholder="Add a bid of the project" secondary={(o) => counts.get(o.code) ?? ''} onValueChange={(v) => v && void flow.addBid(v)} />
								</div>
							{/if}
						{/snippet}
						{#if flow.bids.length === 0}
							<div class="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center" data-slot="no-bids">
								<span class="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full border"><Layers class="size-5" aria-hidden="true" /></span>
								<p class="text-base font-semibold">No bid in the request</p>
								<p class="text-muted-foreground max-w-md text-sm">Add a bid of the project above, or tick bids on the Bids page.</p>
								<Button variant="outline" href="/bids">Go to Bids</Button>
							</div>
						{:else}
							<div class="overflow-x-auto rounded-lg border">
								<table class="w-full min-w-[44rem] border-separate border-spacing-0 text-sm" data-slot="send-bids">
									<thead>
										<tr>
											<th class="text-muted-foreground border-border h-9 w-12 border-b px-3 text-left text-xs font-medium">#</th>
											<th class="text-muted-foreground border-border h-9 border-b px-3 text-left text-xs font-medium">Bid</th>
											<th class="text-muted-foreground border-border h-9 w-24 border-b px-3 text-right text-xs font-medium">Shots</th>
											<th class="text-muted-foreground border-border h-9 w-28 border-b px-3 text-right text-xs font-medium">Frames</th>
											<th class="text-muted-foreground border-border h-9 w-24 border-b px-3 text-right text-xs font-medium">Assets</th>
											<th class="text-muted-foreground border-border h-9 w-56 border-b px-3 text-right text-xs font-medium"><span class="sr-only">Actions</span></th>
										</tr>
									</thead>
									<tbody>
										{#each flow.bids as b, i (b.id)}
											<tr data-bid={b.id}>
												<td class="border-border text-muted-foreground border-b px-3 py-2 tabular-nums">{i + 1}</td>
												<td class="border-border border-b px-3 py-2">
													<a class="font-medium underline-offset-2 hover:underline" href={bidHref({ id: b.id, projectId: flow.project!.id })}>{b.name}</a>
												</td>
												<td class="border-border border-b px-3 py-2 text-right tabular-nums">{number.format(b.shots)}</td>
												<td class="border-border border-b px-3 py-2 text-right tabular-nums">{number.format(b.frames)}</td>
												<td class="border-border border-b px-3 py-2 text-right tabular-nums">{number.format(b.assets)}</td>
												<td class="border-border border-b px-3 py-1 text-right whitespace-nowrap">
													<Button size="icon-sm" variant="ghost" aria-label={`Move ${b.name} up`} disabled={i === 0 || flow.busy} onclick={() => void flow.moveBid(b.id, -1)}><ArrowUp /></Button>
													<Button size="icon-sm" variant="ghost" aria-label={`Move ${b.name} down`} disabled={i === flow.bids.length - 1 || flow.busy} onclick={() => void flow.moveBid(b.id, 1)}><ArrowDown /></Button>
													<Button size="sm" variant="ghost" class="hover:text-destructive" disabled={flow.busy} onclick={() => void flow.removeBid(b.id)} data-slot="remove-bid"><X data-icon="inline-start" />Take out</Button>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
							{#each problemsAt('bids') as p (p.id)}
								<Notice tone="destructive" title={`${p.label}:`}>{' '}{p.message}</Notice>
							{/each}
							<p class="text-muted-foreground text-xs">A vendor answers each bid on its own: row by row or as one figure, or not at all. Figures common to the request, such as overhead and discount, are given once.</p>
						{/if}
					</Section>
				{:else if step === 'details'}
					<div class="w-full">
						<HeaderPanel form={flow.form} problems={readiness.problems} suggestedCode={flow.suggestedCode} onChange={(f) => flow.setForm(f)} bind:folds {revealed} />
					</div>
				{:else if step === 'vendors'}
					<div class="flex w-full flex-1 flex-col gap-4">
						<InviteForm projectId={flow.project!.id} requestId={flow.id!} pending onInvited={() => void flow.vendorAdded()} {packages} {stats} />
						{#if vendors.length === 0}
							<div class="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center" data-slot="no-vendors">
								<span class="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full border"><Users class="size-5" aria-hidden="true" /></span>
								<p class="text-base font-semibold">No vendor yet</p>
								<p class="text-muted-foreground max-w-md text-sm">Add the vendors that compete for this work. Each gets one link at the issue and answers the bids it is invited to.</p>
							</div>
						{:else}
							<div class="overflow-x-auto rounded-lg border">
								<table class="w-full min-w-[40rem] border-separate border-spacing-0 text-sm" data-slot="send-vendors">
									<thead>
										<tr>
											<th class="text-muted-foreground border-border h-9 border-b px-3 text-left text-xs font-medium">Vendor</th>
											<th class="text-muted-foreground border-border h-9 border-b px-3 text-left text-xs font-medium">Bids it answers</th>
											<th class="text-muted-foreground border-border h-9 w-40 border-b px-3 text-right text-xs font-medium"><span class="sr-only">Actions</span></th>
										</tr>
									</thead>
									<tbody>
										{#each vendors as inv (inv.vendor.id)}
											<tr data-vendor={inv.vendor.name}>
												<td class="border-border border-b px-3 py-2">
													<span class="flex flex-col">
														<span class="font-medium">{inv.vendor.name}</span>
														<span class="text-muted-foreground text-xs">{inv.vendor.email}{inv.vendor.fpt ? ', linked to a Flow PT Group' : ''}</span>
													</span>
												</td>
												<td class="border-border border-b px-3 py-2">
													{#if packages.length > 1}
														<button type="button" class="hover:text-foreground inline-flex items-center gap-1.5 text-left underline-offset-2 hover:underline" onclick={() => editBids(inv)} data-slot="vendor-bids">
															<Layers class="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />{bidsOf(inv)}
														</button>
													{:else}
														{bidsOf(inv)}
													{/if}
												</td>
												<td class="border-border border-b px-3 py-1 text-right">
													{#if inv.state.kind === 'pending'}
														<Button size="sm" variant="ghost" class="hover:text-destructive" disabled={flow.busy} onclick={() => void flow.removeVendor(inv.vendor.id)} data-slot="remove-vendor">Remove</Button>
													{:else}
														<span class="text-muted-foreground text-xs">Link given before</span>
													{/if}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
							{#each problemsAt('vendors') as p (p.id)}
								<Notice tone="destructive" title={`${p.label}:`}>{' '}{p.message}</Notice>
							{/each}
						{/if}
					</div>
				{:else if request}
					<div class="flex w-full flex-col gap-5">
						{#if readiness.toIssue.length > 0}
							<div class="border-destructive/50 bg-destructive/10 flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm" role="alert" data-slot="review-blockers">
								<p class="font-medium">{readiness.toIssue.length === 1 ? 'One thing to fix before you issue:' : `${readiness.toIssue.length} things to fix before you issue:`}</p>
								<ul class="flex flex-col gap-1">
									{#each readiness.toIssue as p (p.id)}
										<li>
											<button type="button" class="text-left underline decoration-current/40 underline-offset-2 hover:decoration-current" data-target={p.target} onclick={() => void focusOn(p.target)}>
												<span class="font-medium">{p.label}:</span>
												{p.message}
											</button>
										</li>
									{/each}
								</ul>
							</div>
						{:else}
							<p class="flex items-center gap-2 text-sm" data-slot="review-ready">
								<CircleCheck class="text-success size-4" aria-hidden="true" />Ready to issue. {plural(flow.bids.length, 'bid')} go out to {plural(vendors.length, 'vendor')}.
							</p>
						{/if}
						<Section title="Who gets what" card>
							<ul class="flex flex-col gap-1.5 text-sm" data-slot="review-vendors">
								{#each vendors as inv (inv.vendor.id)}
									<li class="flex flex-wrap gap-x-2"><span class="font-medium">{inv.vendor.name}</span><span class="text-muted-foreground">{bidsOf(inv)}</span></li>
								{/each}
								{#if vendors.length === 0}<li class="text-muted-foreground">No vendor yet.</li>{/if}
							</ul>
						</Section>
						<VendorSheet {request} />
					</div>
				{/if}
			</div>
		</div>

		<Dialog.Root bind:open={confirming}>
			<Dialog.Content class="sm:max-w-md" data-slot="issue-confirm">
				<Dialog.Header>
					<Dialog.Title>Issue {flow.form.code || 'the request'}, round {flow.form.round || '1'}?</Dialog.Title>
					<Dialog.Description>{plural(flow.bids.length, 'bid')} go out to {plural(vendors.length, 'vendor')}.</Dialog.Description>
				</Dialog.Header>
				<ul class="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
					<li>Each bid's rows are copied into the request as they are now. A bid can change after: what went out stays.</li>
					<li>Each vendor's link shows once, on the next screen.</li>
				</ul>
				{#if issueError}<Notice tone="destructive" title="Not issued.">{' '}{issueError}</Notice>{/if}
				<Dialog.Footer>
					<Button variant="outline" onclick={() => (confirming = false)} disabled={issuing}>Not yet</Button>
					<Button onclick={() => void issue()} disabled={issuing || !readiness.canIssue} data-slot="issue-now">{issuing ? 'Issuing…' : 'Issue'}</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>

		{#if editing}
			<VendorBidsDialog
				bind:open={editingOpen}
				vendor={editing.vendor.name}
				{packages}
				{stats}
				value={editing.vendor.packages ?? null}
				busy={flow.busy}
				error={flow.failure}
				onSave={(value) => void flow.setVendorBids(editing!.vendor.id, value).then(() => !flow.failure && (editingOpen = false))}
			/>
		{/if}
	{/if}
{:catch error}
	<PageState state="error" title="Could not open the request" line={error.message}>
		{#snippet action()}<Button href="/bids">Bids</Button>{/snippet}
	</PageState>
{/await}
