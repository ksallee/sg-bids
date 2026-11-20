<!--
	Before publishing, on the right of the publish page: the site, each vendor's Group, the rates,
	what a vendor with a Flow PT login could read, the switch for every line, and the publish button
	with what it writes. Every rule is in `$lib/pure/award-gate`; this shows it and takes the choices.
-->
<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import X from '@lucide/svelte/icons/x';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Send from '@lucide/svelte/icons/send';
	import EntityPicker from '$lib/components/entity-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { liveContext } from '$lib/live';
	import { publishLabel } from '$lib/pure/award-view';
	import { formatDay } from '$lib/pure/display';
	import { cn } from '$lib/utils.js';
	import type { PublishState } from './publish.svelte';

	let { state: s }: { state: PublishState } = $props();

	const g = $derived(s.gate!);
	const report = $derived(s.setup?.report ?? null);
	const base = $derived(s.data!.request.header.baseCurrency);
	const busy = $derived(s.phase === 'publishing' || s.phase === 'recording');

	type Mark = 'ok' | 'blocked' | 'ask' | 'wait';
	const siteMark = $derived<Mark>(!report ? 'wait' : report.ready ? 'ok' : 'blocked');
	const vendorsMark = $derived<Mark>(g.vendors.some((v) => v.source === 'undecided') ? 'blocked' : 'ok');
	const others = $derived(g.bids.filter((b) => b.currency !== base));
	const ratesMark = $derived<Mark>(others.some((b) => !b.rate) ? 'blocked' : 'ok');
	const readMark = $derived<Mark>(!g.exposure ? 'wait' : g.exposure.state === 'safe' ? 'ok' : s.accepted ? 'ok' : 'ask');
	const nameOf = (vendorId: string) => s.data!.request.vendors.find((v) => v.id === vendorId)?.name ?? 'A vendor';
</script>

