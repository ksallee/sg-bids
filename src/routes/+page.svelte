<!--
	Home: what the app does, in four lines, and one Start.
-->
<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';

	const lines = [
		'Build a bid request from your Shots and Assets in Flow PT.',
		'Vendors answer through a link. They need no Flow PT account.',
		'Compare the bids shot by shot, in one currency.',
		'Award, and the award is written to Flow PT.'
	];
</script>

<svelte:head><title>SG Bids</title></svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-slot="home">
	<div class="mx-auto flex w-full max-w-2xl flex-col items-center gap-10 px-4 pt-12 pb-16 sm:px-6 sm:pt-16">
		<div class="flex flex-col items-center gap-4 text-center">
			<h1 class="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">VFX bidding for Flow Production Tracking.</h1>
			<p class="text-muted-foreground text-base text-balance">Open source, MIT.</p>
		</div>

		<ol class="flex w-full max-w-md flex-col gap-4">
			{#each lines as line, i (line)}
				<li class="flex gap-3 text-sm">
					<span
						class="border-border text-muted-foreground mt-px flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums"
						aria-hidden="true">{i + 1}</span
					>
					<span class="pt-0.5">{line}</span>
				</li>
			{/each}
		</ol>

		<div class="flex flex-wrap items-center justify-center gap-3">
			<Button href="/connect" size="lg">Start</Button>
			<Button href="/how" size="lg" variant="outline">How it works</Button>
		</div>
	</div>
</div>
