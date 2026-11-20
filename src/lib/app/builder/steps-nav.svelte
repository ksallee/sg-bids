<!--
	The builder's steps, numbered since they are a sequence. As sg-task-templates' flow steps:
	current filled in the primary, done checked and still a link, blocked dimmed with the reason in
	its title. States from `$lib/pure/steps`. Labels from sm; a phone keeps the numbers.
-->
<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import { STEPS, type StepKey, type StepState } from '$lib/pure/steps';
	import { cn } from '$lib/utils.js';

	let { states, onPick }: { states: Record<StepKey, StepState>; onPick: (key: StepKey) => void } = $props();
</script>

<nav class="border-border flex shrink-0 items-center overflow-x-auto border-b px-4 py-1.5 sm:px-6" aria-label="Steps" data-slot="builder-steps">
	<ol class="flex items-center gap-1">
		{#each STEPS as step, i (step.key)}
			{@const s = states[step.key]}
			<li class="flex items-center gap-1">
				{#if i > 0}<span class="bg-border hidden h-px w-4 sm:block" aria-hidden="true"></span>{/if}
				<button
					type="button"
					class={cn(
						'focus-visible:ring-ring flex h-8 items-center gap-2 rounded-md px-1.5 text-sm outline-none transition-colors duration-150 focus-visible:ring-2',
						s.state === 'current' ? 'text-foreground font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
						s.state === 'blocked' && 'pointer-events-none opacity-50'
					)}
					disabled={s.state === 'blocked'}
					title={s.state === 'blocked' ? s.reason : step.label}
					aria-current={s.state === 'current' ? 'step' : undefined}
					data-state={s.state}
					onclick={() => onPick(step.key)}
				>
					<span
						class={cn(
							'flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] leading-none font-semibold tabular-nums',
							s.state === 'current' && 'border-primary bg-primary text-primary-foreground',
							s.state === 'done' && 'border-border bg-muted text-foreground',
							(s.state === 'open' || s.state === 'blocked') && 'border-border text-muted-foreground'
						)}
						aria-hidden="true"
					>
						{#if s.state === 'done'}<Check class="size-3" />{:else}{i + 1}{/if}
					</span>
					<span class="hidden sm:inline">{step.label}</span>
				</button>
			</li>
		{/each}
	</ol>
</nav>
