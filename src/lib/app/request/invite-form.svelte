<!--
	Invite a vendor to an issued request: a name and a contact email, both required, and optionally the
	vendor's Group in Flow PT, picked from the site's Groups (the award writes it to the Shots it wins).
	A request of several bids offers them: every bid by default, or some. A problem sits under its field
	and names it; an invite that does not pass focuses the first field to fix. Checks in
	`$lib/pure/invitations`. The new link goes to the page, which shows it once. A draft's vendors are
	rows on its page instead (`vendors-panel`).
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

	let {
		projectId,
		requestId,
		onInvited,
		onCancel,
		packages = []
	}: {
		projectId: number;
		requestId: string;
		/** The vendor is invited: its name, its link (shown once) and its invitation id. */
		onInvited: (name: string, token: string | null, id: string | null) => void;
		onCancel?: () => void;
		/** The request's bids. One or none: nothing to choose. */
		packages?: readonly RequestPackage[];
	} = $props();

	const choosable = $derived(packages.length > 1);
	let picked = $state<Id[]>([]);
	let name = $state('');
	let email = $state('');
	let group = $state<EntityRef | null>(null);
	let tried = $state(false);
	let sending = $state(false);
	let failure = $state<string | null>(null);
	const errors = $derived(validateVendor({ name, email }));
	const IDS = { name: 'v-name', email: 'v-email' } as const;

	function toggle(id: Id): void {
		const all = picked.length === 0 ? packages.map((p) => p.id) : picked;
		picked = all.includes(id) ? (all.length > 1 ? all.filter((p) => p !== id) : all) : [...all, id];
	}
	const every = $derived(picked.length === 0 || picked.length === packages.length);

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
			const answer = await api.invite(projectId, requestId, { name: name.trim(), email: email.trim(), groupId: group?.id ?? null, packages: choosable && !every ? picked : null });
			onInvited(answer.invitation.name, answer.token, answer.invitation.id);
			name = '';
			email = '';
			group = null;
			picked = [];
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
		<p class="text-sm font-semibold">Invite another vendor</p>
		<RequiredLegend />
	</div>
	<div class="grid items-start gap-3 md:grid-cols-3">
		<div class="flex flex-col gap-1.5">
			<FieldLabel for="v-name" required>Vendor</FieldLabel>
			<Input id="v-name" bind:value={name} placeholder="Studio name" aria-required="true" aria-invalid={tried && errors.name ? 'true' : undefined} aria-describedby={tried && errors.name ? 'v-name-message' : undefined} />
			{@render problem('name')}
		</div>
		<div class="flex flex-col gap-1.5">
			<FieldLabel for="v-email" required>Email</FieldLabel>
			<Input id="v-email" type="email" bind:value={email} placeholder="bids@studio.com" aria-required="true" aria-invalid={tried && errors.email ? 'true' : undefined} aria-describedby={tried && errors.email ? 'v-email-message' : undefined} />
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
	</div>
	{#if choosable}
		<fieldset class="flex flex-wrap items-center gap-x-4 gap-y-1">
			<legend class="mb-1 text-sm">Bids it answers <span class="text-muted-foreground text-xs">{every ? 'Every bid' : ''}</span></legend>
			{#each packages as p (p.id)}
				<label class="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={picked.length === 0 || picked.includes(p.id)} onchange={() => toggle(p.id)} />{p.name}</label>
			{/each}
		</fieldset>
	{/if}
	<div class="flex justify-end gap-2">
		{#if onCancel}<Button type="button" variant="ghost" onclick={onCancel}>Cancel</Button>{/if}
		<Button type="submit" disabled={sending} data-slot="invite-submit">{sending ? 'Inviting…' : 'Invite'}</Button>
	</div>
	{#if failure}<p class="text-destructive text-sm" role="alert">Not invited. {failure}</p>{/if}
</form>
