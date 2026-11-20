<!--
	The app's mark and lockup, a sibling of sg-task-templates' and sg-notes' in its type and its two
	inks: the accent once, the quiet ink for the rest. The mark: three bids side by side, the awarded
	one in the accent. `src/lib/assets/favicon.svg` is this drawing with the default palette's values
	pinned.
-->
<script lang="ts">
	let { title = 'SG Bids', size = '1.25em' }: { title?: string; size?: string } = $props();
	const head = $derived(title.split(' ')[0] ?? '');
	const tail = $derived(title.split(' ').slice(1).join(' '));
</script>

<span class="wordmark" translate="no">
	<svg class="mark" style="width:{size};height:{size}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
		<rect class="quiet" x="4" y="10" width="6.5" height="18" rx="1.5" />
		<rect class="accent" x="12.75" y="16" width="6.5" height="12" rx="1.5" />
		<rect class="quiet" x="21.5" y="5" width="6.5" height="23" rx="1.5" />
	</svg>
	<span class="type"><span class="head">{head}</span> <span class="tail">{tail}</span></span>
</span>

<style>
	.wordmark {
		display: inline-flex;
		align-items: center;
		gap: 0.45em;
		font-size: 1rem;
		line-height: 1.1;
		letter-spacing: -0.01em;
		white-space: nowrap;
		min-width: 0;
	}

	.mark {
		display: block;
		flex: none;
		--ground: var(--mark-ground, var(--background));
	}

	.accent {
		fill: var(--primary);
	}

	.quiet {
		fill: color-mix(in oklab, currentColor 30%, var(--ground));
	}

	.head {
		font-weight: 600;
	}

	.tail {
		font-weight: 400;
		color: var(--muted-foreground);
	}
</style>
