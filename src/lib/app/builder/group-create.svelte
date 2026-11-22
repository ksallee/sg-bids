<!--
	Create a vendor's Group in Flow PT from its row, beside the Group picker. Shown only when the
	person may create a Group (the vendors panel reads it first). The name starts as the vendor's
	name. A live Group of the same name is warned about as it is typed, and offered instead: names
	are not unique in Flow PT. The Group is created empty, as the person; its people are added in Flow
	PT. Rules and words in `$lib/pure/group-create`.
-->
<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Notice from '$lib/app/notice.svelte';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { answerWords, clashWords, groupName, type GroupAnswer, type GroupRef } from '$lib/pure/group-create';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, start, label, onPick }: { builder: Builder; start: string; label: string; onPick: (group: GroupRef, created: boolean) => void } = $props();

	let open = $state(false);
	let name = $state('');
	let matches = $state<readonly GroupRef[]>([]);
	let checked = $state('');
	let creating = $state(false);
	let answer = $state<GroupAnswer | null>(null);

	const clean = $derived(groupName(name));

	function opened(next: boolean): void {
		open = next;
		if (!next) return;
		name = start.trim();
		matches = [];
		checked = '';
		answer = null;
	}

	// The name is looked for in Flow PT as it is typed, the last answer kept.
	let asked = 0;
	$effect(() => {
		if (!open || !clean.ok) return;
		const wanted = clean.name;
		const ticket = ++asked;
		const timer = setTimeout(async () => {
			try {
				const found = await builder.findGroups(wanted);
				if (ticket !== asked) return;
				matches = found;
				checked = wanted;
			} catch {
				// The create looks again before it sends.
			}
		}, 300);
		return () => clearTimeout(timer);
	});

	const clash = $derived(clean.ok && checked === clean.name ? matches : []);

	function use(group: GroupRef): void {
		onPick(group, false);
		open = false;
	}

	async function create(): Promise<void> {
		if (!clean.ok || clash.length > 0) return;
		creating = true;
		answer = null;
		try {
			const result = await builder.createGroup(clean.name);
			if (result.state === 'created') {
				onPick(result.group, true);
				open = false;
			} else if (result.state === 'exists') {
				matches = result.matches;
				checked = result.name;
			} else answer = result;
		} catch (error) {
			answer = { state: 'failed', status: 0, title: error instanceof Error ? error.message : String(error) };
		} finally {
			creating = false;
		}
	}
</script>

<Popover.Root bind:open={() => open, opened}>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button {...props} size="icon-sm" variant="outline" class="size-8 shrink-0" aria-label={`Create a Group for ${label}`} title="Create a Group in Flow PT" data-slot="group-create-open">
				<Plus />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="flex w-80 flex-col gap-3 p-3" align="end" data-slot="group-create">
		<form class="flex flex-col gap-3" onsubmit={(e) => (e.preventDefault(), void create())}>
			<div class="flex flex-col gap-1.5">
				<label class="text-sm font-semibold" for="group-create-name">New Group in Flow PT</label>
				<Input id="group-create-name" class="h-8" bind:value={name} placeholder="Group name" autocomplete="off" data-slot="group-create-name" />
				<p class="text-muted-foreground text-xs" data-slot="group-create-empty">It starts empty. Add its people in Flow PT.</p>
			</div>
			{#if clash.length > 0 && clean.ok}
				<Notice tone="warning" data-slot="group-clash">{clashWords(clean.name, clash)}</Notice>
				<ul class="flex flex-col gap-1">
					{#each clash.slice(0, 3) as g (g.id)}
						<li>
							<Button variant="secondary" size="sm" class="w-full justify-start" onclick={() => use(g)} data-slot="group-use" data-group-id={String(g.id)}>Use {g.name}</Button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if answer}
				<Notice tone="destructive" data-slot="group-create-answer">{answerWords(answer)}</Notice>
			{/if}
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (open = false)} disabled={creating}>Cancel</Button>
				<Button type="submit" size="sm" disabled={creating || !clean.ok || clash.length > 0} data-slot="group-create-confirm">
					{creating ? 'Creating…' : 'Create Group'}
				</Button>
			</div>
		</form>
	</Popover.Content>
</Popover.Root>
