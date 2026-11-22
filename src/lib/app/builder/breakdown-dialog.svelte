<!--
	Add rows from a breakdown, for early rounds before the Shots exist in Flow PT. Two stages. First
	the rows: pasted from a spreadsheet, read from a CSV file, or typed. Then the columns, matched by
	header name and changeable, with a preview of every row: what is added, what replaces a row
	already in the request, what is left out and why, each named by its spreadsheet row. A code
	already in the request follows one choice for the batch. Rows go in with no Flow PT row; nothing
	is written to Flow PT. Parsing and the plan are `$lib/pure/breakdown`.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import FileUp from '@lucide/svelte/icons/file-up';
	import Plus from '@lucide/svelte/icons/plus';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import X from '@lucide/svelte/icons/x';
	import Notice from '$lib/app/notice.svelte';
	import Segmented from '$lib/app/segmented.svelte';
	import FieldLabel from '$lib/app/field-label.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import {
		columnLabel,
		columnsFor,
		detectColumns,
		looksLikeHeader,
		parseFrames,
		parseTable,
		planBreakdown,
		splitTable,
		type Column,
		type DuplicateChoice,
		type Table
	} from '$lib/pure/breakdown';
	import type { ItemKind } from '$lib/pure/field-map';
	import { cn } from '$lib/utils.js';
	import type { Builder } from '$lib/app/builder.svelte';

	let { builder, kind, open = $bindable(false) }: { builder: Builder; kind: ItemKind; open?: boolean } = $props();

	type Source = 'paste' | 'file' | 'type';
	type Typed = { code: string; description: string; sequence: string; frames: string; difficulty: string; notes: string };

	const noun = $derived(kind === 'shot' ? 'shot' : 'asset');
	const nouns = $derived(kind === 'shot' ? 'shots' : 'assets');

	let stage = $state<'rows' | 'match'>('rows');
	let source = $state<Source>('paste');
	let pasted = $state('');
	let fileText = $state('');
	let fileName = $state<string | null>(null);
	let fileError = $state<string | null>(null);
	let typed = $state<Typed[]>([blank()]);
	let header = $state<boolean | null>(null);
	let columns = $state<(Column | null)[]>([]);
	let duplicates = $state<DuplicateChoice>('skip');
	let addAssets = $state(true);
	let fileInput = $state<HTMLInputElement | null>(null);

	function blank(): Typed {
		return { code: '', description: '', sequence: '', frames: '', difficulty: '', notes: '' };
	}

	const TYPED_COLUMNS = $derived<{ key: keyof Typed; label: string; width: string }[]>(
		kind === 'shot'
			? [
					{ key: 'code', label: 'Code', width: 'w-32' },
					{ key: 'description', label: 'Description', width: '' },
					{ key: 'sequence', label: 'Sequence', width: 'w-28' },
					{ key: 'frames', label: 'Frames', width: 'w-20' },
					{ key: 'difficulty', label: 'Difficulty', width: 'w-28' },
					{ key: 'notes', label: 'Notes', width: 'w-40' }
				]
			: [
					{ key: 'code', label: 'Name', width: 'w-36' },
					{ key: 'description', label: 'Description', width: '' },
					{ key: 'difficulty', label: 'Difficulty', width: 'w-28' },
					{ key: 'notes', label: 'Notes', width: 'w-40' }
				]
	);

	/** The typed rows as a table with a header of known names, so the same plan reads them. */
	function typedTable(): Table {
		const cols = TYPED_COLUMNS;
		const head = cols.map((c) => (c.key === 'code' ? 'Code' : c.label));
		const rows = typed.filter((r) => cols.some((c) => r[c.key].trim() !== '')).map((r, i) => ({ row: i + 2, cells: cols.map((c) => r[c.key]) }));
		return { delimiter: '\t', records: [{ row: 1, cells: head }, ...rows], width: cols.length };
	}

	const table = $derived<Table>(source === 'type' ? typedTable() : parseTable(source === 'paste' ? pasted : fileText));
	const split = $derived(splitTable(table, kind, source === 'type' ? true : (header ?? undefined)));
	const headerOn = $derived(source === 'type' ? true : (header ?? (table.records[0] ? looksLikeHeader(table.records[0].cells, kind) : false)));
	const plan = $derived(
		planBreakdown({
			kind,
			records: split.records,
			columns,
			existing: { shots: builder.state.shots, assets: builder.state.assets },
			duplicates,
			addAssets,
			newId: (k) => builder.breakdownId(k)
		})
	);
	const offered = $derived(columnsFor(kind));
	const width = $derived(Math.max(table.width, split.header?.length ?? 0));
	const recordCount = $derived(split.records.length);

	function reset(): void {
		stage = 'rows';
		source = 'paste';
		pasted = '';
		fileText = '';
		fileName = null;
		fileError = null;
		typed = [blank()];
		header = null;
		columns = [];
		duplicates = 'skip';
		addAssets = true;
	}

	function detect(): void {
		columns = detectColumns(split.header, split.records, kind);
	}

	async function next(): Promise<void> {
		detect();
		stage = 'match';
		await tick();
		document.querySelector<HTMLElement>('[data-slot=breakdown-columns] select')?.focus();
	}

	function setHeader(on: boolean): void {
		header = on;
		detect();
	}

	async function readFile(file: File | undefined): Promise<void> {
		fileError = null;
		if (!file) return;
		if (/\.(xlsx|xls|numbers|ods)$/i.test(file.name)) {
			fileError = `${file.name} is a spreadsheet file. Save it as CSV first, or paste the cells.`;
			return;
		}
		fileName = file.name;
		fileText = await file.text();
	}

	function setColumn(i: number, value: string): void {
		const next = [...columns];
		while (next.length < width) next.push(null);
		next[i] = value === '' ? null : (value as Column);
		columns = next;
	}

	function add(): void {
		if (!plan.ready) return;
		builder.addBreakdown(kind, plan);
		open = false;
		reset();
	}

	const canGo = $derived(recordCount > 0);

	// Each record as the preview shows it: what happens to it, and its problems.
	const issuesByRow = $derived.by(() => {
		const out = new Map<number, typeof plan.issues>();
		for (const i of plan.issues) out.set(i.row, [...(out.get(i.row) ?? []), i]);
		return out;
	});
	const dupRows = $derived(new Map(plan.duplicates.map((d) => [d.row, d])));
	const replaced = $derived(new Set(plan.replace.map((r) => r.row)));
	const shownColumns = $derived(columns.map((c, i) => ({ c, i })).filter((x): x is { c: Column; i: number } => x.c !== null && offered.some((o) => o.column === x.c)));

	function outcome(row: number): { word: string; tone: 'new' | 'replace' | 'skip' | 'out' } {
		if ((issuesByRow.get(row) ?? []).some((i) => i.level === 'error')) return { word: 'Left out', tone: 'out' };
		const d = dupRows.get(row);
		if (d) {
			if (duplicates === 'skip') return { word: `Skipped, ${d.matches === 'in the request' ? 'in the request' : `same as ${d.matches}`}`, tone: 'skip' };
			if (duplicates === 'replace') return replaced.has(row) || d.matches !== 'in the request' ? { word: d.matches === 'in the request' ? 'Replaces the one in the request' : `Replaces ${d.matches}`, tone: 'replace' } : { word: 'Replaced later', tone: 'skip' };
			return { word: 'New, kept beside it', tone: 'new' };
		}
		return { word: 'New', tone: 'new' };
	}

	const adding = $derived(plan.add.length);
	const replacing = $derived(plan.replace.length);
	const leftOut = $derived(plan.issues.filter((i) => i.level === 'error' && i.row > 0).length);
	const warnings = $derived(plan.issues.filter((i) => i.level === 'warning'));
	const buttonLabel = $derived(
		adding + replacing === 0
			? `Add ${nouns}`
			: [adding ? `Add ${adding} ${adding === 1 ? noun : nouns}` : '', replacing ? `${adding ? 'replace' : 'Replace'} ${replacing}` : ''].filter(Boolean).join(', ')
	);
	const number = new Intl.NumberFormat();
	const selectClass =
		'border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2 text-sm outline-none focus-visible:ring-3';
