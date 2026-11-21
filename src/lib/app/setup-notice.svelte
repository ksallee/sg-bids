<!--
	One quiet line when the site is not set up for the award: Bid or Bid Line is missing, or two
	entities carry one name. It says what is missing, that the work up to the award goes on without it,
	and the exact step for an admin. Never blocking, read once per session (`setup-check.ts`),
	dismissed per site in this browser, silent when the site is ready or the read fails.
-->
<script lang="ts">
	import Notice from '$lib/app/notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { liveState } from '$lib/live';
	import type { SetupNotice } from '$lib/pure/setup-notice';
	import { dismissNotice, siteNotice } from './setup-check';
	import { cn } from '$lib/utils.js';

	let { class: className }: { class?: string } = $props();

	let notice = $state<SetupNotice | null>(null);
	const site = liveState().siteUrl;
	if (site) void siteNotice(site).then((n) => (notice = n));

	function dismiss(): void {
		if (notice && site) dismissNotice(site, notice);
		notice = null;
	}
</script>

{#if notice}
	<div class={cn('border-border border-b px-6 py-2.5', className)} data-slot="setup-notice">
		<Notice tone="info" title={notice.title}>
			{' '}{notice.lines.join(' ')} {notice.step}
			{#snippet action()}<Button size="sm" variant="ghost" onclick={dismiss} data-slot="setup-dismiss">Dismiss</Button>{/snippet}
		</Notice>
	</div>
{/if}
