<!-- One line on a form with required and optional fields: what the asterisk means. -->
<script lang="ts">
	import { cn } from '$lib/utils.js';

	let { class: className }: { class?: string } = $props();
</script>

<p class={cn('text-muted-foreground text-xs', className)} data-slot="required-legend">
	<span aria-hidden="true"><span class="text-destructive">*</span> Required</span>
	<span class="sr-only">Required fields are marked with an asterisk.</span>
</p>
