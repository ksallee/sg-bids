<!--
	The request's header, compact: the title on its own row, since it is the one thing left to type;
	then code, round, base currency and the bids due day. Turnover and delivery, and the assumptions,
	are optional and fold away, each with a line of what is set. A field's problem shows once it was
	left, holds a value, or the page asks for it (`revealed`), so a new draft does not open in red.
	Checks in `$lib/pure/header` and `$lib/pure/readiness`.
-->
<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import FormField from './form-field.svelte';
	import DateEditor from '$lib/components/date-editor.svelte';
	import ListPicker from '$lib/components/list-picker.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { CURRENCIES } from '$lib/pure/currencies';
	import { LABELS, OPTIONAL_GROUPS, REQUIRED, splitAssumptions, type HeaderForm } from '$lib/pure/header';
	import { controlId, type Problem } from '$lib/pure/readiness';
	import { cn } from '$lib/utils.js';
	import type { Builder } from '$lib/app/builder.svelte';

	type Fold = keyof typeof OPTIONAL_GROUPS;

	let {
		builder,
		folds = $bindable({ delivery: false, assumptions: false }),
		revealed
	}: {
		builder: Builder;
		folds?: Record<Fold, boolean>;
		/** Fields whose problem shows whatever their state: those a summary link pointed at, or every one before the review. */
		revealed: ReadonlySet<string>;
	} = $props();

	const form = $derived(builder.state.form);
	const problems = $derived(new Map(builder.readiness.problems.map((p) => [p.target, p])));
	let touched = $state<Partial<Record<keyof HeaderForm, boolean>>>({});
	const currencyOptions = CURRENCIES.map((c) => ({ code: c.code, label: c.name }));

	function set<K extends keyof HeaderForm>(key: K, value: HeaderForm[K]): void {
		builder.setForm({ ...builder.state.form, [key]: value });
	}

	function shown(key: keyof HeaderForm): Problem | undefined {
		const problem = problems.get(key);
		if (!problem) return undefined;
		return touched[key] || form[key].trim() !== '' || revealed.has(key) || revealed.has('*') ? problem : undefined;
	}

	const leave = (key: keyof HeaderForm) => () => (touched = { ...touched, [key]: true });
	// The folded groups say Optional once, on their heading.
	const mark = (key: keyof HeaderForm) => (REQUIRED.includes(key) ? ('required' as const) : undefined);

	/** One line on a folded group: what is wrong in it, else what is set. */
	function foldLine(group: Fold): { text: string; tone: 'error' | 'warning' | 'muted' } {
		const fields: readonly (keyof HeaderForm)[] = OPTIONAL_GROUPS[group];
		const wrong = fields.map((f) => problems.get(f)).filter((p): p is Problem => p !== undefined);
		if (wrong.length > 0) return { text: wrong.map((p) => `${p.label}: ${p.short}`).join('. '), tone: wrong.some((p) => p.tone === 'error') ? 'error' : 'warning' };
		if (group === 'assumptions') {
			const n = splitAssumptions(form.assumptions).length;
			return { text: n === 0 ? 'None yet' : `${n} ${n === 1 ? 'line' : 'lines'}`, tone: 'muted' };
		}
		const set = fields.filter((f) => form[f].trim() !== '').map((f) => LABELS[f]);
		return { text: set.length === 0 ? 'Nothing set' : `${set.join(', ')} set`, tone: 'muted' };
	}

	const codeHint = $derived(form.code.trim() !== '' && form.code.trim() === builder.suggestedCode ? 'Made from the project. Vendors quote it back.' : 'Vendors quote it back.');
</script>

{#snippet text(key: keyof HeaderForm, hint?: string, type = 'text', placeholder = '')}
	<FormField id={controlId(key)} label={LABELS[key]} mark={mark(key)} {hint} problem={shown(key)}>
		{#snippet children({ id, describedBy, invalid })}
			<Input
				{id}
				{type}
				{placeholder}
				value={form[key]}
				inputmode={key === 'round' ? 'numeric' : undefined}
				class={key === 'code' ? 'font-mono text-sm' : key === 'round' ? 'tabular-nums' : undefined}
				aria-invalid={invalid ? 'true' : undefined}
				aria-describedby={describedBy}
				aria-required={REQUIRED.includes(key) ? 'true' : undefined}
				oninput={(e) => set(key, e.currentTarget.value)}
				onblur={leave(key)}
			/>
		{/snippet}
	</FormField>
{/snippet}

{#snippet day(key: 'dueDate' | 'turnoverDate' | 'deliveryDate', hint?: string)}
	<FormField id={controlId(key)} label={LABELS[key]} mark={key === 'dueDate' ? 'optional' : undefined} {hint} problem={shown(key)} native={false}>
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

{#snippet foldHead(group: Fold, title: string)}
	{@const line = foldLine(group)}
	<button
		type="button"
		class="hover:bg-muted focus-visible:ring-ring -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2"
		aria-expanded={folds[group]}
		aria-controls={`fold-${group}`}
		onclick={() => (folds = { ...folds, [group]: !folds[group] })}
		data-slot={`fold-${group}`}
	>
		<ChevronRight class={cn('text-muted-foreground size-4 shrink-0 transition-transform duration-150', folds[group] && 'rotate-90')} aria-hidden="true" />
		<span class="font-medium">{title}</span>
		<span class="text-muted-foreground text-xs">Optional</span>
		<span class={cn('ml-auto truncate text-xs', line.tone === 'error' ? 'text-destructive' : line.tone === 'warning' ? 'text-foreground' : 'text-muted-foreground')}>{line.text}</span>
	</button>
{/snippet}

<section class="flex flex-col gap-4" aria-labelledby="request-heading" data-slot="header-panel">
	<h2 id="request-heading" class="sr-only">Request details</h2>
	{@render text('title')}
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_7.5rem_minmax(0,1.25fr)_minmax(0,1fr)]">
		{@render text('code', codeHint)}
		{@render text('round')}
		<FormField id={controlId('baseCurrency')} label={LABELS.baseCurrency} mark="required" hint="You compare and award in it." problem={shown('baseCurrency')} native={false}>
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
		{@render day('dueDate')}
	</div>

	<div class="border-border flex flex-col gap-1 border-t pt-2">
		{@render foldHead('delivery', 'Turnover and delivery')}
		{#if folds.delivery}
			<div id="fold-delivery" class="grid gap-4 pt-2 pb-3 sm:grid-cols-2">
				{@render day('turnoverDate', 'When plates and material reach the vendor.')}
				{@render day('deliveryDate', 'When the work is due back.')}
				{@render text('deliveryFormat', 'For example EXR 16-bit half, ACEScg, 4096 x 2160.')}
				{@render text('materialLink', 'A link to the cut, script or boards.', 'url', 'https://')}
			</div>
		{/if}
		{@render foldHead('assumptions', 'Assumptions')}
		{#if folds.assumptions}
			<div id="fold-assumptions" class="pt-2 pb-3">
				<FormField id={controlId('assumptions')} label={LABELS.assumptions} mark="optional" hint="One per line. Every vendor bids on these.">
					{#snippet children({ id, describedBy })}
						<Textarea
							{id}
							class="min-h-28"
							value={form.assumptions}
							aria-describedby={describedBy}
							oninput={(e) => set('assumptions', e.currentTarget.value)}
						/>
					{/snippet}
				</FormField>
			</div>
		{/if}
	</div>
</section>
