<!--
	A question of a public page as a section: the question as its heading, the direct answer under it,
	then its list, note and link. The words are in `$lib/pure/public-content`. `children` goes after
	the answer, for a section that shows more than a list.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Question } from '$lib/pure/public-content';

	let { question, ordered = false, children }: { question: Question; ordered?: boolean; children?: Snippet } = $props();
</script>

<section class="flex flex-col gap-3" aria-labelledby={question.id} data-slot="question">
	<h2 id={question.id} class="scroll-mt-4 text-lg font-semibold text-balance">{question.q}</h2>
	<p class="max-w-3xl text-sm text-pretty">{question.a}</p>
	{#if question.list?.length}
		{#if ordered}
			<ol class="flex max-w-3xl list-decimal flex-col gap-2 pl-5 text-sm">
				{#each question.list as line (line)}<li class="text-pretty">{line}</li>{/each}
			</ol>
		{:else}
			<ul class="flex max-w-3xl list-disc flex-col gap-2 pl-5 text-sm">
				{#each question.list as line (line)}<li class="text-pretty">{line}</li>{/each}
			</ul>
		{/if}
	{/if}
	{#if question.note}<p class="text-muted-foreground max-w-3xl text-sm text-pretty">{question.note}</p>{/if}
	{@render children?.()}
	{#if question.link}
		<p class="text-sm">
			<a class="text-primary underline decoration-current/40 underline-offset-2 hover:decoration-current" href={question.link.href}>{question.link.text}</a>
		</p>
	{/if}
</section>
