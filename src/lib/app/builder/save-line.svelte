<!--
	Where the bid stands against storage, in the page header's context line: saving, saved, what it
	waits for, or why it failed (then it is kept in this tab).
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
	{:else if s.kind === 'waiting'}
		Not saved yet. {s.reason}
	{:else if s.kind === 'error'}
		<span class="text-destructive">Not saved. {s.message} Kept in this tab.</span>
	{:else}
		Not saved yet
	{/if}
</span>
