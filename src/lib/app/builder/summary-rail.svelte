<!--
	Beside the work, always: what the vendor will receive (the title and the counts), then what is
	left before the issue, one line per required thing. A line that is not done is a button: it
	takes you to the control and focuses it. Then the fields the request reads from Flow PT, with
	the way into that setting. Lines from `$lib/pure/readiness`, counts from `$lib/pure/request`.
-->
<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Circle from '@lucide/svelte/icons/circle';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import { mappingWords } from '$lib/pure/field-map';
	import type { ChecklistLine, Target } from '$lib/pure/readiness';
	import { summarize } from '$lib/pure/request';
	import { cn } from '$lib/utils.js';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, onFocus, onFields }: { builder: Builder; onFocus: (target: Target) => void; onFields: () => void } = $props();

	const counts = $derived(summarize(builder.request()));
	const r = $derived(builder.readiness);
	const left = $derived(r.checklist.filter((l) => l.state !== 'done').length);
	const status = $derived(builder.mappingStatus);
	const words = $derived(status ? mappingWords(status) : null);
	/** Something is unmapped and the mapping was never kept for this project: ask once, without a modal. */
	const ask = $derived(Boolean(words && words.unmapped.length > 0 && !builder.mappingKept));
	const number = new Intl.NumberFormat();
	const title = $derived(builder.state.form.title.trim());

	const facts = $derived([
		{ label: counts.shots === 1 ? 'Shot' : 'Shots', value: counts.shots, note: counts.shotsOmitted > 0 ? `${counts.shotsOmitted} omitted` : null },
		{ label: 'Frames', value: counts.frames, note: counts.shotsWithoutFrames > 0 && counts.shots > 0 ? `${counts.shotsWithoutFrames} without a count` : null },
		{ label: counts.assets === 1 ? 'Asset' : 'Assets', value: counts.assets, note: counts.assetsOmitted > 0 ? `${counts.assetsOmitted} omitted` : null },
		{ label: counts.sequences === 1 ? 'Sequence' : 'Sequences', value: counts.sequences, note: null }
	]);
</script>

{#snippet lineIcon(line: ChecklistLine)}
	{#if line.state === 'done'}
		<Check class="text-success size-4 shrink-0" aria-hidden="true" />
	{:else if line.state === 'todo'}
		<Circle class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
	{:else if line.state === 'warning'}
		<TriangleAlert class="text-warning size-4 shrink-0" aria-hidden="true" />
	{:else}
		<CircleAlert class="text-destructive size-4 shrink-0" aria-hidden="true" />
	{/if}
{/snippet}

<aside class="flex flex-col gap-6 p-5" aria-label="The request so far" data-slot="summary-rail">
	<section class="flex flex-col gap-3" aria-labelledby="rail-vendor">
		<h2 id="rail-vendor" class="text-sm font-semibold">What the vendor gets</h2>
		<p class={cn('text-sm leading-snug text-balance', !title && 'text-muted-foreground')}>{title || 'No title yet'}</p>
		<dl class="grid grid-cols-2 gap-x-4 gap-y-3" data-slot="rail-counts">
			{#each facts as fact (fact.label)}
				<div class="flex flex-col">
					<dt class="text-muted-foreground text-xs">{fact.label}</dt>
					<dd class={cn('text-lg leading-tight font-semibold tabular-nums', fact.value === 0 && 'text-muted-foreground font-normal')}>{number.format(fact.value)}</dd>
					{#if fact.note}<dd class="text-muted-foreground text-xs">{fact.note}</dd>{/if}
				</div>
			{/each}
		</dl>
	</section>

	<section class="flex flex-col gap-2" aria-labelledby="rail-ready" data-slot="readiness">
		<div class="flex items-baseline gap-2">
			<h2 id="rail-ready" class="text-sm font-semibold">Before you issue</h2>
			<span class={cn('text-xs', left === 0 ? 'text-success' : 'text-muted-foreground')} data-slot="readiness-count">{left === 0 ? 'Ready' : `${left} left`}</span>
		</div>
		<ul class="-mx-2 flex flex-col">
			{#each r.checklist as line (line.key)}
				<li>
					{#if line.state === 'done'}
						<div class="flex items-center gap-2 px-2 py-1 text-sm" data-state="done">
							{@render lineIcon(line)}
							<span class="text-muted-foreground shrink-0">{line.label}</span>
							<span class={cn('ml-auto min-w-0 truncate text-right', (line.key === 'code' || line.key === 'baseCurrency') && 'font-mono text-xs')} title={line.detail}>{line.detail}</span>
						</div>
					{:else}
						<button
							type="button"
							class="hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm outline-none focus-visible:ring-2"
							data-state={line.state}
							data-target={line.target}
							onclick={() => onFocus(line.target)}
						>
							{@render lineIcon(line)}
							<span class="shrink-0 font-medium">{line.label}</span>
							<span class={cn('ml-auto min-w-0 truncate text-right underline decoration-current/30 underline-offset-2', line.state === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
								{line.detail}
							</span>
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	</section>

	<section
		class={cn('flex flex-col gap-2', ask && 'border-info/50 bg-info/10 -mx-2 rounded-lg border px-3 py-3')}
		aria-labelledby="rail-fields"
		data-slot="rail-fields"
		data-ask={ask}
	>
		<h2 id="rail-fields" class="text-sm font-semibold">Fields from Flow PT</h2>
		{#if !words}
			<p class="text-muted-foreground text-sm">Reading the project…</p>
		{:else}
			<p class="text-sm">{words.headline}</p>
			{#each words.unmapped as line (line)}
				<p class={cn('text-xs', ask ? 'text-foreground' : 'text-muted-foreground')}>{line} Set it per item in the request, or map a field.</p>
			{/each}
		{/if}
		<div class="flex flex-wrap gap-2">
			<Button size="sm" variant="outline" onclick={onFields} disabled={!words} data-slot="open-fields"><Settings2 data-icon="inline-start" />Fields</Button>
			{#if ask}<Button size="sm" variant="ghost" onclick={() => builder.keepMapping()} data-slot="keep-fields">Leave it</Button>{/if}
		</div>
	</section>
</aside>
