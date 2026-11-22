<!--
	This deployment is a demo: a quiet badge in the header, on every page. Real bids hold prices and
	shot lists, so a studio runs its own copy (docs/deploy.md). It takes no row of its own, so the
	work below keeps the height.
-->
<script lang="ts">
	const DEPLOY = 'https://github.com/ksallee/sg-bids/blob/main/docs/deploy.md';
</script>

<a
	class="border-info/40 text-foreground hover:bg-info/10 focus-visible:ring-ring inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs outline-none focus-visible:ring-2"
	href={DEPLOY}
	target="_blank"
	rel="noopener"
	title="This copy is a demo. For real bids, deploy your own."
	data-slot="demo-banner"
>
	<span class="bg-info size-1.5 rounded-full" aria-hidden="true"></span>
	<span class="font-medium">Demo</span>
	<span class="text-muted-foreground hidden md:inline">Deploy your own for real bids</span>
</a>
