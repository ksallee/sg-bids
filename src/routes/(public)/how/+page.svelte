<!--
	How it works: the five steps, with what each keeps in the app and what it reads from or writes to
	Flow PT, side by side. Then the questions: vendors without a Flow PT account, what is written, what
	stays, what vendors see, currencies and rebates, and the site setup an admin does once. Each is a
	heading with the answer right under it. The words are in `$lib/pure/public-content`, the field
	list in `$lib/pure/fpt-fields`, so it stays the one the app creates.
-->
<script lang="ts">
	import PublicFooter from '$lib/app/public-footer.svelte';
	import PublicHead from '$lib/app/public-head.svelte';
	import Question from '$lib/app/question.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { FIELD_TABLES, FIELD_TYPE, HOW, type Step } from '$lib/pure/public-content';
	import { cn } from '$lib/utils.js';

	const MARK: Record<Step['fpt']['kind'], string> = {
		read: 'border-info/50 bg-info/10',
		write: 'border-success/60 bg-success/10',
		none: 'border-dashed text-muted-foreground'
	};
	const VERB: Record<Step['fpt']['kind'], string> = { read: 'Reads', write: 'Writes', none: 'None' };
</script>

<PublicHead path="/how" />

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-slot="how">
	<article class="mx-auto flex w-full max-w-4xl flex-col gap-14 px-4 pt-10 pb-20 sm:px-6 sm:pt-14">
		<header class="flex max-w-2xl flex-col gap-3">
			<nav aria-label="Breadcrumb" class="text-muted-foreground text-xs">
				<ol class="flex gap-1.5">
					<li><a class="hover:text-foreground underline-offset-2 hover:underline" href="/">Home</a></li>
					<li aria-hidden="true">/</li>
					<li aria-current="page">{HOW.h1}</li>
				</ol>
			</nav>
			<h1 class="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">{HOW.h1}</h1>
			<p class="text-muted-foreground text-base text-pretty">{HOW.lead}</p>
		</header>

		<section class="flex flex-col gap-4" aria-labelledby={HOW.steps.id}>
			<h2 id={HOW.steps.id} class="text-lg font-semibold">{HOW.steps.q}</h2>
			<p class="max-w-3xl text-sm text-pretty">{HOW.steps.a}</p>
			<div class="text-muted-foreground hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-6 px-1 text-xs font-medium md:grid" aria-hidden="true">
				<span>Step</span><span>Kept in the app</span><span>Flow PT</span>
			</div>
			<ol class="border-border flex flex-col border-t">
				{#each HOW.steps.items as step, i (step.title)}
					<li class="border-border grid gap-3 border-b py-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-6 md:px-1">
						<div class="flex gap-3">
							<span
								class="border-border text-muted-foreground mt-px flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums"
								aria-hidden="true">{i + 1}</span
							>
							<div class="flex min-w-0 flex-col gap-1">
								<h3 class="text-sm font-semibold">{step.title}</h3>
								<p class="text-muted-foreground text-sm text-pretty">{step.line}</p>
							</div>
						</div>
						<div class="flex flex-col gap-1 pl-9 text-sm md:pl-0">
							<span class="text-muted-foreground text-xs md:hidden">Kept in the app</span>
							<p class="bg-muted/50 rounded-md border px-3 py-2">{step.app}</p>
						</div>
						<div class="flex flex-col gap-1 pl-9 text-sm md:pl-0">
							<span class="text-muted-foreground text-xs md:hidden">Flow PT</span>
							<p class={cn('rounded-md border px-3 py-2', MARK[step.fpt.kind])}>
								<span class="sr-only">{VERB[step.fpt.kind]}: </span>{step.fpt.text}
							</p>
						</div>
					</li>
				{/each}
			</ol>
		</section>

		<Question question={HOW.vendors} />

		<div class="grid gap-10 md:grid-cols-2">
			<Question question={HOW.written} />
			<Question question={HOW.stays} />
		</div>

		<section class="flex flex-col gap-4" aria-labelledby={HOW.see.id}>
			<h2 id={HOW.see.id} class="text-lg font-semibold">{HOW.see.q}</h2>
			<p class="max-w-3xl text-sm text-pretty">{HOW.see.a}</p>
			<div class="grid gap-4 md:grid-cols-2">
				<div class="flex flex-col gap-2 rounded-lg border p-4">
					<h3 class="text-sm font-semibold">They can see</h3>
					<ul class="flex list-disc flex-col gap-1.5 pl-5 text-sm">
						{#each HOW.see.can as line (line)}<li>{line}</li>{/each}
					</ul>
				</div>
				<div class="flex flex-col gap-2 rounded-lg border p-4">
					<h3 class="text-sm font-semibold">They cannot see</h3>
					<ul class="flex list-disc flex-col gap-1.5 pl-5 text-sm">
						{#each HOW.see.cannot as line (line)}<li>{line}</li>{/each}
					</ul>
				</div>
			</div>
			<div class="border-warning/60 bg-warning/10 flex max-w-3xl flex-col gap-2 rounded-lg border px-4 py-3 text-sm">
				<p class="font-medium">{HOW.see.warning.title}</p>
				<p>{HOW.see.warning.text}</p>
			</div>
		</section>

		<Question question={HOW.money} />

		<section class="flex flex-col gap-6" aria-labelledby={HOW.admin.id}>
			<div class="flex max-w-3xl flex-col gap-3">
				<h2 id={HOW.admin.id} class="text-lg font-semibold">{HOW.admin.q}</h2>
				<p class="text-sm text-pretty">{HOW.admin.a}</p>
				<p class="text-muted-foreground text-sm">{HOW.admin.note}</p>
			</div>
			<ol class="flex max-w-3xl flex-col gap-3">
				{#each HOW.admin.list as line, i (line)}
					<li class="flex gap-3 text-sm">
						<span
							class="border-border text-muted-foreground mt-px flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums"
							aria-hidden="true">{i + 1}</span
						>
						<span class="pt-0.5 text-pretty">{line}</span>
					</li>
				{/each}
			</ol>

			<div class="grid gap-6 md:grid-cols-2">
				{#each FIELD_TABLES as table (table.title)}
					<div class="flex min-w-0 flex-col gap-2">
						<h3 class="text-sm font-semibold">{table.title}</h3>
						<table class="w-full text-sm">
							<thead class="text-muted-foreground text-left text-xs">
								<tr class="border-b"><th class="py-1.5 pr-3 font-medium">Field</th><th class="py-1.5 pr-3 font-medium">Name</th><th class="py-1.5 font-medium">Type</th></tr>
							</thead>
							<tbody>
								{#each table.fields as field (field.name)}
									<tr class="border-b last:border-b-0">
										<td class="py-1.5 pr-3">{field.display}{#if field.stock}<span class="text-muted-foreground"> (stock)</span>{/if}</td>
										<td class="py-1.5 pr-3 font-mono text-xs break-all">{field.name}</td>
										<td class="py-1.5">{FIELD_TYPE[field.dataType]}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/each}
			</div>
			<p class="text-muted-foreground max-w-3xl text-sm">{HOW.admin.fieldsNote}</p>

			<div class="flex max-w-3xl flex-col gap-2">
				<h3 class="text-sm font-semibold">{HOW.admin.reverseTitle}</h3>
				<p class="text-sm text-pretty">{HOW.admin.reverseLine}</p>
				<ul class="flex flex-col gap-1.5 text-sm">
					{#each HOW.admin.reverse as r (r.name)}
						<li><span class="font-medium">On {r.on}:</span> “{r.name}”, {r.what}.</li>
					{/each}
				</ul>
			</div>
		</section>

		<div class="flex flex-wrap gap-3">
			<Button href="/requests">Make a request</Button>
			<Button variant="outline" href="/">Home</Button>
		</div>

		<PublicFooter path="/how" />
	</article>
</div>
