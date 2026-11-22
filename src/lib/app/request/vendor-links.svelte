<!--
	The vendors of an issued request, one row each: who, which bids, where they stand, and the link.
	A link made on this page (at the issue, or with New link) shows here with Copy and Email; it shows
	once, since only its fingerprint is kept, and the page says so beside it. Copy all copies every link
	shown. Email opens the person's own mail app with the subject and the link written; the app sends
	nothing. A lost link is made again with New link: the old one stops working. Words in
	`$lib/pure/issue-words` and `$lib/pure/invitations`.
-->
<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Mail from '@lucide/svelte/icons/mail';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { InvitationView } from '$lib/api';
	import type { RequestPackage } from '$lib/pure/model';
	import { stateLabel } from '$lib/pure/invitations';
	import { allLinks, mailtoHref } from '$lib/pure/issue-words';
	import { cn } from '$lib/utils.js';

	let {
		invitations,
		packages,
		links,
		request,
		project,
		due,
		busy,
		closed,
		onNewLink,
		onRevoke,
		onBids
	}: {
		invitations: readonly InvitationView[];
		packages: readonly RequestPackage[];
		/** The links made on this page, by invitation id. */
		links: ReadonlyMap<string, string>;
		/** The request's name and project, for the email. */
		request: string;
		project: string;
		/** The due day as the page shows it, or null. */
		due: string | null;
		busy: string | null;
		/** The request takes no answers: no new link. */
		closed: boolean;
		onNewLink: (inv: InvitationView) => void;
		onRevoke: (inv: InvitationView) => void;
		/** Change a vendor's bids, until it answers. */
		onBids?: (inv: InvitationView) => void;
	} = $props();

	let copied = $state<string | null>(null);
	let failed = $state(false);

	async function copy(text: string, what: string): Promise<void> {
		failed = false;
		try {
			await navigator.clipboard.writeText(text);
			copied = what;
			setTimeout(() => copied === what && (copied = null), 2000);
		} catch {
			failed = true;
		}
	}

	const shown = $derived(invitations.filter((inv) => links.has(inv.vendor.id)));
	const names = $derived(new Map(packages.map((p) => [p.id, p.name])));
	function bidsOf(inv: InvitationView): string {
		if (packages.length <= 1) return packages[0]?.name ?? 'Every bid';
		if (!inv.vendor.packages) return 'Every bid';
		const known = inv.vendor.packages.flatMap((k) => names.get(k) ?? []);
		return known.length === 0 ? 'No bid' : known.join(', ');
	}

	const day = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	const TONE: Record<string, string> = {
		pending: 'bg-muted-foreground',
		not_opened: 'bg-muted-foreground',
		opened: 'bg-info',
		submitted: 'bg-success',
		withdrawn: 'bg-warning',
		revoked: 'bg-destructive',
		expired: 'bg-destructive'
	};
	const TH = 'text-muted-foreground border-border h-9 border-b px-3 text-left text-xs font-medium whitespace-nowrap';
	const TD = 'border-border border-b px-3 py-2.5 align-top';
</script>

