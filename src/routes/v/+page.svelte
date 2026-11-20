<!--
	The vendor's bid, reached through the link production sent. No sign-in: the link cookie is the
	key. The request as production froze it, a price per shot and asset, the other costs, the
	rebate estimate and the terms, with live totals beside. Drafts save on their own. After a submit
	the bid is read only, and Revise opens the next version.

	The form logic is `$lib/pure/bid-form`; the calls are `$lib/vendor-client`.
-->
<script lang="ts">
	import { page } from '$app/state';
	import Link2Off from '@lucide/svelte/icons/link-2-off';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import Notice from '$lib/app/notice.svelte';
	import ConfirmDialog from '$lib/app/vendor/confirm-dialog.svelte';
	import CostsSection from '$lib/app/vendor/costs-section.svelte';
	import ItemGrid from '$lib/app/vendor/item-grid.svelte';
	import RebateSection from '$lib/app/vendor/rebate-section.svelte';
	import RequestSummary from '$lib/app/vendor/request-summary.svelte';
	import Section from '$lib/app/vendor/section.svelte';
	import TermsSection from '$lib/app/vendor/terms-section.svelte';
	import TotalsRail, { type SaveState, type Stage } from '$lib/app/vendor/totals-rail.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { decimalSeparator } from '$lib/pure/amount';
	import { emptyForm, formFromBid, formToDraft, formTotals, type BidForm } from '$lib/pure/bid-form';
	import { targetKey } from '$lib/pure/model';
	import { format, minorDigits } from '$lib/pure/money';
	import type { VendorBidView, VendorRequestView } from '$lib/pure/vendor-view';
	import { vendorApi, VendorError, type Loaded } from '$lib/vendor-client';

	const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'KRW', 'INR', 'CNY', 'SGD', 'CHF', 'SEK', 'DKK', 'NOK', 'ZAR'];
	const SAVE_AFTER_MS = 1200;
	const RETRY_AFTER_MS = 5000;

	const locale = typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US';
	const mark = decimalSeparator(locale);
	const dayFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
	const stampFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
	const day = (text: string) => (/^\d{4}-\d{2}-\d{2}$/.test(text) ? dayFormat.format(new Date(`${text}T00:00:00Z`)) : text);
	const today = () => {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	};

	let request = $state<VendorRequestView | null>(null);
	let view = $state<VendorBidView | null>(null);
	let form = $state<BidForm | null>(null);
	let problem = $state<{ title: string; line: string; link: boolean } | null>(null);

	const result = $derived(form ? formToDraft(form, mark) : null);
	const totals = $derived(result ? formTotals(result.draft) : null);
	const snapshot = $derived(result ? JSON.stringify(result.draft) : '');
	const prices = $derived(new Map(result ? result.draft.lines.filter((l) => !l.excluded).map((l) => [targetKey(l.target), l.total]) : []));
	const stage = $derived<Stage>(
		request?.status === 'closed' ? 'closed' : view?.bid?.status === 'submitted' ? 'submitted' : view?.bid?.status === 'withdrawn' ? 'withdrawn' : 'draft'
	);
	const readOnly = $derived(stage !== 'draft');
	const earlier = $derived(view?.bid?.status === 'draft' ? view.versions.filter((v) => v.status === 'submitted').at(-1) : undefined);
	const loaded = $derived<Loaded | null>(request ? { invitationId: request.invitationId, bidId: view?.bid?.id ?? null } : null);
	const currencies = $derived(request ? [...new Set([request.header.baseCurrency, ...CURRENCIES, form?.currency ?? 'USD'])] : CURRENCIES);

	// Autosave: the draft as last saved, and whether a save is under way.
	let saved = $state('');
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let retry = $state(0);
	const dirty = $derived(!readOnly && snapshot !== '' && snapshot !== saved);
	const saveState = $derived<SaveState>(
		saving ? { kind: 'saving' } : saveError ? { kind: 'error', message: saveError } : dirty ? { kind: 'unsaved' } : view?.bid ? { kind: 'saved' } : { kind: 'idle' }
	);

	function fill(next: VendorBidView, req: VendorRequestView): void {
		view = next;
		form = next.bid ? formFromBid(next.bid, req, mark) : emptyForm(req, today());
		saved = JSON.stringify(formToDraft(form, mark).draft);
	}

	async function load(): Promise<void> {
		const link = page.url.searchParams.get('link');
		if (link === 'invalid') {
			problem = { title: 'This link does not work', line: 'Check the link in your invitation, or ask production for a new one.', link: true };
			return;
		}
		if (link === 'wait') {
			problem = { title: 'Too many tries', line: 'Wait a few minutes, then open the link again.', link: true };
			return;
		}
		try {
			const [req, bid] = await Promise.all([vendorApi.request(), vendorApi.bid()]);
			request = req;
			fill(bid, req);
		} catch (error) {
			const status = error instanceof VendorError ? error.status : 0;
			const line = error instanceof Error ? error.message : String(error);
			if (status === 410) problem = { title: 'This link was replaced', line, link: true };
			else if (status === 401 || status === 403) problem = { title: status === 401 ? 'This link does not work' : 'This link is closed', line, link: true };
			else problem = { title: 'The bid could not load', line, link: false };
		}
	}
	void load();

	/** The browser now holds another vendor's link: this page stops, and says so. */
	function otherSession(error: unknown): boolean {
		if (!(error instanceof VendorError) || error.reason !== 'session') return false;
		problem = { title: 'Another bid is open in this browser', line: error.message, link: false };
		return true;
	}

	async function save(text: string, keepalive = false): Promise<boolean> {
		if ((saving && !keepalive) || !loaded) return false;
		saving = true;
		try {
			view = await vendorApi.save(loaded, JSON.parse(text), keepalive);
			saved = text;
			saveError = null;
			return true;
		} catch (error) {
			if (otherSession(error)) return false;
			saveError = error instanceof Error ? error.message : String(error);
			return false;
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		if (!dirty || saving) return;
		const text = snapshot;
		void retry;
		const timer = setTimeout(
			async () => {
				if (!(await save(text))) setTimeout(() => retry++, RETRY_AFTER_MS);
			},
			saveError ? 0 : SAVE_AFTER_MS
		);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		const hidden = () => {
			if (document.visibilityState === 'hidden' && dirty) void save(snapshot, true);
		};
		const leaving = (event: BeforeUnloadEvent) => {
			if (dirty) event.preventDefault();
		};
		document.addEventListener('visibilitychange', hidden);
		addEventListener('beforeunload', leaving);
		return () => {
			document.removeEventListener('visibilitychange', hidden);
			removeEventListener('beforeunload', leaving);
		};
	});

	// Submit, withdraw, revise.
	let confirming = $state<'submit' | 'withdraw' | null>(null);
	let busy = $state(false);
	let moveError = $state<string | null>(null);

	async function openSubmit(): Promise<void> {
		moveError = null;
		if (dirty && !(await save(snapshot))) return;
		confirming = 'submit';
	}

	async function move(action: () => Promise<VendorBidView>): Promise<void> {
		if (!request) return;
		busy = true;
		moveError = null;
		try {
			fill(await action(), request);
			confirming = null;
			document.querySelector('[data-slot=vendor-scroll]')?.scrollTo({ top: 0 });
		} catch (error) {
			if (otherSession(error)) return;
			moveError = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	const stamp = $derived.by(() => {
		const at = view?.bid?.withdrawnAt ?? view?.bid?.submittedAt;
		return at ? `on ${stampFormat.format(new Date(at))}` : null;
	});

	function changeCurrency(next: string): void {
		if (!form) return;
		minorDigits(next);
		form.currency = next;
	}
</script>

<svelte:head>
	<title>{request ? `Bid for ${request.header.project}` : 'Your bid'} · SG Bids</title>
	<meta name="referrer" content="no-referrer" />
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#if problem}
	<PageState state={problem.link ? 'empty' : 'error'} icon={problem.link ? Link2Off : undefined} title={problem.title} line={problem.line}>
		{#snippet action()}
			{#if !problem?.link}<Button variant="outline" onclick={() => location.reload()}>Try again</Button>{/if}
		{/snippet}
	</PageState>
{:else if !request || !form || !result || !totals}
	<PageState state="loading" title="Opening the bid request" />
{:else}
	{@const header = request.header}
	<PageHeader title={`Bid for ${header.project}`}>
		{#snippet context()}
			<span>
				<span class="text-foreground font-semibold" data-slot="vendor-name">{request?.vendorName}</span>.
				Request {request?.code}, round {header.round}.
				{#if header.dueDate}Due <span class="text-foreground font-medium">{day(header.dueDate)}</span>.{/if}
				{#if view?.bid}Version {view.bid.version}.{/if}
			</span>
		{/snippet}
		{#snippet actions()}
			<label class="text-muted-foreground flex items-center gap-2 text-sm">
				Your currency
				{#if readOnly}
					<span class="text-foreground font-medium">{form?.currency}</span>
				{:else}
					<select
						class="border-input dark:bg-input/30 text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-lg border bg-transparent px-2 text-sm outline-none focus-visible:ring-3"
						value={form?.currency}
						onchange={(e) => changeCurrency(e.currentTarget.value)}
					>
						{#each currencies as code (code)}<option value={code}>{code}</option>{/each}
					</select>
				{/if}
			</label>
		{/snippet}
		{#if stage === 'submitted'}
			<Notice tone="info" title="Submitted. ">Production can see this bid. To change it, revise it and submit again.</Notice>
		{:else if stage === 'withdrawn'}
			<Notice tone="warning" title="Withdrawn. ">Production sees this bid as withdrawn. Start a new version to bid again.</Notice>
		{:else if stage === 'closed'}
			<Notice tone="info" title="Closed. ">This request no longer takes bids.</Notice>
		{:else if earlier}
			<Notice tone="info">Production sees version {earlier.version} until you submit this one.</Notice>
		{/if}
	</PageHeader>

	<div class="flex min-h-0 flex-1">
		<div class="min-w-0 flex-1 overflow-y-auto" data-slot="vendor-scroll">
			<div class="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-6 pb-28 sm:px-6 lg:pb-10">
				<Section id="request" title="The request" note="As production sent it.">
					<RequestSummary {request} {day} />
				</Section>

				<Section
					id="items"
					title="Shots and assets"
					note={readOnly ? undefined : 'A price for each, all in. Leave one blank to not bid it, or exclude what you will not do.'}
				>
					<ItemGrid bind:form {request} errors={result.errors} {prices} {mark} {locale} {readOnly} />
				</Section>

				<Section id="costs" title="Other costs, discount and tax" note="Costs that sit outside the shots and assets.">
					<CostsSection bind:form errors={result.errors} {readOnly} />
				</Section>

				<Section id="rebate" title="Tax rebate" note="Optional. Where the work is done, for an estimate. You still quote gross.">
					<RebateSection bind:form errors={result.errors} estimate={totals.rebate} {locale} {day} {readOnly} />
				</Section>

				<Section id="terms" title="Terms">
					<TermsSection bind:form errors={result.errors} {readOnly} {day} />
				</Section>

				<TotalsRail
					class="bg-card rounded-lg border lg:hidden"
					{totals}
					{result}
					baseCurrency={header.baseCurrency}
					{locale}
					save={saveState}
					{stage}
					{stamp}
					{busy}
					onsubmit={openSubmit}
					onrevise={() => loaded && move(() => vendorApi.revise(loaded))}
					onwithdraw={() => ((moveError = null), (confirming = 'withdraw'))}
				/>
			</div>
		</div>

		<aside class="bg-card hidden w-80 shrink-0 overflow-y-auto border-l lg:block" aria-label="Totals">
			<TotalsRail
				{totals}
				{result}
				baseCurrency={header.baseCurrency}
				{locale}
				save={saveState}
				{stage}
				{stamp}
				{busy}
				onsubmit={openSubmit}
				onrevise={() => loaded && move(() => vendorApi.revise(loaded))}
				onwithdraw={() => ((moveError = null), (confirming = 'withdraw'))}
			/>
		</aside>
	</div>

	<div class="bg-background/95 fixed inset-x-0 bottom-0 flex items-center gap-3 border-t px-4 py-2 backdrop-blur lg:hidden" data-slot="mobile-total">
		<div class="flex min-w-0 flex-1 flex-col">
			<span class="text-muted-foreground text-xs">Your total</span>
			<span class="truncate font-semibold tabular-nums">{format(totals.totals.grand.bid, locale)}</span>
		</div>
		<span class="text-muted-foreground text-xs">{stage !== 'draft' || saveState.kind === 'idle' ? '' : saveState.kind === 'saved' ? 'Saved' : saveState.kind === 'saving' ? 'Saving' : 'Not saved'}</span>
	</div>

	<ConfirmDialog
		open={confirming === 'submit'}
		title="Submit your bid"
		confirm="Submit bid"
		{busy}
		error={moveError}
		oncancel={() => (confirming = null)}
		onconfirm={() => loaded?.bidId && move(() => vendorApi.submit(loaded))}
	>
		<dl class="flex flex-col">
			<div class="flex justify-between gap-3 py-1"><dt class="text-muted-foreground">Priced</dt><dd class="tabular-nums">{result.counts.priced}</dd></div>
			{#if result.counts.excluded > 0}<div class="flex justify-between gap-3 py-1"><dt class="text-muted-foreground">Excluded</dt><dd class="tabular-nums">{result.counts.excluded}</dd></div>{/if}
			{#if result.counts.open > 0}<div class="flex justify-between gap-3 py-1"><dt class="text-muted-foreground">Not bid</dt><dd class="tabular-nums">{result.counts.open}</dd></div>{/if}
			<div class="flex justify-between gap-3 border-t pt-2 font-semibold"><dt>Total</dt><dd class="tabular-nums">{format(totals.totals.grand.bid, locale)}</dd></div>
		</dl>
		{#each result.warnings as warning (warning)}<Notice tone="warning">{warning}</Notice>{/each}
		<div class="flex flex-col gap-1">
			<p class="font-medium">What happens next</p>
			<p class="text-muted-foreground">Production sees your bid and its total. It is final once sent. To change it later, revise it and submit again. Production then sees the new version.</p>
		</div>
	</ConfirmDialog>

	<ConfirmDialog
		open={confirming === 'withdraw'}
		title="Withdraw your bid"
		confirm="Withdraw bid"
		tone="destructive"
		{busy}
		error={moveError}
		oncancel={() => (confirming = null)}
		onconfirm={() => loaded?.bidId && move(() => vendorApi.withdraw(loaded))}
	>
		<p>Production will see this bid as withdrawn. You can start a new version after.</p>
	</ConfirmDialog>
{/if}
