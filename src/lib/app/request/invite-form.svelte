<!--
	Invite a vendor: a name, a contact email, and optionally the vendor's Group in Flow PT, picked
	from the site's Groups with the registry's EntityPicker (the award writes it to the Shot later).
	Checks in `$lib/pure/invitations`. The new link goes to the page, which shows it once.
-->
<script lang="ts">
	import type { EntityRef } from 'sg-widgets-core';
	import EntityPicker from '$lib/components/entity-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { api } from '$lib/api';
	import { liveContext } from '$lib/live';
	import { validateVendor } from '$lib/pure/invitations';

	let { projectId, requestId, onInvited }: { projectId: number; requestId: string; onInvited: (name: string, token: string) => void } = $props();

	let name = $state('');
	let email = $state('');
	let group = $state<EntityRef | null>(null);
	let tried = $state(false);
	let sending = $state(false);
	let failure = $state<string | null>(null);
	const errors = $derived(validateVendor({ name, email }));

	async function invite(): Promise<void> {
		tried = true;
		if (errors.name || errors.email) return;
		sending = true;
		failure = null;
		try {
			const answer = await api.invite(projectId, requestId, { name: name.trim(), email: email.trim(), groupId: group?.id ?? null });
			onInvited(answer.invitation.name, answer.token);
			name = '';
			email = '';
			group = null;
			tried = false;
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			sending = false;
		}
	}
</script>

<form class="bg-card text-card-foreground flex flex-col gap-3 rounded-lg border p-4" onsubmit={(e) => (e.preventDefault(), void invite())} aria-label="Invite a vendor" data-slot="invite-form">
	<div class="grid items-start gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
		<div class="flex flex-col gap-1.5">
			<label class="text-sm font-medium" for="v-name">Vendor</label>
			<Input id="v-name" bind:value={name} placeholder="Studio name" aria-invalid={tried && errors.name ? 'true' : undefined} />
			{#if tried && errors.name}<p class="text-destructive text-xs">{errors.name}</p>{/if}
		</div>
		<div class="flex flex-col gap-1.5">
			<label class="text-sm font-medium" for="v-email">Contact email</label>
			<Input id="v-email" type="email" bind:value={email} placeholder="bids@studio.com" aria-invalid={tried && errors.email ? 'true' : undefined} />
			{#if tried && errors.email}<p class="text-destructive text-xs">{errors.email}</p>{/if}
		</div>
		<div class="flex flex-col gap-1.5">
			<span class="text-sm font-medium">Flow PT Group <span class="text-muted-foreground font-normal">(optional)</span></span>
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
		<div class="flex flex-col gap-1.5">
			<span class="text-sm font-medium md:invisible" aria-hidden="true">Invite</span>
			<Button type="submit" disabled={sending}>{sending ? 'Inviting…' : 'Invite'}</Button>
		</div>
	</div>
	{#if failure}<p class="text-destructive text-sm" role="alert">{failure}</p>{/if}
</form>
