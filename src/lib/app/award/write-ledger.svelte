<!--
	The preview of the award: every write to Flow PT, in the order it runs, one numbered step per
	batch. While publishing, the same steps show where the run is. Figures come from the plan
	(`$lib/pure/fpt-award`), words from `$lib/pure/award-view`.
-->
<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import X from '@lucide/svelte/icons/x';
	import { linesByItem, stepViews } from '$lib/pure/award-view';
	import { formatAmount, formatDay } from '$lib/pure/display';
	import type { AwardPlan } from '$lib/pure/fpt-award';
	import type { Money } from '$lib/pure/money';
	import { cn } from '$lib/utils.js';

	let {
		plan,
		running = null,
		done = [],
		failedAt = null
	}: {
		plan: AwardPlan;
		/** The step being written. */
		running?: string | null;
		/** The steps that answered. */
		done?: readonly string[];
		/** The step that stopped the run. */
		failedAt?: string | null;
	} = $props();

	const steps = $derived(stepViews(plan));
	const items = $derived(linesByItem(plan.preview.lines));
	const amount = (m: Money | null) => (m ? formatAmount(m, undefined, false) : '');
	const STATUS: Record<string, string> = { awarded: 'Awarded', not_awarded: 'Not awarded', submitted: 'Submitted', draft: 'Draft' };

	function stateOf(label: string): 'done' | 'running' | 'failed' | 'waiting' {
		if (done.includes(label)) return 'done';
		if (failedAt === label) return 'failed';
		if (running === label) return 'running';
		return 'waiting';
	}
</script>

