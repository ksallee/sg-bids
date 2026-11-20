<!--
	A bid's rate to the base currency, in its column header. Unset, it reads "Needs a rate" in the
	warning tone; set, the rate, its day and a lock. Production may change it until the award; after,
	it shows locked and opens nothing. No rate service: the rate is typed.
-->
<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { today } from '$lib/app/today';
	import { formatDay } from '$lib/pure/display';
	import type { Rate } from '$lib/pure/money';
	import { cn } from '$lib/utils.js';

	let {
		currency,
		base,
		rate,
		locked,
		onSave
	}: {
		currency: string;
		base: string;
		rate: Rate | null;
		/** The award is made. */
		locked: boolean;
		onSave: (value: { rate: string; date: string } | null) => Promise<void>;
	} = $props();

	let open = $state(false);
	let value = $state('');
	let day = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	const uid = $props.id();

	function reset(next: boolean): void {
		open = next;
		if (next) {
			value = rate?.rate ?? '';
			day = rate?.date ?? today();
			error = null;
		}
	}

	async function save(clear = false): Promise<void> {
		busy = true;
		error = null;
		try {
			await onSave(clear ? null : { rate: value.trim(), date: day });
			open = false;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

{#if currency === base}
	<span class="text-muted-foreground">{currency}, the base currency</span>
{:else}
	<Popover.Root bind:open={() => open, reset}>
		<Popover.Trigger
			disabled={locked}
			class={cn(
				'focus-visible:ring-ring/50 -mx-1 inline-flex max-w-full items-center gap-1 rounded px-1 text-left outline-none focus-visible:ring-2',
				rate ? 'text-muted-foreground hover:text-foreground' : 'text-warning-foreground bg-warning/20 hover:bg-warning/30 font-medium',
				locked && 'cursor-default hover:text-muted-foreground'
			)}
			title={rate ? `1 ${currency} = ${rate.rate} ${base}, locked ${rate.date}${locked ? '. The award locks it.' : '. Change it until the award.'}` : `Set the rate from ${currency} to ${base}`}
			data-slot="rate"
		>
			{#if rate}
				<Lock class="size-3 shrink-0" aria-hidden="true" />
				<span class="truncate tabular-nums">{currency} at {rate.rate}, {formatDay(rate.date)}</span>
			{:else}
				<TriangleAlert class="size-3 shrink-0" aria-hidden="true" />
				<span>{currency}, needs a rate</span>
			{/if}
		</Popover.Trigger>
		<Popover.Content class="w-72" align="start">
			<form
				class="flex flex-col gap-3"
				onsubmit={(e) => {
					e.preventDefault();
					void save();
				}}
			>
				<div class="flex flex-col gap-1">
					<p class="text-sm font-semibold">Rate to {base}</p>
					<p class="text-muted-foreground text-xs">Every {currency} figure of this bid converts at this rate. You can change it until the award.</p>
				</div>
				<label class="flex flex-col gap-1 text-xs" for={`${uid}-rate`}>
					<span class="text-muted-foreground">1 {currency} in {base}</span>
					<Input id={`${uid}-rate`} inputmode="decimal" autocomplete="off" placeholder="1.2712" bind:value class="tabular-nums" />
				</label>
				<label class="flex flex-col gap-1 text-xs" for={`${uid}-day`}>
					<span class="text-muted-foreground">Day of the rate</span>
					<Input id={`${uid}-day`} type="date" bind:value={day} />
				</label>
				{#if error}<p class="text-destructive text-xs" role="alert">{error}</p>{/if}
				<div class="flex items-center justify-between gap-2">
					{#if rate}
						<Button type="button" variant="ghost" size="sm" disabled={busy} onclick={() => void save(true)}>Clear</Button>
					{:else}<span></span>{/if}
					<Button type="submit" size="sm" disabled={busy || value.trim() === '' || day === ''}>{busy ? 'Saving' : 'Set the rate'}</Button>
				</div>
			</form>
		</Popover.Content>
	</Popover.Root>
{/if}
