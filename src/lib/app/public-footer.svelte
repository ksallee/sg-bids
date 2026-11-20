<!--
	The foot of a public page: when its words last changed (`PUBLIC_PAGES`' lastmod, as the sitemap
	says), the license, and the code.
-->
<script lang="ts">
	import { longDay, publicPage, REPO } from '$lib/pure/seo';

	let { path }: { path: string } = $props();
	const day = $derived(publicPage(path)?.lastmod ?? '');
</script>

<footer class="border-border text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 border-t pt-6 text-xs" data-slot="public-footer">
	<span>Updated <time datetime={day}>{longDay(day)}</time>.</span>
	<span>Open source, MIT.</span>
	<a class="hover:text-foreground underline underline-offset-2" href={REPO}>The code on GitHub</a>
</footer>