<div class="flex flex-col gap-3" data-slot="vendor-links">
	{#if shown.length > 0}
		<div class="border-warning/60 bg-warning/10 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3" data-slot="links-once">
			<KeyRound class="text-warning size-4 shrink-0" aria-hidden="true" />
			<p class="min-w-0 flex-1 text-sm">
				<span class="font-semibold">Each link shows once.</span> Only its fingerprint is kept, so this page cannot show it again. Copy or email them now. A lost link? Make a new one: the old one stops working.
			</p>
			<Button variant="outline" onclick={() => void copy(allLinks(shown.map((inv) => ({ name: inv.vendor.name, link: links.get(inv.vendor.id)! }))), 'all')} data-slot="copy-all">
				{#if copied === 'all'}<Check data-icon="inline-start" />Copied{:else}<Copy data-icon="inline-start" />Copy all{/if}
			</Button>
		</div>
	{/if}
	{#if failed}<p class="text-destructive text-sm">The browser refused to copy. Select the link and copy it by hand.</p>{/if}
	<div class="overflow-x-auto">
		<table class="w-full min-w-[56rem] border-separate border-spacing-0 text-sm" data-slot="invitations">
			<thead>
				<tr>
					<th class={cn(TH, 'pl-0')}>Vendor</th>
					{#if packages.length > 1}<th class={TH}>Bids</th>{/if}
					<th class={TH}>Where it stands</th>
					<th class={cn(TH, 'w-[40%]')}>Link</th>
					<th class={cn(TH, 'pr-0 text-right')}><span class="sr-only">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each invitations as inv (inv.vendor.id)}
					{@const s = inv.state}
					{@const dead = s.kind === 'revoked' || s.kind === 'expired'}
					{@const link = links.get(inv.vendor.id)}
					<tr data-state={s.kind} data-vendor={inv.vendor.name}>
						<td class={cn(TD, 'pl-0')}>
							<div class="flex min-w-0 flex-col">
								<span class="truncate font-medium">{inv.vendor.name}</span>
								<span class="text-muted-foreground truncate text-xs">{inv.vendor.email}{inv.vendor.groupName ? `, Group ${inv.vendor.groupName}` : inv.vendor.fpt ? ', linked to a Flow PT Group' : ''}</span>
							</div>
						</td>
						{#if packages.length > 1}
							<td class={TD} data-slot="invitation-packages">
								{#if onBids && (s.kind === 'not_opened' || s.kind === 'opened') && !closed}
									<button type="button" class="hover:text-foreground text-left underline decoration-current/30 underline-offset-2" onclick={() => onBids?.(inv)} title="Change the bids it answers">{bidsOf(inv)}</button>
								{:else}
									{bidsOf(inv)}
								{/if}
							</td>
						{/if}
						<td class={TD}>
							<span class="flex items-center gap-2 whitespace-nowrap">
								<span class={cn('size-1.5 shrink-0 rounded-full', TONE[s.kind])} aria-hidden="true"></span>
								{stateLabel(s)}
							</span>
							{#if !dead}<span class="text-muted-foreground block text-xs tabular-nums">Link works until {day.format(new Date(inv.expiresAt))}</span>{/if}
						</td>
						<td class={TD}>
							{#if link}
								<div class="flex items-center gap-1.5">
									<Input class="h-8 min-w-0 flex-1 font-mono text-xs" readonly value={link} aria-label={`Link for ${inv.vendor.name}`} onfocus={(e) => e.currentTarget.select()} data-slot="link-value" />
									<Button size="sm" onclick={() => void copy(link, inv.vendor.id)} data-slot="copy-link">
										{#if copied === inv.vendor.id}<Check data-icon="inline-start" />Copied{:else}<Copy data-icon="inline-start" />Copy{/if}
									</Button>
									<Button size="sm" variant="outline" href={mailtoHref({ email: inv.vendor.email, vendor: inv.vendor.name, request, project, due, link })} data-slot="email-link"><Mail data-icon="inline-start" />Email</Button>
								</div>
							{:else if dead}
								<span class="text-muted-foreground text-xs">No link works now.</span>
							{:else}
								<span class="text-muted-foreground text-xs">Shown once, at the issue. Lost? Make a new one.</span>
							{/if}
						</td>
						<td class={cn(TD, 'pr-0 text-right whitespace-nowrap')}>
							{#if !closed}
								<Button size="sm" variant="ghost" onclick={() => onNewLink(inv)} disabled={busy !== null} data-slot="new-link">{busy === `reissue:${inv.vendor.id}` ? 'Making…' : 'New link'}</Button>
							{/if}
							{#if !dead}
								<Button size="sm" variant="ghost" class="hover:text-destructive" onclick={() => onRevoke(inv)} disabled={busy !== null}>{busy === `revoke:${inv.vendor.id}` ? 'Revoking…' : 'Revoke'}</Button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="text-muted-foreground text-xs">An answer shows as opened until the vendor submits it. Drafts stay theirs.</p>
</div>
