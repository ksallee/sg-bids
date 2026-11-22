<!--
	The request's details, what every bid of it shares, in the side panel of its page: the day answers
	are due and the base currency first, both required (weight and an asterisk), then turnover,
	delivery, the material and the assumptions. All in sight, nothing folded. A field's problem shows
	once it was left, holds a value, or the issue asked for it (`revealed`), so a new draft does not
	open in red. Checks in `$lib/pure/header` and `$lib/pure/readiness`.
-->
<script lang="ts">
	import FormField from './form-field.svelte';
	import DateEditor from '$lib/components/date-editor.svelte';
	import ListPicker from '$lib/components/list-picker.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { CURRENCIES } from '$lib/pure/currencies';
	import { LABELS, REQUIRED, type HeaderForm } from '$lib/pure/header';
	import { controlId, type Problem } from '$lib/pure/readiness';

	let {
		form,
		problems: given,
		revealed,
		onChange
	}: {
		form: HeaderForm;
		/** What is wrong now (`readiness`). */
		problems: readonly Problem[];
		/** Fields whose problem shows whatever their state: the ones the issue asked for, or `*` for every one. */
		revealed: ReadonlySet<string>;
		onChange: (form: HeaderForm) => void;
	} = $props();

	const problems = $derived(new Map(given.map((p) => [p.target, p])));
	let touched = $state<Partial<Record<keyof HeaderForm, boolean>>>({});
	const currencyOptions = CURRENCIES.map((c) => ({ code: c.code, label: c.name }));

	function set<K extends keyof HeaderForm>(key: K, value: HeaderForm[K]): void {
		onChange({ ...form, [key]: value });
	}

	function shown(key: keyof HeaderForm): Problem | undefined {
		const problem = problems.get(key);
		if (!problem) return undefined;
		return touched[key] || form[key].trim() !== '' || revealed.has(key) || revealed.has('*') ? problem : undefined;
	}

	const leave = (key: keyof HeaderForm) => () => (touched = { ...touched, [key]: true });
</script>

{#snippet text(key: keyof HeaderForm, hint?: string, type = 'text', placeholder = '')}
	<FormField id={controlId(key)} label={LABELS[key]} required={REQUIRED.includes(key)} {hint} problem={shown(key)}>
		{#snippet children({ id, describedBy, invalid })}
			<Input
				{id}
				{type}
				{placeholder}
				value={form[key]}
				aria-invalid={invalid ? 'true' : undefined}
				aria-describedby={describedBy}
				oninput={(e) => set(key, e.currentTarget.value)}
				onblur={leave(key)}
			/>
		{/snippet}
	</FormField>
{/snippet}

{#snippet day(key: 'dueDate' | 'turnoverDate' | 'deliveryDate', hint?: string)}
	<FormField id={controlId(key)} label={LABELS[key]} required={REQUIRED.includes(key)} {hint} problem={shown(key)} native={false}>
		{#snippet children({ id, invalid })}
			<DateEditor
				{id}
				value={form[key] || null}
				{invalid}
				onValueChange={(v) => {
					set(key, v ?? '');
					touched = { ...touched, [key]: true };
				}}
			/>
		{/snippet}
	</FormField>
{/snippet}

<section class="flex flex-col gap-4" aria-labelledby="details-heading" data-slot="details-panel">
	<div class="flex items-baseline justify-between gap-3">
		<h2 id="details-heading" class="text-sm font-semibold">Details</h2>
		<p class="text-muted-foreground text-xs">Every vendor answers on these.</p>
	</div>
	<div class="grid grid-cols-2 gap-x-3 gap-y-4">
		{@render day('dueDate')}
		<FormField id={controlId('baseCurrency')} label={LABELS.baseCurrency} required problem={shown('baseCurrency')} native={false}>
			{#snippet children({ id, invalid })}
				<ListPicker
					{id}
					options={currencyOptions}
					value={form.baseCurrency || null}
					searchable
					showCode
					clearable={false}
					{invalid}
					placeholder="Pick a currency"
					searchPlaceholder="Search by code or name"
					onValueChange={(v) => set('baseCurrency', v ?? '')}
				/>
			{/snippet}
		</FormField>
		{@render day('turnoverDate', 'Plates reach the vendor.')}
		{@render day('deliveryDate', 'The work is due back.')}
		<div class="col-span-2">{@render text('deliveryFormat', 'For example EXR 16-bit half, ACEScg, 4096 x 2160.')}</div>
		<div class="col-span-2">{@render text('materialLink', 'A link to the cut, script or boards.', 'url', 'https://')}</div>
		<div class="col-span-2">
			<FormField id={controlId('assumptions')} label={LABELS.assumptions} hint="One per line.">
				{#snippet children({ id, describedBy })}
					<Textarea {id} class="min-h-20" value={form.assumptions} aria-describedby={describedBy} oninput={(e) => set('assumptions', e.currentTarget.value)} />
				{/snippet}
			</FormField>
		</div>
	</div>
	<p class="text-muted-foreground text-xs">You compare and award in the base currency. Each vendor answers in its own.</p>
</section>
