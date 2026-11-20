<!--
	The head of a public page: its title, description, canonical URL, Open Graph and Twitter tags
	(`$lib/pure/seo`), and its JSON-LD (`$lib/pure/structured-data`). The JSON-LD is data, never run:
	`ldJson` escapes every `<`, and a data block needs no CSP allowance.
-->
<script lang="ts">
	import { pageHead } from '$lib/pure/seo';
	import { ldJson, pageLd } from '$lib/pure/structured-data';
	import { SITE_URL } from '$lib/site-url';

	let { path }: { path: string } = $props();

	const head = $derived(pageHead(path, SITE_URL));
	const ld = $derived(pageLd(path, SITE_URL).map((block) => `<script type="application/ld+json">${ldJson(block)}</` + 'script>'));
</script>

<svelte:head>
	<title>{head.title}</title>
	{#each head.tags as tag (`${tag.kind}:${tag.id}`)}
		{#if tag.kind === 'link'}
			<link rel={tag.id} href={tag.value} type={tag.type} />
		{:else if tag.key === 'property'}
			<meta property={tag.id} content={tag.value} />
		{:else}
			<meta name={tag.id} content={tag.value} />
		{/if}
	{/each}
	{#each ld as block, i (i)}
		{@html block}
	{/each}
</svelte:head>
