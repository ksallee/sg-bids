<!--
	After Undo award: the rows a publish created that the undo left in Flow PT, and why. One line,
	dismissible. State in `./undo-state.svelte.ts`.
-->
<script lang="ts">
	import Notice from '$lib/app/notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { undoNote } from './undo-state.svelte';

	let { requestId }: { requestId: string } = $props();
</script>

{#if undoNote.line && undoNote.requestId === requestId}
	<Notice tone="info" data-slot="undo-left">
		{undoNote.line}
		{#snippet action()}<Button size="sm" variant="ghost" onclick={() => (undoNote.line = null)}>Dismiss</Button>{/snippet}
	</Notice>
{/if}
