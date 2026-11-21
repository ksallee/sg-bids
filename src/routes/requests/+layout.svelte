<!-- Every page under /bids needs a Flow PT session: checked once here, before the page draws. -->
<script lang="ts">
	import SessionGate from '$lib/app/session-gate.svelte';

	let { children } = $props();
</script>

<SessionGate>{@render children()}</SessionGate>
