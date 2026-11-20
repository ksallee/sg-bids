<!--
	The strip on every page under the header: this deployment is a demo. Real bids hold prices and
	shot lists, so a studio runs its own copy (docs/deploy.md).
-->
<script lang="ts">
	import Info from '@lucide/svelte/icons/info';

	const DEPLOY = 'https://github.com/ksallee/sg-bids/blob/main/docs/deploy.md';
</script>

<div class="border-border bg-info/10 text-foreground flex shrink-0 items-center justify-center gap-2 border-b px-4 py-1.5 text-xs" role="note" data-slot="demo-banner">
	<Info class="text-info size-3.5 shrink-0" aria-hidden="true" />
	<p>
		Demo instance. For real bids, <a class="underline decoration-current/40 underline-offset-2 hover:decoration-current" href={DEPLOY} target="_blank" rel="noopener"
			>deploy your own</a
		>.
	</p>
</div>
