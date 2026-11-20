<!--
	The share image's source: a 1200 by 630 card in the default theme, light. The name, what it is in
	one line, and the real comparison grid on demo data (`demo.ts`), cropped by the card's edge.
	`pnpm og` shoots `[data-slot="og-card"]` to static/og.png. It covers the app's frame, so the card
	sits alone at the top left of the window.
-->
<script lang="ts">
	import CompareGrid from '$lib/app/compare/compare-grid.svelte';
	import { CompareState } from '$lib/app/compare/state.svelte';
	import Wordmark from '$lib/app/wordmark.svelte';
	import { DEMO } from './demo';

	const s = new CompareState(0, DEMO.request.id);
	s.data = DEMO;
	s.scenarios = [...DEMO.scenarios];
	s.open(DEMO.scenarios[0]);
	// The rows, shot by shot, over the totals: the card shows the comparison itself.
	s.showTotals = false;
</script>

<svelte:head><title>Share image · SG Bids</title></svelte:head>

<div class="bg-background fixed inset-0 z-50 overflow-hidden">
	<div class="bg-background text-foreground relative overflow-hidden" style="width:1200px;height:630px" data-slot="og-card">
		<div class="absolute top-0 left-0 flex h-full flex-col justify-between" style="width:500px;padding:64px 0 60px 64px">
			<div style="zoom:1.75"><Wordmark /></div>
			<div class="flex flex-col" style="gap:22px">
				<h1 class="font-semibold text-balance" style="font-size:54px;line-height:1.06;letter-spacing:-0.025em">VFX bidding for Flow Production Tracking.</h1>
				<p class="text-muted-foreground text-pretty" style="font-size:25px;line-height:1.3">Vendors bid through a link. Compare shot by shot in one currency. Award to Flow PT.</p>
			</div>
			<p class="text-muted-foreground" style="font-size:20px">Free and open source, MIT</p>
		</div>

		<div class="bg-card absolute flex flex-col overflow-hidden rounded-xl border shadow-2xl" style="left:560px;top:64px;width:760px;height:640px">
			<div class="flex min-h-0 flex-1 flex-col" style="pointer-events:none">
				<CompareGrid state={s} onDetail={() => {}} />
			</div>
		</div>
	</div>
</div>
