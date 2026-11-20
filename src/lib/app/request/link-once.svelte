<!--
	A vendor's link, shown once: the link in a read only field, Copy, and a plain warning that it
	cannot be shown again. Only the link's hash is stored, so closing this loses it; New link makes
	another and retires this one.
-->
<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	let { name, link, onDone }: { name: string; link: string; onDone: () => void } = $props();

	let copied = $state(false);
	let failed = $state(false);

	async function copy(): Promise<void> {
		failed = false;
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
		} catch {
			failed = true;
		}
	}
</script>

<section class="border-warning/60 bg-warning/10 flex flex-col gap-3 rounded-lg border p-4" aria-label="The vendor's link" data-slot="link-once">
	<div class="flex items-start gap-3">
		<KeyRound class="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
		<div class="flex flex-col gap-1">
			<h2 class="text-sm font-semibold">The link for {name}</h2>
			<p class="text-sm">This link shows once. Copy it now and send it to the vendor. It cannot be shown again. If it is lost, make a new link.</p>
		</div>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<Input class="h-9 min-w-0 flex-1 font-mono text-xs" readonly value={link} aria-label="Vendor link" onfocus={(e) => e.currentTarget.select()} data-slot="link-value" />
		<Button onclick={() => void copy()} data-slot="copy-link">
			{#if copied}<Check data-icon="inline-start" />Copied{:else}<Copy data-icon="inline-start" />Copy the link{/if}
		</Button>
		<Button variant="ghost" onclick={onDone}>Done</Button>
	</div>
	{#if failed}<p class="text-destructive text-sm">The browser refused to copy. Select the link and copy it by hand.</p>{/if}
</section>
