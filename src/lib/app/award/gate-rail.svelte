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
	import Segmented from '$lib/app/segmented.svelte';
	import { focusById } from '$lib/app/focus-by-id';
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
	const missingCount = $derived(g.missing.shot.labels.length + g.missing.asset.labels.length);
	const missingMark = $derived<Mark>((['shot', 'asset'] as const).some((k) => g.missing[k].labels.length > 0 && !g.missing[k].choice) ? 'blocked' : 'ok');
	const collisions = $derived(s.prepared?.plan.collisions ?? []);
	const matchHref = $derived(`/requests/${s.requestId}`);
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
		<section class="flex flex-col gap-2 outline-none" id="gate-site" tabindex="-1" data-slot="gate-site">
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
						<p>
							{#if report.fields.filter((f) => f.state === 'missing' && !f.spec.stock).every((f) => f.spec.optional)}{g.missingFields === 1 ? 'One optional field is' : `${g.missingFields} optional fields are`} missing. The award works without it. The app creates it, as you. It needs an Admin.
							{:else}{g.missingFields === 1 ? 'One field is' : `${g.missingFields} fields are`} missing. The app creates them, as you. It needs an Admin.{/if}
						</p>
						<ul class="text-muted-foreground flex flex-col gap-0.5 text-xs" data-slot="missing-fields">
							{#each ['bid', 'line'] as const as entity (entity)}
								{@const names = report.fields.filter((f) => f.entity === entity && f.state === 'missing' && !f.spec.stock)}
								{#if names.length}
									<li><span class="text-foreground font-medium">{entity === 'bid' ? 'Bid' : 'Bid Line'}:</span> {names.map((f) => `${f.spec.display} (${f.spec.name})${f.spec.optional ? ', optional' : ''}`).join(', ')}</li>
								{/if}
							{/each}
						</ul>
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

		{#if missingCount > 0}
			<section class="flex flex-col gap-3 outline-none" id="gate-missing" tabindex="-1" data-slot="gate-missing">
				<h2 class="flex items-center gap-2 font-semibold">{@render mark(missingMark)}Rows with no Flow PT row</h2>
				<p class="text-muted-foreground text-xs">Awarded rows from a breakdown. A Bid Line and a vendor Group need a Shot or Asset to link to.</p>
				{#each [['shot', 'Shot', 'shots'], ['asset', 'Asset', 'assets']] as [kind, type, plural] (kind)}
					{@const m = g.missing[kind as 'shot' | 'asset']}
					{#if m.labels.length > 0}
						<div class="flex flex-col gap-2" data-kind={kind}>
							<p>
								<span class="font-medium">{m.labels.length} {m.labels.length === 1 ? kind : plural}</span>
								<span class="text-muted-foreground">with no Flow PT {type}:</span>
								<span class="font-mono text-xs">{m.labels.slice(0, 8).join(', ')}{m.labels.length > 8 ? ` and ${m.labels.length - 8} more` : ''}</span>
							</p>
							<Segmented
								label={`What to do with the ${plural} with no Flow PT ${type}`}
								value={m.choice ?? ''}
								options={[
									{ value: 'create', label: `Create the ${plural}` },
									{ value: 'without', label: 'Publish without them' }
								]}
								onChange={(v) => s.setMissing(kind as 'shot' | 'asset', v as 'create' | 'without')}
							/>
							<p class="text-muted-foreground text-xs">
								{#if m.choice === 'create'}
									Created in this project from the rows: code, description and the mapped fields that hold a value. Undo award deletes them.
								{:else if m.choice === 'without'}
									Their Bid Lines are written with no {type}. No vendor Group is added for them.
								{:else}
									Or <a class="text-foreground underline decoration-current/30 underline-offset-2" href={matchHref}>go back and match them</a> to {type}s already in Flow PT.
								{/if}
							</p>
							{#if kind === 'shot' && m.choice === 'create'}
								<label class="flex items-start gap-2">
									<Switch checked={s.missing.sequences === true} onCheckedChange={(on) => s.setSequences(on)} disabled={busy} aria-label="Also create the missing Sequences" data-slot="create-sequences" />
									<span class="text-xs">Also create the Sequences the new Shots name that the project lacks. Off: those Shots go in with no Sequence.</span>
								</label>
							{/if}
						</div>
					{/if}
				{/each}
				{#if collisions.length}
					<div class="border-destructive/50 bg-destructive/10 flex flex-col gap-1 rounded-md border p-3 text-xs" role="alert" data-slot="collisions">
						<p class="font-medium">Not created: the code is taken.</p>
						<ul class="flex flex-col gap-0.5">
							{#each collisions as c (`${c.kind}:${c.item}`)}
								<li>
									<span class="font-mono">{c.code}</span>:
									{c.twice ? 'two rows of the request have this code.' : `in Flow PT already as ${c.found.map((f) => `${f.type} ${f.id}`).join(' and ')}.`}
								</li>
							{/each}
						</ul>
						<p><a class="underline underline-offset-2" href={matchHref}>Match them on the request</a>, or change the codes in a new round. Nothing is published while a code is taken.</p>
					</div>
				{/if}
			</section>
		{/if}

		<section class="flex flex-col gap-2" data-slot="gate-vendors">
			<h2 class="flex items-center gap-2 font-semibold">{@render mark(vendorsMark)}Each vendor's Group</h2>
			<p class="text-muted-foreground text-xs">The award adds the vendor's Group to the Shots and Assets it wins. That is what lets a vendor with a Flow PT login see them.</p>
			<ul class="flex flex-col gap-3">
				{#each g.vendors as v (v.vendorId)}
					<li class="flex flex-col gap-1.5 outline-none" id={`gate-vendor-${v.vendorId}`} tabindex="-1" data-vendor={v.name}>
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
			<section class="flex flex-col gap-2 outline-none" id="gate-rates" tabindex="-1" data-slot="gate-rates">
				<h2 class="flex items-center gap-2 font-semibold">{@render mark(ratesMark)}Rates to {base}</h2>
				<ul class="flex flex-col gap-1">
					{#each others as b (b.id)}
						<li class="flex justify-between gap-2 tabular-nums">
							<span>{nameOf(b.vendorId)}, {b.currency}</span>
							{#if b.rate}
								<span class="text-muted-foreground">{b.rate.rate}, {formatDay(b.rate.date)}, locked at publish</span>
							{:else}
								<a class="text-destructive underline-offset-4 hover:underline" href={`/requests/${s.requestId}/compare`}>Needs a rate</a>
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
		{#if g.problems.length || collisions.length}
			<p class="text-xs font-medium" id="gate-blockers-title">{g.problems.length + (collisions.length ? 1 : 0) === 1 ? 'One thing to fix before you publish:' : `${g.problems.length + (collisions.length ? 1 : 0)} things to fix before you publish:`}</p>
			<ul class="text-destructive flex flex-col gap-1 text-xs" data-slot="blockers" aria-labelledby="gate-blockers-title">
				{#each g.problems as p, i (i)}
					<li>
						{#if p.href}
							<a class="text-left underline decoration-current/40 underline-offset-2 hover:decoration-current" href={p.href} data-target={p.target}>{p.message}</a>
						{:else}
							<button type="button" class="text-left underline decoration-current/40 underline-offset-2 hover:decoration-current" data-target={p.target} onclick={() => void focusById(p.target)}>{p.message}</button>
						{/if}
					</li>
				{/each}
				{#if collisions.length}
					<li>
						<button type="button" class="text-left underline decoration-current/40 underline-offset-2 hover:decoration-current" data-target="gate-missing" onclick={() => void focusById('gate-missing')}>
							{collisions.length === 1 ? `${collisions[0].code} cannot be created: its code is taken.` : `${collisions.length} rows cannot be created: ${collisions.map((c) => c.code).join(', ')}. Their codes are taken.`}
						</button>
					</li>
				{/if}
			</ul>
		{:else if g.needsConfirm && !s.accepted}
			<p class="text-warning text-xs">Answer what vendors can read before publishing.</p>
		{/if}
		<Button disabled={!g.ready || !s.prepared || collisions.length > 0 || s.previewing || busy || s.phase === 'done'} onclick={() => void s.publish()} data-slot="publish">
			<Send class="size-3.5" />{busy ? 'Publishing…' : s.prepared ? publishLabel(s.prepared.plan) : 'Publish'}
		</Button>
		<p class="text-muted-foreground text-xs">Written as you, from this browser. Read back after. Undo takes back exactly what was written.</p>
	</div>
</aside>
