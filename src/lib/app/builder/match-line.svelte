<!--
	One quiet line while breakdown rows wait for their Flow PT row: how many, and Match to Flow PT.
	On a draft and on an issued request alike; the dialog says what linking changes.
-->
<script lang="ts">
	import Link2 from '@lucide/svelte/icons/link-2';
	import MatchDialog from './match-dialog.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { unmatched } from '$lib/pure/match';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder }: { builder: Builder } = $props();

	let open = $state(false);
	const waiting = $derived(unmatched(builder.state.shots).length + unmatched(builder.state.assets).length);
</script>

{#if waiting > 0 && (builder.status === 'draft' || builder.status === 'issued')}
	<div class="text-muted-foreground border-border flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-6 py-2 text-sm" data-slot="match-line">
		<span>{waiting === 1 ? '1 row from the breakdown has' : `${waiting} rows from the breakdown have`} no Flow PT row yet.</span>
		<Button size="sm" variant="outline" onclick={() => (open = true)} data-slot="match-open"><Link2 data-icon="inline-start" />Match to Flow PT</Button>
	</div>
	<MatchDialog {builder} bind:open />
{/if}
