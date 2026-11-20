<!--
	One field of the request: its label (`FieldLabel`: required semibold with an asterisk, optional
	regular), the control, then one line under it. The line is the problem in words when there is
	one to show, else the hint. It is the control's description, so a screen reader reads it with
	the field. The control carries the id the readiness list points at (`readiness.controlId`); a
	picker gets it on its wrapper, and its label focuses it.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import FieldLabel from '$lib/app/field-label.svelte';
	import { cn } from '$lib/utils.js';

	type Shown = { readonly tone: 'error' | 'warning'; readonly message: string };

	let {
		id,
		label,
		required = false,
		hint,
		problem,
		native = true,
		class: className,
		children
	}: {
		id: string;
		label: string;
		required?: boolean;
		hint?: string;
		/** The problem to show now. The caller decides when: once touched, filled, or asked for. */
		problem?: Shown;
		/** A native input takes the label's `for`; a picker does not. */
		native?: boolean;
		class?: string;
		children: Snippet<[{ id: string; describedBy: string | undefined; invalid: boolean }]>;
	} = $props();

	const messageId = $derived(`${id}-message`);
</script>

<div class={cn('flex min-w-0 flex-col gap-1.5', className)} data-field={id}>
	<FieldLabel for={native ? id : undefined} focus={native ? undefined : id} {required}>{label}</FieldLabel>
	{@render children({ id, describedBy: problem || hint ? messageId : undefined, invalid: problem?.tone === 'error' })}
	{#if problem}
		<p id={messageId} class={cn('flex items-start gap-1.5 text-xs', problem.tone === 'error' ? 'text-destructive' : 'text-foreground')} data-slot="field-problem" data-tone={problem.tone}>
			{#if problem.tone === 'error'}
				<CircleAlert class="mt-px size-3.5 shrink-0" aria-hidden="true" />
			{:else}
				<TriangleAlert class="text-warning mt-px size-3.5 shrink-0" aria-hidden="true" />
			{/if}
			<span>{problem.message}</span>
		</p>
	{:else if hint}
		<p id={messageId} class="text-muted-foreground text-xs">{hint}</p>
	{/if}
</div>
