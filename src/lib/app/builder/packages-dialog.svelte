<!--
	The request's packages: each with its rows and frames, renamed in place, duplicated (a copy with no
	rows), deleted (its rows go back to their sequence's package, else to Other shots or Assets), and
	new ones added. Rows move with
	the Package column of the table, one at a time or in bulk. Rules in `$lib/pure/packages`; a
	vendor is invited to every package or to some, on the request's page.
-->
<script lang="ts">
	import Package from '@lucide/svelte/icons/package';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Copy from '@lucide/svelte/icons/copy';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, open = $bindable(false) }: { builder: Builder; open?: boolean } = $props();

	const packages = $derived(builder.packages());
	const stats = $derived(builder.packageStats());
	let fresh = $state('');
	let problem = $state<{ id: string | null; message: string } | null>(null);
	const frames = new Intl.NumberFormat();

	// Each opening starts clean: no word left from the last time.
	$effect(() => {
		if (!open) return;
		problem = null;
		fresh = '';
	});
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

	function add(): void {
		const message = builder.addPackage(fresh);
		problem = message ? { id: null, message } : null;
		if (!message) fresh = '';
	}

	function rename(id: string, name: string, input: HTMLInputElement): void {
		const current = packages.find((p) => p.id === id)?.name;
		if (name.trim() === current) return;
		const message = builder.renamePackage(id, name);
		problem = message ? { id, message } : null;
		if (message && current) input.value = current;
	}

	function duplicate(id: string): void {
		const message = builder.duplicatePackage(id);
		problem = message ? { id, message } : null;
	}

	function remove(id: string): void {
		const message = builder.deletePackage(id);
		problem = message ? { id, message } : null;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="flex max-h-[85vh] flex-col sm:max-w-2xl"
		data-slot="packages-panel"
		onOpenAutoFocus={(e) => {
			e.preventDefault();
			document.getElementById('package-new')?.focus();
		}}
	>
		<Dialog.Header>
			<Dialog.Title>Packages</Dialog.Title>
			<Dialog.Description>
				Named groups of rows. A vendor is invited to every package or to some, and may price a package as one figure. Each row sits in one. Move rows with the Package column.
			</Dialog.Description>
		</Dialog.Header>

		<div class="min-h-0 flex-1 overflow-y-auto">
			<table class="w-full border-separate border-spacing-0 text-sm" data-slot="package-table">
				<thead>
					<tr class="text-muted-foreground text-xs">
						<th class="border-b py-2 pr-3 text-left font-medium">Package</th>
						<th class="border-b px-3 py-2 text-right font-medium">Shots</th>
						<th class="border-b px-3 py-2 text-right font-medium">Assets</th>
						<th class="border-b px-3 py-2 text-right font-medium">Frames</th>
						<th class="border-b py-2 pl-3"><span class="sr-only">Duplicate or delete</span></th>
					</tr>
				</thead>
				<tbody>
					{#each packages as p (p.id)}
						{@const s = stats.get(p.id)}
						<tr data-package={p.id}>
							<td class="border-b py-1.5 pr-3">
								<span class="flex items-center gap-2">
									<Package class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
									<Input
										class="h-8"
										value={p.name}
										aria-label={`Name of ${p.name}`}
										aria-invalid={problem?.id === p.id ? 'true' : undefined}
										onchange={(e) => rename(p.id, e.currentTarget.value, e.currentTarget)}
										onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
									/>
								</span>
							</td>
							<td class="text-muted-foreground border-b px-3 py-1.5 text-right tabular-nums">{s?.shots ?? 0}</td>
							<td class="text-muted-foreground border-b px-3 py-1.5 text-right tabular-nums">{s?.assets ?? 0}</td>
							<td class="text-muted-foreground border-b px-3 py-1.5 text-right tabular-nums">
								{s && s.frames > 0 ? frames.format(s.frames) : ''}{s && s.withoutFrames > 0 ? (s.frames > 0 ? '+' : '') : ''}
							</td>
							<td class="border-b py-1.5 pl-3 text-right whitespace-nowrap">
								<Button size="icon-sm" variant="ghost" aria-label={`Duplicate ${p.name}`} title={`Duplicate ${p.name}: a copy with no rows`} onclick={() => duplicate(p.id)}>
									<Copy />
								</Button>
								<Button size="icon-sm" variant="ghost" class="hover:text-destructive" aria-label={`Delete ${p.name}`} title={`Delete ${p.name}`} onclick={() => remove(p.id)}>
									<Trash2 />
								</Button>
							</td>
						</tr>
						{#if problem?.id === p.id}
							<tr><td colspan="5" class="pb-2"><p class="text-destructive text-xs" role="alert">{problem.message}</p></td></tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>

		<form
			class="flex flex-col gap-1.5 border-t pt-3"
			onsubmit={(e) => {
				e.preventDefault();
				add();
			}}
		>
			<label for="package-new" class="text-sm font-medium">Add a package</label>
			<div class="flex gap-2">
				<Input id="package-new" class="h-9" placeholder="Creature, all the comps" bind:value={fresh} aria-invalid={problem?.id === null ? 'true' : undefined} />
				<Button type="submit" variant="outline">Add</Button>
			</div>
			{#if problem && problem.id === null}<p class="text-destructive text-xs" role="alert">{problem.message}</p>{/if}
			<p class="text-muted-foreground text-xs">
				{plural(packages.length, 'package')}. Deleting one sends its rows back to their sequence's package, else to Other shots or Assets.
			</p>
		</form>
	</Dialog.Content>
</Dialog.Root>
