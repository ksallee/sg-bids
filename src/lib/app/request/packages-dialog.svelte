<!--
	Which packages a vendor is invited to: every package, the default, or some of them, each with its
	rows and frames. Used when inviting and when changing a vendor's packages. A vendor sees the rows
	of its packages alone (`$lib/pure/packages`). `locked` says why the packages cannot change: the
	vendor has submitted a bid.
-->
<script lang="ts">
	import Package from '@lucide/svelte/icons/package';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import type { Id, RequestPackage } from '$lib/pure/model';
	import type { PackageStats } from '$lib/pure/packages';
	import { cn } from '$lib/utils.js';

	let {
		open = $bindable(false),
		vendor,
		packages,
		stats,
		value,
		locked = null,
		busy = false,
		error = null,
		onSave
	}: {
		open?: boolean;
		/** The vendor's name, or empty before it is typed. */
		vendor: string;
		packages: readonly RequestPackage[];
		stats: ReadonlyMap<Id, PackageStats>;
		/** Null: every package. */
		value: readonly Id[] | null;
		locked?: string | null;
		busy?: boolean;
		error?: string | null;
		onSave: (packages: Id[] | null) => void;
	} = $props();

	let every = $state(true);
	let picked = $state<Id[]>([]);

	$effect(() => {
		if (!open) return;
		every = value === null;
		picked = value ? [...value] : packages.map((p) => p.id);
	});

	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	const frames = new Intl.NumberFormat();
	function line(id: Id): string {
		const s = stats.get(id);
		if (!s) return '';
		const parts = [s.shots ? plural(s.shots, 'shot') : '', s.assets ? plural(s.assets, 'asset') : ''].filter(Boolean);
		if (s.frames > 0) parts.push(`${frames.format(s.frames)} frames`);
		return parts.length ? parts.join(', ') : 'No rows';
	}

	function toggle(id: Id, on: boolean): void {
		picked = on ? packages.map((p) => p.id).filter((p) => p === id || picked.includes(p)) : picked.filter((p) => p !== id);
	}

	const rows = $derived((every ? packages.map((p) => p.id) : picked).reduce((n, id) => n + (stats.get(id)?.rows ?? 0), 0));
	const empty = $derived(!every && picked.length === 0);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg" data-slot="packages-dialog">
		<Dialog.Header>
			<Dialog.Title>{vendor ? `Packages for ${vendor}` : 'Packages for the vendor'}</Dialog.Title>
			<Dialog.Description>The vendor sees and bids on the rows of its packages, and nothing else.</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col gap-3" role="radiogroup" aria-label="Which packages">
			<label class={cn('flex items-start gap-3 rounded-lg border p-3', every && 'border-primary bg-primary/5')}>
				<input type="radio" name="packages-scope" class="accent-primary mt-0.5 size-4" checked={every} onchange={() => (every = true)} disabled={!!locked} />
				<span class="flex flex-col">
					<span class="text-sm font-semibold">Every package</span>
					<span class="text-muted-foreground text-xs">{plural(packages.length, 'package')}, every row of the request.</span>
				</span>
			</label>
			<label class={cn('flex items-start gap-3 rounded-lg border p-3', !every && 'border-primary bg-primary/5')}>
				<input type="radio" name="packages-scope" class="accent-primary mt-0.5 size-4" checked={!every} onchange={() => (every = false)} disabled={!!locked} />
				<span class="flex flex-col">
					<span class="text-sm font-semibold">Some packages</span>
					<span class="text-muted-foreground text-xs">Pick the ones this vendor bids on.</span>
				</span>
			</label>

			{#if !every}
				<ul class="flex max-h-72 flex-col overflow-y-auto rounded-lg border" data-slot="package-list">
					{#each packages as p (p.id)}
						{@const on = picked.includes(p.id)}
						<li class="border-b last:border-b-0">
							<label class="hover:bg-muted/50 flex cursor-pointer items-center gap-3 px-3 py-2">
								<Checkbox checked={on} onCheckedChange={(v) => toggle(p.id, v === true)} disabled={!!locked} aria-label={p.name} />
								<Package class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
								<span class="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
								<span class="text-muted-foreground shrink-0 text-xs tabular-nums">{line(p.id)}</span>
							</label>
						</li>
					{/each}
				</ul>
			{/if}
			{#if locked}<p class="text-muted-foreground text-sm" role="note">{locked}</p>{/if}
			{#if empty}<p class="text-destructive text-sm" role="alert">Pick at least one package, or every package.</p>{/if}
			{#if error}<p class="text-destructive text-sm" role="alert">{error}</p>{/if}
		</div>

		<Dialog.Footer class="items-center">
			<span class="text-muted-foreground mr-auto text-xs tabular-nums">{plural(rows, 'row')} to bid on</span>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button disabled={!!locked || empty || busy} onclick={() => onSave(every ? null : [...picked])} data-slot="packages-save">{busy ? 'Saving…' : 'Save'}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