</script>

<Dialog.Root bind:open onOpenChange={(o) => !o && reset()}>
	<Dialog.Content class="flex max-h-[min(92dvh,56rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl" data-slot="breakdown-dialog">
		<Dialog.Header class="border-border border-b px-5 pt-5 pb-4">
			<Dialog.Title>Add {nouns} from a breakdown to {builder.bidName(builder.current)}</Dialog.Title>
			<Dialog.Description>
				{#if stage === 'rows'}
					For a round before the {kind === 'shot' ? 'Shots' : 'Assets'} exist in Flow PT. Rows come in with no Flow PT row and mix with the ones you picked. Nothing is written to Flow PT.
				{:else}
					Check which column holds what, then the rows. A problem is named by its row in the spreadsheet.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if stage === 'rows'}
			<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
				<Segmented
					label="Where the rows come from"
					value={source}
					options={[
						{ value: 'paste', label: 'Paste from a spreadsheet' },
						{ value: 'file', label: 'A CSV file' },
						{ value: 'type', label: 'Type rows' }
					]}
					onChange={(v) => (source = v as Source)}
				/>
				{#if source === 'paste'}
					<div class="flex flex-col gap-1.5">
						<FieldLabel for="breakdown-paste" required>Paste the cells</FieldLabel>
						<Textarea
							id="breakdown-paste"
							bind:value={pasted}
							rows={12}
							class="min-h-56 font-mono text-xs leading-5 whitespace-pre"
							placeholder={kind === 'shot' ? 'Shot\tDescription\tFrames\nSH010\tCar crash, wide\t96' : 'Asset\tType\tDescription\nDragon\tCharacter\tThe big one'}
							spellcheck={false}
							data-slot="breakdown-paste"
						/>
						<p class="text-muted-foreground text-xs">Copy the cells in Excel, Google Sheets or Numbers, header row included or not. Tabs, commas and semicolons all read.</p>
					</div>
				{:else if source === 'file'}
					<div class="flex flex-col gap-2">
						<input bind:this={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" class="sr-only" onchange={(e) => void readFile(e.currentTarget.files?.[0])} data-slot="breakdown-file" />
						<button
							type="button"
							class="hover:bg-muted/60 focus-visible:ring-ring/50 flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center outline-none focus-visible:ring-3"
							onclick={() => fileInput?.click()}
						>
							<FileUp class="text-muted-foreground size-5" aria-hidden="true" />
							<span class="text-sm font-medium">{fileName ?? 'Choose a CSV file'}</span>
							<span class="text-muted-foreground text-xs">
								{fileName ? `${recordCount} ${recordCount === 1 ? 'row' : 'rows'} read. Choose another to replace it.` : 'CSV or tab separated text. An Excel file: save it as CSV first.'}
							</span>
						</button>
						{#if fileError}<Notice tone="destructive">{fileError}</Notice>{/if}
					</div>
				{:else}
					<div class="flex flex-col gap-2">
						<div class="overflow-x-auto rounded-lg border">
							<table class="w-full min-w-[44rem] border-separate border-spacing-0 text-sm" data-slot="breakdown-typed">
								<thead class="bg-muted">
									<tr class="text-muted-foreground text-left text-xs">
										{#each TYPED_COLUMNS as c (c.key)}<th class={cn('border-border border-b px-2 py-2', c.key === 'code' ? 'text-foreground font-semibold' : 'font-normal', c.width)}
												>{c.label}{#if c.key === 'code'}<span class="text-destructive ml-0.5" aria-hidden="true" title="Required">*</span>{/if}</th
											>{/each}
										<th class="border-border w-10 border-b"><span class="sr-only">Remove</span></th>
									</tr>
								</thead>
								<tbody>
									{#each typed as row, r (r)}
										<tr>
											{#each TYPED_COLUMNS as c (c.key)}
												<td class="border-border border-b px-1.5 py-1.5">
													<Input
														class={cn('h-8', c.key === 'code' && 'font-mono text-xs', c.key === 'frames' && 'text-right tabular-nums')}
														bind:value={typed[r][c.key]}
														inputmode={c.key === 'frames' ? 'numeric' : undefined}
														aria-required={c.key === 'code' ? 'true' : undefined}
														aria-label={`${c.label}, row ${r + 1}`}
													/>
												</td>
											{/each}
											<td class="border-border border-b px-1 py-1.5">
												<Button size="icon-sm" variant="ghost" class="text-muted-foreground" aria-label={`Remove row ${r + 1}`} disabled={typed.length === 1} onclick={() => (typed = typed.filter((_, i) => i !== r))}>
													<X />
												</Button>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						<div>
							<Button size="sm" variant="outline" onclick={() => (typed = [...typed, blank()])} data-slot="breakdown-add-row"><Plus data-icon="inline-start" />Add a row</Button>
						</div>
					</div>
				{/if}
			</div>
			<Dialog.Footer class="border-border mx-0 mb-0 flex items-center gap-3 rounded-b-xl border-t px-5 py-3 sm:justify-between">
				<p class="text-muted-foreground text-xs">
					{canGo ? `${recordCount} ${recordCount === 1 ? 'row' : 'rows'}${source !== 'type' && headerOn ? ' under a header row' : ''}.` : 'No rows yet.'}
				</p>
				<Button onclick={() => void next()} disabled={!canGo} data-slot="breakdown-next">Match the columns</Button>
			</Dialog.Footer>
		{:else}
			<div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
				<section class="flex flex-col gap-2" aria-labelledby="breakdown-columns-title">
					<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
						<h3 id="breakdown-columns-title" class="text-sm font-semibold">Columns</h3>
						{#if source !== 'type'}
							<label class="flex items-center gap-2 text-sm">
								<Switch checked={headerOn} onCheckedChange={setHeader} aria-label="The first row is a header" data-slot="breakdown-header" />
								<span>The first row is a header</span>
							</label>
						{/if}
						<span class="text-muted-foreground ml-auto text-xs">Leave a column out with “Not used”.</span>
					</div>
					<div class="flex gap-2 overflow-x-auto pb-1" data-slot="breakdown-columns">
						{#each Array.from({ length: width }, (_, i) => i) as i (i)}
							{@const col = columns[i] ?? null}
							{@const samples = split.records.slice(0, 3).map((r) => r.cells[i] ?? '')}
							<div class={cn('flex w-44 shrink-0 flex-col gap-1.5 rounded-lg border p-2', col === null ? 'border-dashed' : 'border-foreground/20 bg-muted/40', col === 'code' && 'border-primary bg-primary/5')}>
								<span class="text-muted-foreground truncate text-xs" title={split.header?.[i]}>{split.header?.[i]?.trim() || `Column ${i + 1}`}</span>
								<select class={selectClass} value={col ?? ''} onchange={(e) => setColumn(i, e.currentTarget.value)} aria-label={`What column ${i + 1}${split.header?.[i] ? `, ${split.header[i]},` : ''} holds`}>
									<option value="">Not used</option>
									{#each offered as o (o.column)}<option value={o.column}>{o.column === 'code' && kind === 'asset' ? 'Name' : o.label}</option>{/each}
								</select>
								<ul class={cn('flex flex-col text-xs', col === null && 'text-muted-foreground')}>
									{#each samples as s, k (k)}<li class={cn('truncate', col === 'code' && 'font-mono')} title={s}>{s || '·'}</li>{/each}
								</ul>
							</div>
						{/each}
					</div>
				</section>

				{#if plan.issues.some((i) => i.row === 0)}
					{#each plan.issues.filter((i) => i.row === 0) as issue (issue.message)}<Notice tone="destructive">{issue.message}</Notice>{/each}
				{:else}
					{#if plan.duplicates.length > 0}
						<div class="border-warning/60 bg-warning/10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2 text-sm" data-slot="breakdown-duplicates">
							<TriangleAlert class="text-warning size-4 shrink-0" aria-hidden="true" />
							<p class="min-w-0 flex-1">
								{plan.duplicates.length === 1 ? '1 code is' : `${plan.duplicates.length} codes are`} already in the request or repeated:
								{plan.duplicates
									.slice(0, 6)
									.map((d) => `${d.code} (row ${d.row})`)
									.join(', ')}{plan.duplicates.length > 6 ? ` and ${plan.duplicates.length - 6} more` : ''}.
							</p>
							<Segmented
								label="For each of them"
								value={duplicates}
								options={[
									{ value: 'skip', label: 'Skip' },
									{ value: 'replace', label: 'Replace' },
									{ value: 'both', label: 'Keep both' }
								]}
								onChange={(v) => (duplicates = v as DuplicateChoice)}
							/>
						</div>
					{/if}

					{#if plan.issues.length > 0}
						<ul class="flex flex-col gap-1 text-sm" data-slot="breakdown-issues" aria-label="Problems by row">
							{#each plan.issues as issue (issue.message)}
								<li class="flex items-start gap-2">
									{#if issue.level === 'error'}<CircleAlert class="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />{:else}<TriangleAlert class="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />{/if}
									<span>{issue.message}</span>
								</li>
							{/each}
						</ul>
					{/if}

					{#if plan.assetsToAdd.length > 0 || (kind === 'shot' && columns.includes('assets'))}
						<label class="flex items-start gap-2 text-sm">
							<Switch checked={addAssets} onCheckedChange={(on) => (addAssets = on)} aria-label="Add the assets the shots name" />
							<span>
								Add the assets the shots name that the request lacks{plan.assetsToAdd.length ? `: ${plan.assetsToAdd.map((a) => a.name).join(', ')}` : ''}.
								<span class="text-muted-foreground block text-xs">Off: those names are left unlinked.</span>
							</span>
						</label>
					{/if}

					<section class="flex flex-col gap-2" aria-labelledby="breakdown-preview-title">
						<h3 id="breakdown-preview-title" class="text-sm font-semibold">The rows</h3>
						<div class="overflow-x-auto rounded-lg border">
							<table class="w-full min-w-[44rem] border-separate border-spacing-0 text-sm" data-slot="breakdown-preview">
								<thead class="bg-muted sticky top-0">
									<tr class="text-muted-foreground text-left text-xs">
										<th class="border-border w-12 border-b px-2 py-2 text-right font-medium">Row</th>
										{#each shownColumns as { c } (c)}<th class={cn('border-border border-b px-2 py-2 font-medium', c === 'frames' && 'text-right')}>{c === 'code' && kind === 'asset' ? 'Name' : columnLabel(c)}</th>{/each}
										<th class="border-border w-48 border-b px-2 py-2 font-medium">What happens</th>
									</tr>
								</thead>
								<tbody>
									{#each split.records as record (record.row)}
										{@const o = outcome(record.row)}
										{@const warned = (issuesByRow.get(record.row) ?? []).some((x) => x.level === 'warning')}
										<tr class={cn((o.tone === 'out' || o.tone === 'skip') && 'text-muted-foreground')} data-row={record.row} data-outcome={o.tone}>
											<td class="border-border border-b px-2 py-1.5 text-right text-xs tabular-nums">{record.row}</td>
											{#each shownColumns as { c, i } (c)}
												<td class={cn('border-border max-w-64 truncate border-b px-2 py-1.5', c === 'code' && 'font-mono text-xs', c === 'frames' && 'text-right tabular-nums', o.tone === 'skip' && 'line-through decoration-current/40')} title={record.cells[i]}>
													{#if c === 'frames'}
														{@const f = parseFrames(record.cells[i] ?? '')}
														{#if f.kind === 'frames'}{number.format(f.frames)}{:else}<span class="text-warning">{record.cells[i] ?? ''}</span>{/if}
													{:else}
														{record.cells[i] ?? ''}
													{/if}
												</td>
											{/each}
											<td class="border-border border-b px-2 py-1.5 text-xs">
												<span class={cn('inline-flex items-center gap-1', o.tone === 'out' && 'text-destructive', o.tone === 'replace' && 'text-info', o.tone === 'new' && 'text-success')}>
													{o.word}{#if warned}<TriangleAlert class="text-warning size-3.5" aria-label="See the problem for this row" />{/if}
												</span>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</section>
				{/if}
			</div>
			<Dialog.Footer class="border-border mx-0 mb-0 flex items-center gap-3 rounded-b-xl border-t px-5 py-3 sm:justify-between">
				<p class="text-muted-foreground text-xs" data-slot="breakdown-summary">
					{adding} new, {replacing} replacing.{leftOut ? ` ${leftOut} left out.` : ''}{warnings.length ? ` ${warnings.length} with a field left blank or unlinked.` : ''}{plan.assetsToAdd.length
						? ` Adds ${plan.assetsToAdd.length} ${plan.assetsToAdd.length === 1 ? 'asset' : 'assets'}.`
						: ''}
				</p>
				<div class="flex gap-2">
					<Button variant="outline" onclick={() => (stage = 'rows')} data-slot="breakdown-back"><ArrowLeft data-icon="inline-start" />Back to the rows</Button>
					<Button onclick={add} disabled={!plan.ready} data-slot="breakdown-add">{buttonLabel}</Button>
				</div>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
