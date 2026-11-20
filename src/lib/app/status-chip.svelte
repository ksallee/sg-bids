<!--
	A request's status as a chip: no fill of its own (sg-widgets rule 1), a dot in its tone. Draft
	muted, issued info, awarded success, closed muted.
-->
<script lang="ts">
	import type { RequestStatus } from '$lib/api';
	import { cn } from '$lib/utils.js';

	let { status }: { status: RequestStatus } = $props();
	const LABEL: Record<RequestStatus, string> = { draft: 'Draft', issued: 'Issued', awarded: 'Awarded', closed: 'Closed' };
	const DOT: Record<RequestStatus, string> = { draft: 'bg-muted-foreground', issued: 'bg-info', awarded: 'bg-success', closed: 'bg-muted-foreground' };
</script>

<span class="border-border inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-xs font-medium" data-slot="status-chip" data-status={status}>
	<span class={cn('size-1.5 rounded-full', DOT[status])} aria-hidden="true"></span>
	{LABEL[status]}
</span>
