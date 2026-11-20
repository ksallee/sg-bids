<!--
	A whole pane's empty, loading or error state: an icon in a ring, one title, one line, and the
	action that gets the person going. It grows to fill its parent and sits in the middle of it, both
	ways. Loading shows its spinner only after 150 ms (sg-widgets rule 4). Inside a widget, use its
	own StateLine instead.
-->
<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Inbox from '@lucide/svelte/icons/inbox';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { cn } from '$lib/utils.js';

	let {
		state,
		title,
		line,
		icon,
		action,
		class: className
	}: {
		state: 'empty' | 'loading' | 'error';
		title: string;
		line?: string;
		icon?: Component;
		action?: Snippet;
		class?: string;
	} = $props();

	const Icon = $derived(icon ?? (state === 'error' ? CircleAlert : state === 'loading' ? LoaderCircle : Inbox));
</script>

<div
	class={cn('flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center', state === 'loading' && 'page-state-delay', className)}
	role={state === 'error' ? 'alert' : 'status'}
	data-slot="page-state"
	data-state={state}
>
	<span
		class={cn(
			'flex size-11 items-center justify-center rounded-full border',
			state === 'error' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'bg-card text-muted-foreground'
		)}
	>
		<Icon class={cn('size-5', state === 'loading' && 'motion-safe:animate-spin')} aria-hidden="true" />
	</span>
	<div class="flex max-w-md flex-col gap-1">
		<p class="text-base font-semibold tracking-tight">{title}</p>
		{#if line}<p class="text-muted-foreground text-sm text-balance">{line}</p>{/if}
	</div>
	{#if action}<div class="flex flex-wrap items-center justify-center gap-2 pt-1">{@render action()}</div>{/if}
</div>

<style>
	.page-state-delay {
		animation: page-state-in 100ms ease-out 150ms both;
	}
	@keyframes page-state-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
