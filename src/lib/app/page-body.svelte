<!--
	The page under its header: it fills the rest of the screen and scrolls on its own, and holds the
	content in the page's measure (`measure.ts`), centred. It is a flex column that grows, so a
	`PageState` inside it sits in the middle of the space left, both ways.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';
	import { MEASURE, type Measure } from './measure';

	let {
		measure = 'full',
		children,
		class: className
	}: {
		measure?: Measure;
		children: Snippet;
		class?: string;
	} = $props();
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-6" data-slot="page-body">
	<div class={cn('mx-auto flex w-full flex-1 flex-col gap-6 py-6', MEASURE[measure], className)}>
		{@render children()}
	</div>
</div>
