<!--
	The one choice a duplicate asks: with the rows, or without. Used by Duplicate for one request and
	for several.
-->
<script lang="ts">
	let { value = $bindable('with') }: { value?: 'with' | 'without' } = $props();
	const uid = $props.id();

	const RADIO = 'flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5';
</script>

<fieldset class="flex flex-col gap-2">
	<legend class="mb-1.5 text-sm font-semibold">The rows</legend>
	<label class={RADIO}>
		<input type="radio" name={`${uid}-rows`} value="with" bind:group={value} class="mt-0.5" data-slot="duplicate-with-rows" />
		<span><span class="font-medium">With the rows.</span> <span class="text-muted-foreground">Every shot and asset, in its bid.</span></span>
	</label>
	<label class={RADIO}>
		<input type="radio" name={`${uid}-rows`} value="without" bind:group={value} class="mt-0.5" data-slot="duplicate-without-rows" />
		<span><span class="font-medium">Without the rows.</span> <span class="text-muted-foreground">The bids stay, empty, for new shots.</span></span>
	</label>
</fieldset>
