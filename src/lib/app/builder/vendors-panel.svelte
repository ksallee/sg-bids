<!--
	The vendors of the draft, as rows typed straight in: a name and an email, both required, the
	vendor's Flow PT Group (picked from the site's Groups, or created empty beside the picker when the
	person may create one; the award writes it to the Shots it wins), and the bids it answers, every bid by default. Add vendor makes another row; the cross takes one
	off. A row is saved as typed; a blank one is not. A row's problem shows once it was left, or the
	issue asked for it (`revealed`), each on its field (`f-vendor-<id>-name`). Each vendor gets its
	link at the issue. Rules in `$lib/pure/vendor-rows`.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import EntityPicker from '$lib/components/entity-picker.svelte';
	import GroupCreate from './group-create.svelte';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { liveContext } from '$lib/live';
	import { cn } from '$lib/utils.js';
	import type { Id } from '$lib/pure/model';
	import { controlId } from '$lib/pure/readiness';
	import { answerWords, type GroupRef } from '$lib/pure/group-create';
	import { answered, bidsLabel, isBlank, rowProblems, setBids, toggleBid, type VendorRow } from '$lib/pure/vendor-rows';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, revealed }: { builder: Builder; revealed: ReadonlySet<string> } = $props();

	let left = $state<ReadonlySet<string>>(new Set());
	const leave = (id: string) => () => (left = new Set([...left, id]));

	function shown(row: VendorRow, field: 'name' | 'email'): string | undefined {
		if (isBlank(row)) return undefined;
		const problem = rowProblems(row)[field];
		if (!problem) return undefined;
		const key = `vendor:${row.id}:${field}`;
		return left.has(key) || revealed.has(key) || revealed.has('*') ? problem : undefined;
	}

	async function add(): Promise<void> {
		const id = builder.addVendor();
		await tick();
		document.getElementById(controlId(`vendor:${id}:name`))?.focus();
	}

	/** Whether the person may create a Group, read once before the control shows (recipe 030). */
	let mayCreate = $state(false);
	$effect(() => {
		void builder.groupRight().then((right) => (mayCreate = right.state === 'yes'));
	});

	/** The Group each row created here, by row, so its line says it starts empty. */
	let created = $state<ReadonlyMap<string, number>>(new Map());

	function pickGroup(row: VendorRow, group: GroupRef | null, made = false): void {
		builder.setVendor(row.id, (r) => ({ ...r, group, name: r.name.trim() === '' && group ? group.name : r.name }));
		const next = new Map(created);
		if (made && group) next.set(row.id, group.id);
		else next.delete(row.id);
		created = next;
	}

	const typed = $derived(builder.namedVendors.length);
	const many = $derived(builder.bids.length > 1);
</script>