{#snippet mark(m: Mark)}
	<span
		class={cn(
			'flex size-5 shrink-0 items-center justify-center rounded-full border',
			m === 'ok' && 'border-success/50 text-success',
			m === 'blocked' && 'border-destructive/50 text-destructive',
			m === 'ask' && 'border-warning/60 text-warning',
			m === 'wait' && 'text-muted-foreground'
		)}
		aria-label={m === 'ok' ? 'Done' : m === 'blocked' ? 'Blocks the publish' : m === 'ask' ? 'Needs your answer' : 'Reading'}
	>
		{#if m === 'ok'}<Check class="size-3" />{:else if m === 'blocked'}<X class="size-3" />{:else if m === 'ask'}<TriangleAlert class="size-3" />{:else}<CircleDashed class="size-3" />{/if}
	</span>
{/snippet}

<aside class="flex min-h-0 w-full shrink-0 flex-col border-l lg:w-[380px]" data-slot="gate-rail" aria-label="Before you publish">
	<div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4 text-sm">
		<section class="flex flex-col gap-2" data-slot="gate-site">
			<h2 class="flex items-center gap-2 font-semibold">{@render mark(siteMark)}The Flow PT site</h2>
			{#if s.setupError}
				<p class="text-destructive">{s.setupError}</p>
				<Button size="sm" variant="outline" onclick={() => void s.readSite()}>Read the site again</Button>
			{:else if !report}
				<p class="text-muted-foreground">Reading the project's schema and the Vendor role's rights…</p>
			{:else}
				<ul class="text-muted-foreground flex flex-col gap-1">
					<li>Bid: {report.entities.bid.state === 'found' ? `enabled, ${report.entities.bid.type}` : report.entities.bid.state === 'missing' ? 'not enabled' : 'two entities carry the name'}</li>
					<li>Bid Line: {report.entities.line.state === 'found' ? `enabled, ${report.entities.line.type}` : report.entities.line.state === 'missing' ? 'not enabled' : 'two entities carry the name'}</li>
					<li>
						Fields: {report.fields.filter((f) => f.state === 'present').length} of {report.fields.length} in place
					</li>
					<li>
						Vendor groups field: Shot <span class="font-mono text-xs">{report.vendorField.Shot.field ?? 'none'}</span>, Asset
						<span class="font-mono text-xs">{report.vendorField.Asset.field ?? 'none'}</span>
					</li>
				</ul>
				{#if g.missingFields > 0}
					<div class="flex flex-col gap-1.5 rounded-md border p-3">
						<p>{g.missingFields === 1 ? 'One field is' : `${g.missingFields} fields are`} missing on Bid and Bid Line. The app creates them, as you. It needs an Admin.</p>
						<Button size="sm" disabled={s.creating} onclick={() => void s.createFields()} data-slot="create-fields">
							{s.creating ? 'Creating…' : `Create the ${g.missingFields} missing fields`}
						</Button>
					</div>
				{/if}
				{#if s.ensured}
					{@const failed = s.ensured.outcomes.filter((o) => o.outcome.state !== 'created')}
					<p class="text-muted-foreground text-xs">
						Created {s.ensured.outcomes.length - failed.length} of {s.ensured.outcomes.length}.{failed.length
							? ` Not created: ${failed.map((o) => `${o.create.name} (${o.outcome.state === 'failed' ? o.outcome.title : o.outcome.state})`).join(', ')}.`
							: ''}
					</p>
				{/if}
			{/if}
		</section>

		<section class="flex flex-col gap-2" data-slot="gate-vendors">
			<h2 class="flex items-center gap-2 font-semibold">{@render mark(vendorsMark)}Each vendor's Group</h2>
			<p class="text-muted-foreground text-xs">The award adds the vendor's Group to the Shots and Assets it wins. That is what lets a vendor with a Flow PT login see them.</p>
			<ul class="flex flex-col gap-3">
				{#each g.vendors as v (v.vendorId)}
					<li class="flex flex-col gap-1.5" data-vendor={v.name}>
						<div class="flex items-baseline justify-between gap-2">
							<span class="font-medium">{v.name}</span>
							<span class="text-muted-foreground text-xs">{v.awarded ? 'wins rows' : 'wins nothing'}</span>
						</div>
						{#if v.source === 'invitation'}
							<p class="text-muted-foreground">Group {v.group}, from the invitation.</p>
						{:else}
							{#if v.source !== 'none'}
								<EntityPicker
									context={liveContext()}
									entityTypes={['Group']}
									value={s.picked[v.vendorId] ?? (v.group ? { type: 'Group', id: v.group } : null)}
									placeholder="Pick its Group"
									onValueChange={(value) => s.setGroup(v.vendorId, value)}
								/>
							{/if}
							<label class="flex items-start gap-2">
								<Switch checked={v.source === 'none'} onCheckedChange={(on) => s.setGroup(v.vendorId, on ? 'none' : null)} aria-label={`Publish ${v.name} without a Group`} />
								<span class="text-xs">Publish its Bid without a Group. No Shot or Asset is shared with {v.name} in Flow PT.</span>
							</label>
						{/if}
					</li>
				{/each}
			</ul>
		</section>

		{#if others.length}
			<section class="flex flex-col gap-2" data-slot="gate-rates">
				<h2 class="flex items-center gap-2 font-semibold">{@render mark(ratesMark)}Rates to {base}</h2>
				<ul class="flex flex-col gap-1">
					{#each others as b (b.id)}
						<li class="flex justify-between gap-2 tabular-nums">
							<span>{nameOf(b.vendorId)}, {b.currency}</span>
							{#if b.rate}
								<span class="text-muted-foreground">{b.rate.rate}, {formatDay(b.rate.date)}, locked at publish</span>
							{:else}
								<a class="text-destructive underline-offset-4 hover:underline" href={`/bids/${s.requestId}/compare`}>Needs a rate</a>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="flex flex-col gap-2" data-slot="gate-exposure">
			<h2 class="flex items-center gap-2 font-semibold">{@render mark(readMark)}What vendors can read in Flow PT</h2>
			{#if !g.exposure}
				<p class="text-muted-foreground">Reading the Vendor role's rights…</p>
			{:else if g.exposure.state === 'safe'}
				<p class="text-muted-foreground">The Vendor role cannot see Bid or Bid Line. Prices stay with production.</p>
			{:else}
				<div class="border-warning/60 bg-warning/10 flex flex-col gap-2 rounded-md border p-3" role="alert">
					{#each g.exposure.lines as line, i (i)}<p>{line}</p>{/each}
					<p class="font-medium">What an admin sets, in the web interface:</p>
					<ul class="list-disc pl-5">
						{#each g.exposure.adminSteps as step, i (i)}<li>{step}</li>{/each}
					</ul>
					<label class="flex items-start gap-2 pt-1">
						<Checkbox checked={s.accepted} onCheckedChange={(on) => (s.accepted = on === true)} aria-label="Publish anyway" data-slot="publish-anyway" />
						<span>Publish anyway. I have read what a vendor with a Flow PT login could see. The app records this choice.</span>
					</label>
				</div>
			{/if}
		</section>

		<section class="flex flex-col gap-2">
			<label class="flex items-start gap-2">
				<Switch checked={s.allLines} onCheckedChange={(on) => (s.allLines = on)} disabled={busy} aria-label="Write every line of every bid" data-slot="all-lines" />
				<span>
					<span class="font-medium">Every line of every bid</span>
					<span class="text-muted-foreground block text-xs">Off: a Bid for each vendor that wins, and a Bid Line for each awarded row. On: a Bid for every vendor and a Bid Line for every row it priced.</span>
				</span>
			</label>
		</section>
	</div>

	<div class="flex flex-col gap-2 border-t px-4 py-3">
		{#if g.blockers.length}
			<ul class="text-destructive flex flex-col gap-1 text-xs" data-slot="blockers">
				{#each g.blockers as b, i (i)}<li>{b}</li>{/each}
			</ul>
		{:else if g.needsConfirm && !s.accepted}
			<p class="text-warning text-xs">Answer what vendors can read before publishing.</p>
		{/if}
		<Button disabled={!g.ready || !s.prepared || s.previewing || busy || s.phase === 'done'} onclick={() => void s.publish()} data-slot="publish">
			<Send class="size-3.5" />{busy ? 'Publishing…' : s.prepared ? publishLabel(s.prepared.plan) : 'Publish'}
		</Button>
		<p class="text-muted-foreground text-xs">Written as you, from this browser. Read back after. Undo takes back exactly what was written.</p>
	</div>
</aside>
