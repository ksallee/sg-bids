<!--
	Adding Shots or Assets from Flow PT, as its own surface: it takes over the items area, full width
	and full height, with a title, the count added on this visit, and Done. Escape is Done too, unless
	it is clearing the search. Focus moves to the search on open; the panel returns it to the button
	that opened it. The picking itself is `pick-table.svelte`, unchanged: a tick adds the row at once
	and the picker stays open.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import PickTable from './pick-table.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ItemKind } from '$lib/pure/field-map';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, kind, added, ondone }: { builder: Builder; kind: ItemKind; added: number; ondone: () => void } = $props();

	const noun = $derived(kind === 'shot' ? 'shots' : 'assets');
	let box = $state<HTMLElement | null>(null);

	onMount(() => {
		// The search shows once the project is read: wait for it, a few frames at most.
		let tries = 0;
		const focus = async () => {
			await tick();
			const search = box?.querySelector<HTMLInputElement>('[data-slot=pick-search]');
			if (search) search.focus();
			else if (tries++ < 40) requestAnimationFrame(() => void focus());
			else box?.focus();
		};
		void focus();
	});

	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		const target = event.target as HTMLElement | null;
		// Escape in a search with text clears it, as the browser does.
		if (target instanceof HTMLInputElement && target.type === 'search' && target.value !== '') return;
		event.preventDefault();
		ondone();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions: Escape closes the picker from anywhere inside it -->
<section
	bind:this={box}
	class="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
	aria-labelledby="fpt-picker-title"
	tabindex="-1"
	onkeydown={keydown}
	data-slot="fpt-picker"
>
	<div class="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-6 py-2">
		<div class="flex min-w-0 flex-1 items-baseline gap-3">
			<h2 id="fpt-picker-title" class="text-base font-semibold tracking-tight">Add {noun} from Flow PT</h2>
			<p class="text-muted-foreground text-sm tabular-nums" aria-live="polite" data-slot="picker-count">
				{added === 0 ? `Tick the ${noun} to add. Each one goes in at once.` : `${added} added`}
			</p>
		</div>
		<Button onclick={ondone} data-slot="picker-done"><Check data-icon="inline-start" />Done</Button>
	</div>
	<PickTable {builder} {kind} />
</section>
