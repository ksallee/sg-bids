<!--
	The line after an edit to the draft's rows, with Undo. It sits at the foot of the page, bottom
	centre, over the table, and reads out once (`aria-live`). It stays while the pointer or the keyboard is on it, and
	leaves after a while otherwise. Undo runs once; the line then says what came back and what was
	left because Flow PT changed since.
-->
<script lang="ts" module>
	export interface Toast {
		/** A new id per edit, so a second edit starts its own clock. */
		readonly id: number;
		readonly line: string;
		/** Absent when there is nothing to put back. */
		readonly undo?: () => Promise<string>;
	}
</script>

<script lang="ts">
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	let { toast = $bindable(null) }: { toast?: Toast | null } = $props();

	/** How long a line stays when nothing holds it. */
	const STAY_MS = 12000;

	let undoing = $state(false);
	let after = $state<string | null>(null);
	let held = $state(false);

	$effect(() => {
		const shown = toast;
		if (!shown) return;
		undoing = false;
		after = null;
	});

	$effect(() => {
		const shown = toast;
		if (!shown || held || undoing) return;
		const timer = setTimeout(() => {
			if (toast?.id === shown.id) toast = null;
		}, STAY_MS);
		return () => clearTimeout(timer);
	});

	async function undo(): Promise<void> {
		if (!toast?.undo || undoing) return;
		undoing = true;
		try {
			after = await toast.undo();
		} catch (error) {
			after = `Could not undo: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			undoing = false;
		}
	}
</script>

<!-- Bottom centre of the viewport, where a line after an action is looked for. -->
<div class="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-6" aria-live="polite" data-slot="edit-toast-region">
	{#if toast}
		<!-- svelte-ignore a11y_no_static_element_interactions: the pointer and focus only hold the line on screen -->
		<div
			class={cn(
				'bg-popover text-popover-foreground pointer-events-auto flex max-w-2xl min-w-0 items-center gap-3 rounded-lg border py-2 pr-2 pl-4 text-sm shadow-lg',
				'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 duration-150'
			)}
			onpointerenter={() => (held = true)}
			onpointerleave={() => (held = false)}
			onfocusin={() => (held = true)}
			onfocusout={() => (held = false)}
			data-slot="edit-toast"
		>
			<p class="min-w-0 flex-1">{after ?? toast.line}</p>
			{#if toast.undo && after === null}
				<Button size="sm" variant="outline" onclick={() => void undo()} disabled={undoing} data-slot="edit-undo">
					<Undo2 data-icon="inline-start" />{undoing ? 'Undoing…' : 'Undo'}
				</Button>
			{/if}
			<Button size="icon-sm" variant="ghost" class="text-muted-foreground" aria-label="Dismiss" onclick={() => (toast = null)}><X /></Button>
		</div>
	{/if}
</div>
