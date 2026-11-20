<!--
	What stops a submit, each named by its field: a link that takes the vendor to the control and
	focuses it, a price row in the grid among them. The pattern the request builder's summary uses.
	Problems from `$lib/pure/bid-form`.
-->
<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import type { FormProblem } from '$lib/pure/bid-form';
	import { cn } from '$lib/utils.js';

	let { problems, onPick, class: className }: { problems: readonly FormProblem[]; onPick: (problem: FormProblem) => void; class?: string } = $props();
	const uid = $props.id();
</script>

{#if problems.length > 0}
	<div class={cn('flex flex-col gap-1.5', className)} data-slot="form-problems">
		<p class="text-sm font-medium" id={`${uid}-title`}>{problems.length === 1 ? 'One thing to fix before you submit:' : `${problems.length} things to fix before you submit:`}</p>
		<ul class="flex flex-col gap-1" aria-labelledby={`${uid}-title`}>
			{#each problems as p (p.key)}
				<li>
					<button
						type="button"
						class="hover:bg-muted focus-visible:ring-ring -mx-1 flex w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left text-xs outline-none focus-visible:ring-2"
						data-control={p.control}
						onclick={() => onPick(p)}
					>
						<CircleAlert class="text-destructive mt-px size-3.5 shrink-0" aria-hidden="true" />
						<span class="underline decoration-current/30 underline-offset-2"><span class="font-medium">{p.label}:</span> <span class="text-destructive">{p.message}</span></span>
					</button>
				</li>
			{/each}
		</ul>
	</div>
{/if}
