<!--
	Step 2, Details: the request header. Two groups side by side from lg (the request, then turnover
	and delivery), assumptions full width under them. A field's error shows once it has been left or
	holds a value, so an empty form does not open in red. Checks in `$lib/pure/header`.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Section from '$lib/app/section.svelte';
	import DateEditor from '$lib/components/date-editor.svelte';
	import ListPicker from '$lib/components/list-picker.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { CURRENCIES } from '$lib/pure/currencies';
	import { validateHeader, type HeaderForm } from '$lib/pure/header';
	import { today } from '$lib/app/today';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder }: { builder: Builder } = $props();

	const form = $derived(builder.state.form);
	const errors = $derived(validateHeader(form, today()));
	let touched = $state<Partial<Record<keyof HeaderForm, boolean>>>({});
	const currencyOptions = CURRENCIES.map((c) => ({ code: c.code, label: c.name }));

	function set<K extends keyof HeaderForm>(key: K, value: HeaderForm[K]): void {
		builder.setForm({ ...builder.state.form, [key]: value });
	}

	function shown(key: keyof HeaderForm): string | undefined {
		return touched[key] || form[key].trim() !== '' ? errors[key] : undefined;
	}

	const leave = (key: keyof HeaderForm) => () => (touched = { ...touched, [key]: true });
</script>

{#snippet field(key: keyof HeaderForm, label: string, hint: string | null, body: Snippet<[string | undefined]>)}
	{@const error = shown(key)}
	<div class="flex flex-col gap-1.5" data-field={key}>
		<label class="text-sm font-medium" for={`f-${key}`}>{label}</label>
		{@render body(error)}
		{#if error}
			<p class="text-destructive text-xs" id={`e-${key}`}>{error}</p>
		{:else if hint}
			<p class="text-muted-foreground text-xs">{hint}</p>
		{/if}
	</div>
{/snippet}

{#snippet text(key: keyof HeaderForm, placeholder: string, type = 'text')}
	{@render field(key, LABELS[key], HINTS[key] ?? null, input)}
	{#snippet input(error: string | undefined)}
		<Input
			id={`f-${key}`}
			{type}
			{placeholder}
			value={form[key]}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error ? `e-${key}` : undefined}
			oninput={(e) => set(key, e.currentTarget.value)}
			onblur={leave(key)}
		/>
	{/snippet}
{/snippet}

{#snippet day(key: 'dueDate' | 'turnoverDate' | 'deliveryDate')}
	{@render field(key, LABELS[key], HINTS[key] ?? null, input)}
	{#snippet input(error: string | undefined)}
		<DateEditor
			id={`f-${key}`}
			value={form[key] || null}
			invalid={Boolean(error)}
			onValueChange={(v) => {
				set(key, v ?? '');
				touched = { ...touched, [key]: true };
			}}
		/>
	{/snippet}
{/snippet}

{#snippet currency(error: string | undefined)}
		<ListPicker
			id="f-baseCurrency"
			options={currencyOptions}
			value={form.baseCurrency || null}
			searchable
			showCode
			clearable={false}
			invalid={Boolean(error)}
			placeholder="Pick a currency"
			searchPlaceholder="Search by code or name"
			onValueChange={(v) => set('baseCurrency', v ?? '')}
		/>
	{/snippet}

<script lang="ts" module>
	const LABELS: Record<string, string> = {
		code: 'Code',
		title: 'Title',
		round: 'Round',
		dueDate: 'Bids due',
		baseCurrency: 'Base currency',
		turnoverDate: 'Turnover',
		deliveryDate: 'Delivery',
		deliveryFormat: 'Delivery format',
		materialLink: 'Bid material',
		assumptions: 'Assumptions'
	};
	const HINTS: Record<string, string> = {
		code: 'Your reference. Vendors quote it back.',
		round: '1 for the first round.',
		dueDate: 'When vendors must answer by.',
		baseCurrency: 'You compare and award in it. Each vendor bids in its own.',
		turnoverDate: 'When plates and material reach the vendor.',
		materialLink: 'A link to the cut, script or boards.'
	};
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<form class="flex w-full max-w-5xl flex-col gap-8 px-6 py-6" onsubmit={(e) => e.preventDefault()} aria-label="Request details">
		<div class="grid gap-8 lg:grid-cols-2">
			<Section title="The request">
				<div class="grid gap-4 sm:grid-cols-[1fr_2fr]">
					{@render text('code', 'SHOW_R1')}
					{@render text('title', 'Main VFX bid')}
				</div>
				<div class="grid gap-4 sm:grid-cols-[1fr_2fr]">
					{@render text('round', '1', 'number')}
					{@render day('dueDate')}
				</div>
				{@render field('baseCurrency', LABELS.baseCurrency, HINTS.baseCurrency, currency)}

			</Section>

			<Section title="Turnover and delivery">
				<div class="grid gap-4 sm:grid-cols-2">
					{@render day('turnoverDate')}
					{@render day('deliveryDate')}
				</div>
				{@render text('deliveryFormat', 'EXR 16-bit half, ACEScg, 4096 x 2160')}
				{@render text('materialLink', 'https://', 'url')}
			</Section>
		</div>

		<Section title="Assumptions" meta="One per line. Every vendor bids on these.">
			<Textarea
				id="f-assumptions"
				class="min-h-32"
				placeholder="One assumption per line."
				value={form.assumptions}
				oninput={(e) => set('assumptions', e.currentTarget.value)}
				aria-label="Assumptions"
			/>
		</Section>
	</form>
</div>