<section id={controlId('vendors')} class="flex flex-col gap-3 outline-none" aria-labelledby="vendors-heading" tabindex="-1" data-slot="vendors-panel">
	<div class="flex items-baseline justify-between gap-3">
		<h2 id="vendors-heading" class="text-sm font-semibold">Vendors <span class="text-muted-foreground font-normal tabular-nums">{typed}</span></h2>
		<p class="text-muted-foreground text-xs">Each gets one link when you issue.</p>
	</div>
	<div class="text-foreground grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-2 px-2.5 text-xs font-semibold" aria-hidden="true">
		<span>Name<span class="text-destructive ml-0.5">*</span></span>
		<span>Email<span class="text-destructive ml-0.5">*</span></span>
	</div>
	<ul class="flex flex-col gap-2" data-slot="vendor-rows">
		{#each builder.vendors as row, i (row.id)}
			{@const nameProblem = shown(row, 'name')}
			{@const emailProblem = shown(row, 'email')}
			<li class={cn('bg-card flex flex-col gap-2 rounded-lg border p-2.5', (nameProblem || emailProblem) && 'border-destructive/60')} data-slot="vendor-row" data-vendor={row.name}>
				<div class="flex items-start gap-2">
					<div class="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
						<div class="flex min-w-0 flex-col gap-1">
							<label class="sr-only" for={controlId(`vendor:${row.id}:name`)}>Vendor {i + 1} name, required</label>
							<Input
								id={controlId(`vendor:${row.id}:name`)}
								class="h-8"
								value={row.name}
								placeholder="Studio name"
								autocomplete="off" data-lpignore="true" data-1p-ignore data-form-type="other"
								aria-required="true"
								aria-invalid={nameProblem ? 'true' : undefined}
								oninput={(e) => builder.setVendor(row.id, (r) => ({ ...r, name: e.currentTarget.value }))}
								onblur={leave(`vendor:${row.id}:name`)}
								data-slot="vendor-name"
							/>
						</div>
						<div class="flex min-w-0 flex-col gap-1">
							<label class="sr-only" for={controlId(`vendor:${row.id}:email`)}>Vendor {i + 1} email, required</label>
							<Input
								id={controlId(`vendor:${row.id}:email`)}
								class="h-8"
								type="email"
								value={row.email}
								placeholder="bids@studio.com"
								autocomplete="off" data-lpignore="true" data-1p-ignore data-form-type="other"
								aria-required="true"
								aria-invalid={emailProblem ? 'true' : undefined}
								oninput={(e) => builder.setVendor(row.id, (r) => ({ ...r, email: e.currentTarget.value }))}
								onblur={leave(`vendor:${row.id}:email`)}
								data-slot="vendor-email"
							/>
						</div>
					</div>
					<Button
						size="icon-sm"
						variant="ghost"
						class="text-muted-foreground hover:text-destructive shrink-0"
						aria-label={`Take ${row.name.trim() || `vendor ${i + 1}`} off`}
						title={row.linked ? 'Its link was made before. Revoke it once the request is issued.' : 'Take this vendor off'}
						disabled={row.linked}
						onclick={() => builder.removeVendor(row.id)}
						data-slot="vendor-remove"
					>
						<X />
					</Button>
				</div>
				<div class={cn('grid gap-2', many ? 'grid-cols-[minmax(0,1fr)_10rem]' : 'grid-cols-1')}>
					<div class="flex min-w-0 gap-1.5" data-slot="vendor-group">
						<EntityPicker
							context={liveContext()}
							entityTypes={['Group']}
							value={row.group ? { type: 'Group', id: row.group.id, name: row.group.name } : null}
							placeholder="Flow PT Group"
							aria-label={`Vendor ${i + 1} Flow PT Group`}
							class="flex-1"
							onValueChange={(value) => pickGroup(row, value ? { id: value.id, name: value.name ?? `Group ${value.id}` } : null)}
						/>
						{#if mayCreate}
							<GroupCreate {builder} start={row.name} label={row.name.trim() || `vendor ${i + 1}`} onPick={(group, made) => pickGroup(row, group, made)} />
						{/if}
					</div>
					{#if many}
						<Popover.Root>
							<Popover.Trigger
								class="border-input dark:bg-input/30 hover:bg-muted/50 focus-visible:ring-ring/50 flex h-8 min-w-0 items-center gap-1.5 rounded-md border bg-transparent px-2.5 text-left text-sm outline-none focus-visible:ring-3"
								aria-label={`Bids vendor ${i + 1} answers: ${bidsLabel(row, builder.bids)}`}
								data-slot="vendor-bids"
							>
								<span class="text-muted-foreground shrink-0 text-xs">Bids</span>
								<span class="min-w-0 flex-1 truncate">{bidsLabel(row, builder.bids)}</span>
								<ChevronDown class="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
							</Popover.Trigger>
							<Popover.Content class="w-64 p-1" align="end">
								<button
									type="button"
									class="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
									onclick={() => builder.setVendor(row.id, (r) => setBids(r, [], builder.bids))}
									data-slot="vendor-bids-every"
								>
									<span class="flex size-4 items-center justify-center">{#if row.bids === null}<Check class="size-4" />{/if}</span>Every bid
								</button>
								<div class="bg-border my-1 h-px"></div>
								{#each builder.bids as b (b.key)}
									{@const on = answered(row, builder.bids).includes(b.key)}
									<button
										type="button"
										role="menuitemcheckbox"
										aria-checked={on}
										class="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
										onclick={() => builder.setVendor(row.id, (r) => toggleBid(r, b.key as Id, builder.bids))}
										data-slot="vendor-bid-option"
										data-bid={b.name}
									>
										<span class="border-input flex size-4 items-center justify-center rounded-sm border">{#if on}<Check class="size-3.5" />{/if}</span>
										<span class="truncate">{b.name}</span>
									</button>
								{/each}
								<p class="text-muted-foreground px-2 pt-1.5 pb-1 text-xs">A vendor answers one bid at least.</p>
							</Popover.Content>
						</Popover.Root>
					{/if}
				</div>
				{#if row.group && created.get(row.id) === row.group.id}
					<p class="text-muted-foreground text-xs" data-slot="group-created">{answerWords({ state: 'created', group: row.group })}</p>
				{/if}
				{#if nameProblem || emailProblem}
					<p class="text-destructive flex items-start gap-1.5 text-xs" data-slot="field-problem">
						<CircleAlert class="mt-px size-3.5 shrink-0" aria-hidden="true" /><span>{[nameProblem, emailProblem].filter(Boolean).join(' ')}</span>
					</p>
				{/if}
			</li>
		{/each}
	</ul>
	<Button variant="outline" size="sm" class="self-start" onclick={() => void add()} data-slot="add-vendor"><Plus data-icon="inline-start" />Add vendor</Button>
</section>
