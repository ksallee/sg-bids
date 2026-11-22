<!--
	Where the draft stands against storage, in the page header's context line: saving, saved, or why
	it failed. A failed save is tried again with the next change.
-->
<script lang="ts">
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder }: { builder: Builder } = $props();
	const s = $derived(builder.saving);
	const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
</script>

<span data-slot="save-line" data-state={s.kind} role="status">
	{#if s.kind === 'saving'}
		Saving…
	{:else if s.kind === 'saved'}
		Saved {time.format(s.at)}
	{:else if s.kind === 'error'}
		<span class="text-destructive">Not saved. {s.message}</span>
		<button type="button" class="hover:text-foreground ml-1 underline decoration-current/30 underline-offset-2" onclick={() => void builder.flush()}>Try again</button>
	{:else}
		Not saved yet
	{/if}
</span>
