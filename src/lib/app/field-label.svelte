<!--
	A form label, the same on every form of the app. Required: semibold, with a red asterisk. Optional:
	regular weight, no tag. The asterisk is for the eye; the control carries `aria-required`, which is
	what a screen reader announces, so the label's accessible name stays the field's name. With
	`for`, it is a native label; without, clicking it focuses the control inside `focus` (a picker).
	`RequiredLegend` says once what the asterisk means, on a form that has both kinds.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	let {
		for: target,
		focus,
		required = false,
		children,
		class: className
	}: {
		/** The id of a native control: the label is a `<label for>`. */
		for?: string;
		/** The id of a box holding a picker: clicking the label focuses its control. */
		focus?: string;
		required?: boolean;
		children: Snippet;
		class?: string;
	} = $props();

	const classes = $derived(cn('text-foreground text-sm leading-5', required ? 'font-semibold' : 'font-normal', className));

	function focusControl(): void {
		if (!focus) return;
		const box = document.getElementById(focus);
		const control = box?.matches('input, textarea, button, select') ? box : box?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select, button');
		control?.focus();
	}
</script>

{#snippet mark()}
	{#if required}<span class="text-destructive ml-0.5" aria-hidden="true" title="Required">*</span>{/if}
{/snippet}

{#if target}
	<label for={target} class={classes} data-slot="field-label" data-required={required}>{@render children()}{@render mark()}</label>
{:else}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions: the control itself is reachable by keyboard -->
	<span class={classes} onclick={focusControl} data-slot="field-label" data-required={required}>{@render children()}{@render mark()}</span>
{/if}
