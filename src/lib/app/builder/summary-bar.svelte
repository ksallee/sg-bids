<!--
	What the vendor gets and what is left before the issue, on one line at the right of the items bar,
	so the table keeps the width: the counts, then "Ready to issue" or what is left. What is left opens
	the list, one line per required thing; a line not done is a button that takes the person to the
	control. Lines from `$lib/pure/readiness`, counts from `$lib/pure/request`.
-->
<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Circle from '@lucide/svelte/icons/circle';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import type { ChecklistLine, Target } from '$lib/pure/readiness';
	import { summarize } from '$lib/pure/request';
	import { cn } from '$lib/utils.js';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, onFocus }: { builder: Builder; onFocus: (target: Target) => void } = $props();

	const counts = $derived(summarize(builder.request()));
	const r = $derived(builder.readiness);
	const left = $derived(r.checklist.filter((l) => l.state !== 'done'));
	const errors = $derived(left.filter((l) => l.state === 'error').length);
	const number = new Intl.NumberFormat();
	let open = $state(false);

	const facts = $derived(
		[
			{ label: counts.shots === 1 ? 'shot' : 'shots', value: counts.shots, title: counts.shotsOmitted > 0 ? `${counts.shotsOmitted} omitted` : undefined },
			{ label: counts.frames === 1 ? 'frame' : 'frames', value: counts.frames, title: counts.shotsWithoutFrames > 0 ? `${counts.shotsWithoutFrames} shots without a count` : undefined },
			{ label: counts.assets === 1 ? 'asset' : 'assets', value: counts.assets, title: counts.assetsOmitted > 0 ? `${counts.assetsOmitted} omitted` : undefined }
		]
	);

	function go(target: Target): void {
		open = false;
		onFocus(target);
	}
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

<div class="flex min-w-0 items-center gap-4 text-sm" aria-label="What the vendor gets" role="group" data-slot="summary-bar">
	<p class="text-muted-foreground hidden items-baseline gap-3 whitespace-nowrap lg:flex" data-slot="rail-counts">
		{#each facts as fact (fact.label)}
			<span title={fact.title}><span class={cn('font-semibold tabular-nums', fact.value === 0 ? 'text-muted-foreground' : 'text-foreground')}>{number.format(fact.value)}</span> {fact.label}</span>
		{/each}
	</p>
	<Popover.Root bind:open>
		<Popover.Trigger
			class={cn(
				'focus-visible:ring-ring inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium outline-none focus-visible:ring-2',
				left.length === 0 ? 'border-success/40 text-foreground' : errors > 0 ? 'border-destructive/50 text-destructive' : 'border-border text-foreground hover:bg-muted'
			)}
			data-slot="readiness-count"
		>
			{#if left.length === 0}
				<CircleCheck class="text-success size-3.5" aria-hidden="true" />Ready to issue
			{:else}
				{#if errors > 0}<CircleAlert class="size-3.5" aria-hidden="true" />{:else}<Circle class="text-muted-foreground size-3.5" aria-hidden="true" />{/if}
				{left.length} left before the issue
			{/if}
			<ChevronDown class="text-muted-foreground size-3.5" aria-hidden="true" />
		</Popover.Trigger>
		<Popover.Content align="end" class="w-80 p-2" data-slot="readiness">
			<p class="text-muted-foreground px-2 pt-1 pb-2 text-xs">Before you issue</p>
			<ul class="flex flex-col">
				{#each r.checklist as line (line.key)}
					<li>
						{#if line.state === 'done'}
							<div class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm" data-state="done">
								{@render lineIcon(line)}
								<span class="text-muted-foreground shrink-0">{line.label}</span>
								<span class={cn('ml-auto min-w-0 truncate text-right', (line.key === 'code' || line.key === 'baseCurrency') && 'font-mono text-xs')} title={line.detail}>{line.detail}</span>
							</div>
						{:else}
							<button
								type="button"
								class="hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2"
								data-state={line.state}
								data-target={line.target}
								onclick={() => go(line.target)}
							>
								{@render lineIcon(line)}
								<span class="shrink-0 font-medium">{line.label}</span>
								<span class={cn('ml-auto min-w-0 truncate text-right', line.state === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{line.detail}</span>
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		</Popover.Content>
	</Popover.Root>
</div>
