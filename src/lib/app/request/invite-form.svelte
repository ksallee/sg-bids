<!--
	Invite a vendor: a name and a contact email, both required, and optionally the vendor's Group in
	Flow PT, picked from the site's Groups with the registry's EntityPicker (the award writes it to the
	Shot later). A problem sits under its field and names it; an invite that does not pass focuses
	the first field to fix. Checks in `$lib/pure/invitations`. The new link goes to the page, which
	shows it once; on a draft (`pending`) the vendor is added and its link is made at the issue. A
	request of several bids offers them: every bid by default, or some (`vendor-bids-dialog.svelte`).
-->
<script lang="ts">
	import { tick } from 'svelte';
	import type { EntityRef } from 'sg-widgets-core';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import EntityPicker from '$lib/components/entity-picker.svelte';
	import FieldLabel from '$lib/app/field-label.svelte';
	import RequiredLegend from '$lib/app/required-legend.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { api } from '$lib/api';
	import { liveContext } from '$lib/live';
	import { VENDOR_REQUIRED, validateVendor } from '$lib/pure/invitations';
	import type { Id, RequestPackage } from '$lib/pure/model';
	import type { PackageStats } from '$lib/pure/packages';
	import Layers from '@lucide/svelte/icons/layers';
	import VendorBidsDialog from './vendor-bids-dialog.svelte';

	let {
		projectId,
		requestId,
		onInvited,
		primary = true,
		pending = false,
		packages = [],
		stats = new Map()
	}: {
		projectId: number;
		requestId: string;
		/** The vendor is invited. `token`: its link, shown once; null for a vendor added to a draft. */
		onInvited: (name: string, token: string | null) => void;
		/** Invite is the page's primary action. */
		primary?: boolean;
		/** A draft: the vendor is added, its link made at the issue. */
		pending?: boolean;
		/** The request's bids. One or none: nothing to choose. */
		packages?: readonly RequestPackage[];
		stats?: ReadonlyMap<Id, PackageStats>;
	} = $props();

	const choosable = $derived(packages.length > 1);

	let chosen = $state<Id[] | null>(null);
	let choosing = $state(false);
	const chosenLabel = $derived(chosen === null ? 'Every bid' : chosen.length === 1 ? (packages.find((p) => p.id === chosen![0])?.name ?? '1 bid') : `${chosen.length} of ${packages.length} bids`);

	let name = $state('');
	let email = $state('');
	let group = $state<EntityRef | null>(null);
	let tried = $state(false);
	let sending = $state(false);
	let failure = $state<string | null>(null);
	const errors = $derived(validateVendor({ name, email }));
	const IDS = { name: 'v-name', email: 'v-email' } as const;

	async function invite(): Promise<void> {
		tried = true;
		const first = VENDOR_REQUIRED.find((key) => errors[key]);
		if (first) {
			await tick();
			document.getElementById(IDS[first])?.focus();
			return;
		}
		sending = true;
		failure = null;
		try {
			const vendor = { name: name.trim(), email: email.trim(), groupId: group?.id ?? null, packages: choosable ? chosen : null };
			if (pending) {
				const answer = await api.plan(projectId, requestId, vendor);
				onInvited(answer.invitation.name, null);
			} else {
				const answer = await api.invite(projectId, requestId, vendor);
				onInvited(answer.invitation.name, answer.token);
			}
			name = '';
			email = '';
			group = null;
			chosen = null;
			tried = false;
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			sending = false;
		}
	}
</script>

{#snippet problem(key: 'name' | 'email')}
	{#if tried && errors[key]}
		<p id={`${IDS[key]}-message`} class="text-destructive flex items-start gap-1.5 text-xs" data-slot="field-problem">
			<CircleAlert class="mt-px size-3.5 shrink-0" aria-hidden="true" /><span>{errors[key]}</span>
		</p>
	{/if}
{/snippet}

<form class="bg-card text-card-foreground flex flex-col gap-3 rounded-lg border p-4" onsubmit={(e) => (e.preventDefault(), void invite())} aria-label="Invite a vendor" data-slot="invite-form" novalidate>
	<div class="flex items-center justify-between gap-3">
		<p class="text-sm font-semibold">Invite a vendor</p>
		<RequiredLegend />
	</div>
	<div class={choosable ? 'grid items-start gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]' : 'grid items-start gap-3 md:grid-cols-[1fr_1fr_1fr_auto]'}>
		<div class="flex flex-col gap-1.5">
			<FieldLabel for="v-name" required>Vendor</FieldLabel>
			<Input
				id="v-name"
				bind:value={name}
				placeholder="Studio name"
				aria-required="true"
				aria-invalid={tried && errors.name ? 'true' : undefined}
				aria-describedby={tried && errors.name ? 'v-name-message' : undefined}
			/>
			{@render problem('name')}
		</div>
		<div class="flex flex-col gap-1.5">
			<FieldLabel for="v-email" required>Contact email</FieldLabel>
			<Input
				id="v-email"
				type="email"
				bind:value={email}
				placeholder="bids@studio.com"
				aria-required="true"
				aria-invalid={tried && errors.email ? 'true' : undefined}
				aria-describedby={tried && errors.email ? 'v-email-message' : undefined}
			/>
			{@render problem('email')}
		</div>
		<div class="flex flex-col gap-1.5">
			<FieldLabel focus="v-group">Flow PT Group</FieldLabel>
			<div id="v-group" class="contents">
			<EntityPicker
				context={liveContext()}
				entityTypes={['Group']}
				value={group}
				placeholder="No Group"
				onValueChange={(value) => {
					group = value;
					if (value?.name && name.trim() === '') name = value.name;
				}}
			/>
			</div>
		</div>
		{#if choosable}
			<div class="flex flex-col gap-1.5">
				<FieldLabel for="v-packages">Bids</FieldLabel>
				<Button id="v-packages" variant="outline" class="justify-start font-normal" onclick={() => (choosing = true)} data-slot="invite-packages">
					<Layers data-icon="inline-start" />
					<span class="truncate">{chosenLabel}</span>
				</Button>
			</div>
		{/if}
		<div class="flex flex-col gap-1.5">
			<span class="text-sm leading-5 md:invisible" aria-hidden="true">Invite</span>
			<Button type="submit" variant={primary ? 'default' : 'outline'} disabled={sending} data-slot="invite-submit">{sending ? (pending ? 'Adding…' : 'Inviting…') : pending ? 'Add the vendor' : 'Invite'}</Button>
		</div>
	</div>
	{#if failure}<p class="text-destructive text-sm" role="alert">{pending ? 'Not added.' : 'Not invited.'} {failure}</p>{/if}
</form>

<VendorBidsDialog
	bind:open={choosing}
	vendor={name.trim()}
	{packages}
	{stats}
	value={chosen}
	onSave={(next) => {
		chosen = next;
		choosing = false;
	}}
/>