<ol class="flex flex-col" data-slot="write-ledger" aria-label="What will be written to Flow PT">
	{#each steps as step, i (step.label)}
		{@const st = stateOf(step.label)}
		<li class="relative flex gap-4 pb-8 last:pb-0" data-step={step.label} data-state={st}>
			{#if i < steps.length - 1}<span class="bg-border absolute top-8 bottom-1 left-[13px] w-px" aria-hidden="true"></span>{/if}
			<span
				class={cn(
					'bg-background relative flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
					st === 'done' && 'border-success text-success',
					st === 'running' && 'border-info text-info',
					st === 'failed' && 'border-destructive text-destructive'
				)}
				aria-label={st === 'waiting' ? `Step ${i + 1}` : `Step ${i + 1}, ${st}`}
			>
				{#if st === 'done'}<Check class="size-3.5" />{:else if st === 'running'}<LoaderCircle class="size-3.5 animate-spin motion-reduce:animate-none" />{:else if st === 'failed'}<X
						class="size-3.5"
					/>{:else}{i + 1}{/if}
			</span>
			<div class="flex min-w-0 flex-1 flex-col gap-3 pt-0.5">
				<div class="flex flex-col gap-0.5">
					<h3 class="text-sm font-semibold">{step.label} <span class="text-muted-foreground font-normal tabular-nums">{step.writes}</span></h3>
					<p class="text-muted-foreground text-xs">{step.line}</p>
				</div>

				{#if step.label === 'Take back what the scenario dropped'}
					{@const r = plan.preview.removed}
					<ul class="flex flex-col gap-1 text-sm">
						{#each r.groups as g (`${g.ref.type}:${g.ref.id}`)}<li>{g.item}: remove {g.groups.length === 1 ? 'one Group' : `${g.groups.length} Groups`} the app added</li>{/each}
						{#each r.lines as l (l.key)}<li>Delete the Bid Line for {l.item} from {l.vendor}</li>{/each}
						{#each r.bids as b (b.key)}<li>Delete {b.vendor}'s Bid</li>{/each}
						{#each r.items as i (i.key)}<li>Delete {i.type} {i.id}, created by an earlier publish</li>{/each}
					</ul>
				{:else if step.label === 'Sequences'}
					<ul class="flex flex-col gap-1 text-sm" data-slot="preview-sequences">
						{#each plan.preview.sequences as s (s.key)}<li>New Sequence <span class="font-mono text-xs">{s.code}</span></li>{/each}
					</ul>
				{:else if step.label === 'Shots and Assets'}
					<div class="overflow-x-auto">
						<table class="w-full min-w-[640px] text-sm" data-slot="preview-created">
							<thead>
								<tr class="text-muted-foreground border-b text-left text-xs">
									<th class="py-1.5 pr-3 font-medium">New row</th>
									<th class="px-3 py-1.5 font-medium">Type</th>
									<th class="px-3 py-1.5 font-medium">Sequence</th>
									<th class="py-1.5 pl-3 font-medium">Fields written</th>
								</tr>
							</thead>
							<tbody>
								{#each plan.preview.created as c (c.key)}
									<tr class="border-b last:border-0 align-top">
										<td class="py-1.5 pr-3 font-mono text-xs font-medium">{c.item}</td>
										<td class="px-3 py-1.5">{c.type}</td>
										<td class="text-muted-foreground px-3 py-1.5">{c.sequence ? `${c.sequence}${c.sequenceNew ? ', new' : ''}` : 'none'}</td>
										<td class="text-muted-foreground py-1.5 pl-3 text-xs">
											{c.fields.length ? c.fields.map((f) => `${f.field}: ${f.value.length > 40 ? `${f.value.slice(0, 40)}…` : f.value}`).join('; ') : 'the code only'}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<p class="text-muted-foreground text-xs">Each is created in this project with its code. The Bid Lines and vendor Groups below link to them. Undo award deletes them unless they gain Tasks, Versions or other links.</p>
				{:else if step.label === 'Bids'}
					<div class="overflow-x-auto">
						<table class="w-full min-w-[640px] text-sm" data-slot="preview-bids">
							<thead>
								<tr class="text-muted-foreground border-b text-left text-xs">
									<th class="py-1.5 pr-3 font-medium">Vendor</th>
									<th class="px-3 py-1.5 font-medium">Status</th>
									<th class="px-3 py-1.5 text-right font-medium">Total</th>
									<th class="px-3 py-1.5 text-right font-medium">Rate</th>
									<th class="px-3 py-1.5 text-right font-medium">Total in base</th>
									<th class="py-1.5 pl-3 text-right font-medium">Write</th>
								</tr>
							</thead>
							<tbody class="tabular-nums">
								{#each plan.preview.bids as b (b.key)}
									<tr class="border-b last:border-0">
										<td class="py-2 pr-3">
											<span class="font-medium">{b.vendor}{#if b.package}<span class="text-muted-foreground font-normal">, {b.package}</span>{:else if b.general}<span class="text-muted-foreground font-normal">, General costs</span>{/if}</span>
											<span class="text-muted-foreground block text-xs">{b.group === null ? 'No Group' : `Group ${b.group}`}, {b.lines} lines</span>
										</td>
										<td class="px-3 py-2">{STATUS[b.status]}</td>
										<td class="px-3 py-2 text-right">{amount(b.total)}</td>
										<td class="text-muted-foreground px-3 py-2 text-right">{b.rate ? `${b.rate.rate}, ${formatDay(b.rate.date)}` : 'base'}</td>
										<td class="px-3 py-2 text-right">{amount(b.totalBase)}</td>
										<td class={cn('py-2 pl-3 text-right text-xs', b.action === 'create' ? 'text-success' : 'text-info')}>{b.action === 'create' ? 'New' : 'Update'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<p class="text-muted-foreground text-xs">A Bid's total is its figure or its lines' sum. A rate is the one locked on the compare page. Each bid of the request a vendor answered is a Bid of its own. A bid priced as one figure carries the figure on its Bid, and its Bid Lines carry no amount. Non-shot costs, discount, tax and the rebate go on one General costs Bid, so a vendor's Bids sum to its total.</p>
				{:else if step.label === 'Bid Lines and vendor Groups'}
					<div class="overflow-x-auto">
						<table class="w-full min-w-[640px] text-sm" data-slot="preview-lines">
							<thead>
								<tr class="text-muted-foreground border-b text-left text-xs">
									<th class="py-1.5 pr-3 font-medium">Shot or Asset</th>
									<th class="px-3 py-1.5 font-medium">Vendor</th>
									<th class="px-3 py-1.5 font-medium">Bid of the request</th>
									<th class="px-3 py-1.5 text-right font-medium">Price</th>
									<th class="px-3 py-1.5 text-right font-medium">In base</th>
									<th class="px-3 py-1.5 text-right font-medium">Share</th>
									<th class="py-1.5 pl-3 text-right font-medium">Awarded</th>
								</tr>
							</thead>
							<tbody class="tabular-nums">
								{#each items as it (it.lines[0].key)}
									{#each it.lines as l, j (l.key)}
										<tr class={cn(j === it.lines.length - 1 && 'border-b', it.split && 'bg-muted/30')} data-split={it.split ? 'true' : undefined}>
											<td class="py-1.5 pr-3">{#if j === 0}<span class="font-medium">{it.item}</span>{#if it.split}<span class="text-muted-foreground ml-2 text-xs">split</span>{/if}{/if}</td>
											<td class="px-3 py-1.5">{l.vendor}</td>
											<td class="text-muted-foreground px-3 py-1.5">{l.package ?? ''}</td>
											<td class="px-3 py-1.5 text-right" title={l.inPackage ? 'The figure is on its Bid' : undefined}>
												{l.excluded ? 'Excluded' : l.inPackage ? "In the bid's figure" : amount(l.amount)}
											</td>
											<td class="px-3 py-1.5 text-right">{amount(l.amountBase)}</td>
											<td class="px-3 py-1.5 text-right">{l.share === null ? '' : `${l.share}%`}</td>
											<td class="py-1.5 pl-3 text-right">{amount(l.awardedBase)}</td>
										</tr>
									{/each}
								{/each}
							</tbody>
						</table>
					</div>
					<div class="flex flex-col gap-1" data-slot="preview-groups">
						<h4 class="text-xs font-medium">Groups added to vendor groups</h4>
						<ul class="grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
							{#each plan.preview.groups as g (g.target)}
								<li class="flex gap-2">
									<span class="w-28 shrink-0 truncate font-medium">{g.item}</span>
									<span class="text-muted-foreground min-w-0">
										{#if g.added.length}<span class="text-success">+ {g.addedVendors.map((v, k) => `${v} (${g.added[k]})`).join(', ')}</span>{/if}
										{#if g.already.length}{g.added.length ? '; ' : ''}already there: {g.already.join(', ')}{/if}
										{#if g.withoutGroup.length}{g.added.length || g.already.length ? '; ' : ''}not shared with {g.withoutGroup.join(', ')}{/if}
									</span>
								</li>
							{/each}
						</ul>
					</div>
				{:else if step.label === 'App links'}
					<p class="text-sm">Each new Bid gets a link back to this request in the app.</p>
				{/if}
			</div>
		</li>
	{/each}
</ol>

{#if plan.preview.unlinked.length}
	<div class="mt-6 flex flex-col gap-1" data-slot="plan-unlinked">
		<h3 class="text-sm font-semibold">Published with no Flow PT row</h3>
		<p class="text-muted-foreground text-sm">
			Their Bid Lines are written with no Shot or Asset, and no vendor Group is added: {plan.preview.unlinked.map((u) => u.item).join(', ')}.
		</p>
	</div>
{/if}

{#if plan.warnings.length}
	<div class="mt-6 flex flex-col gap-1" data-slot="plan-warnings">
		<h3 class="text-sm font-semibold">What Flow PT will not hold exactly</h3>
		<ul class="text-muted-foreground list-disc pl-5 text-sm">
			{#each plan.warnings as w, i (i)}<li>{w}</li>{/each}
		</ul>
	</div>
{/if}
