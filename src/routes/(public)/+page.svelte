<!--
	Home: what sg-bids is in one sentence, the four steps, Start, then the questions people ask, each
	answered right under it. The words are in `$lib/pure/public-content`; `/llms-full.txt` is written
	from the same place.
-->
<script lang="ts">
	import PublicFooter from '$lib/app/public-footer.svelte';
	import PublicHead from '$lib/app/public-head.svelte';
	import Question from '$lib/app/question.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { HOME } from '$lib/pure/public-content';
</script>

<PublicHead path="/" />

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-slot="home">
	<article class="mx-auto flex w-full max-w-2xl flex-col gap-14 px-4 pt-12 pb-20 sm:px-6 sm:pt-16">
		<header class="flex flex-col items-center gap-10">
			<div class="flex flex-col items-center gap-4 text-center">
				<h1 class="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">{HOME.h1}</h1>
				<p class="text-muted-foreground max-w-xl text-base text-pretty">{HOME.lead}</p>
			</div>

			<ol class="flex w-full max-w-md flex-col gap-4">
				{#each HOME.steps as line, i (line)}
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
				<Button href="/bids" size="lg">Build a bid</Button>
				<Button href="/how" size="lg" variant="outline">How it works</Button>
			</div>
		</header>

		<div class="border-border flex flex-col gap-10 border-t pt-12">
			{#each HOME.questions as question (question.id)}
				<Question {question} />
			{/each}
		</div>

		<PublicFooter path="/" />
	</article>
</div>
