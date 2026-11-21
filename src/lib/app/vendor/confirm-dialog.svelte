<!--
	A modal step before a move that cannot be undone: submit, withdraw. The native dialog: Escape
	and the back button close it, focus stays inside.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		open,
		title,
		confirm,
		tone = 'default',
		busy = false,
		error = null,
		disabled = false,
		onconfirm,
		oncancel,
		children
	}: {
		open: boolean;
		title: string;
		confirm: string;
		tone?: 'default' | 'destructive';
		busy?: boolean;
		error?: string | null;
		/** The confirm stays off: something must be fixed first, said in the body. */
		disabled?: boolean;
		onconfirm: () => void;
		/** Closed without confirming: the Back button, Escape. */
		oncancel: () => void;
		children: Snippet;
	} = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	const uid = $props.id();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	class="bg-popover text-popover-foreground m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border p-0 shadow-lg backdrop:bg-black/40"
	aria-labelledby={`${uid}-title`}
	onclose={() => open && oncancel()}
>
	<div class="flex flex-col gap-4 p-5">
		<h2 id={`${uid}-title`} class="text-base font-semibold">{title}</h2>
		<div class="flex flex-col gap-3 text-sm">{@render children()}</div>
		{#if error}<p class="text-destructive text-sm" role="alert">{error}</p>{/if}
		<div class="flex flex-wrap justify-end gap-2">
			<Button variant="outline" onclick={oncancel} disabled={busy}>Back to your answer</Button>
			<Button variant={tone === 'destructive' ? 'destructive' : 'default'} onclick={onconfirm} disabled={busy || disabled}>{busy ? 'Working' : confirm}</Button>
		</div>
	</div>
</dialog>
