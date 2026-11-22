/**
 * The comparison page's state: the data from the server, the grid and its view, the scenario being
 * edited with its live summary, and the saves. Logic lives in `$lib/pure` (compare, grid-view,
 * scenario); this holds the values and calls the endpoints.
 *
 * A scenario saves itself a moment after each change. The first pick on a request with no scenario
 * starts one.
 */

import { SvelteSet } from 'svelte/reactivity';
import { compareApi, type Comparison, type StoredScenario } from '$lib/compare-api';
import { compareBids, type Grid, type Row } from '$lib/pure/compare';
import { viewGrid, type GroupBy, type Only, type SortDir, type SortKey } from '$lib/pure/grid-view';
import { targetKey } from '$lib/pure/model';
import {
	againstLowest,
	awardAll,
	awardLowest,
	awardRows,
	clearRow,
	pickCell,
	picksFromList,
	picksToList,
	setShares,
	summarize,
	wholePackages,
	type Picks,
	type Share
} from '$lib/pure/scenario';

const SAVE_AFTER_MS = 700;

export type SaveState = 'saved' | 'waiting' | 'saving' | 'failed';

export class CompareState {
	readonly projectId: number;
	readonly requestId: string;

	data = $state<Comparison | null>(null);
	/** The bid versions asked for, one per vendor at most. Empty: the latest submitted. */
	asked = $state<string[]>([]);
	problem = $state<string | null>(null);

	// The view. Grouped by package when the request has packages, else by sequence (`load`).
	by = $state<GroupBy>('sequence');
	private grouped = false;
	sort = $state<SortKey>('order');
	dir = $state<SortDir>('asc');
	text = $state('');
	differsOver = $state('');
	only = $state<Only>('all');
	lowestColumn = $state<number | null>(null);
	/** Rows cut this round (omitted) take no price: vendors see them marked as cut. Hidden unless asked. */
	hideOmitted = $state(true);
	onlyUnawarded = $state(false);
	collapsed = new SvelteSet<string>();
	showTotals = $state(true);

	// Scenarios.
	scenarios = $state<StoredScenario[]>([]);
	activeId = $state<string | null>(null);
	picks = $state<Picks>(new Map());
	leftOut = $state<ReadonlySet<string>>(new Set());
	saveState = $state<SaveState>('saved');
	saveError = $state<string | null>(null);
	note = $state<string | null>(null);

	private timer: ReturnType<typeof setTimeout> | null = null;
	private dirty = false;
	private saving: Promise<void> | null = null;

	constructor(projectId: number, requestId: string) {
		this.projectId = projectId;
		this.requestId = requestId;
	}

	readonly grid = $derived.by<Grid | null>(() => (this.data ? compareBids(this.data.request, this.data.bids) : null));

	/** The vendor name of each column. */
	readonly names = $derived.by<string[]>(() => {
		const data = this.data;
		const grid = this.grid;
		if (!data || !grid) return [];
		const byId = new Map(data.request.vendors.map((v) => [v.id, v.name]));
		return grid.columns.map((c) => byId.get(c.vendorId) ?? 'Vendor');
	});

	readonly active = $derived(this.scenarios.find((s) => s.id === this.activeId) ?? null);

	readonly summary = $derived(this.grid ? summarize(this.grid, this.picks, this.leftOut) : null);
	readonly lowest = $derived(this.grid && this.summary ? againstLowest(this.grid, this.summary, this.leftOut) : null);

	readonly view = $derived.by(() => {
		const grid = this.grid;
		if (!grid) return null;
		const keys = this.onlyUnawarded && this.summary ? new Set(this.summary.unawarded.map(targetKey)) : null;
		return viewGrid(grid, {
			by: this.by,
			sort: this.sort,
			dir: this.dir,
			collapsed: this.collapsed,
			filter: { text: this.text, differsOver: this.differsOver, only: this.only, lowestColumn: this.lowestColumn, hideOmitted: this.hideOmitted, keys }
		});
	});

	readonly filtering = $derived(
		this.text.trim() !== '' || this.differsOver.trim() !== '' || this.only !== 'all' || this.lowestColumn !== null || this.onlyUnawarded
	);

	clearFilters(): void {
		this.text = '';
		this.differsOver = '';
		this.only = 'all';
		this.lowestColumn = null;
		this.onlyUnawarded = false;
	}

	async load(): Promise<void> {
		const data = await compareApi.load(this.projectId, this.requestId, this.asked);
		this.data = data;
		if (!this.grouped) {
			this.grouped = true;
			if ((data.request.packages?.length ?? 0) > 0 || data.bids.some((b) => (b.packages?.length ?? 0) > 0)) this.by = 'package';
		}
		this.scenarios = [...data.scenarios];
		if (this.activeId === null) {
			const start = data.scenarios.find((s) => s.chosen) ?? data.scenarios[0];
			if (start) this.open(start);
		}
	}

	/** Show another version of a vendor's bid. Picks on the version it replaces stop counting. */
	async showVersion(vendorId: string, bidId: string): Promise<void> {
		const data = this.data;
		if (!data) return;
		const others = this.asked.filter((id) => data.versions.find((v) => v.bidId === id)?.vendorId !== vendorId);
		this.asked = [...others, bidId];
		await this.load();
	}

	// Rates.

	async setRate(bidId: string, rate: { rate: string; date: string } | null): Promise<void> {
		await compareApi.setRate(this.projectId, this.requestId, bidId, rate);
		await this.load();
	}

	// Scenarios.

	open(scenario: StoredScenario): void {
		void this.flush();
		this.activeId = scenario.id;
		this.picks = picksFromList(scenario.picks);
		this.leftOut = new Set(scenario.costsLeftOut);
		this.saveState = 'saved';
		this.saveError = null;
	}

	private nextName(): string {
		const taken = new Set(this.scenarios.map((s) => s.name));
		for (let n = this.scenarios.length + 1; ; n++) if (!taken.has(`Scenario ${n}`)) return `Scenario ${n}`;
	}

	async create(from: Picks = new Map(), name = this.nextName()): Promise<void> {
		await this.flush();
		const grid = this.grid;
		if (!grid) return;
		const { scenario } = await compareApi.save(this.projectId, this.requestId, { name, picks: picksToList(grid, from), costsLeftOut: [] });
		this.scenarios = [...this.scenarios, scenario];
		this.open(scenario);
	}

	async duplicate(): Promise<void> {
		const active = this.active;
		if (!active) return;
		await this.create(this.picks, `${active.name} copy`.slice(0, 200));
	}

	async rename(name: string): Promise<void> {
		if (!this.activeId) return;
		const { scenario } = await compareApi.rename(this.projectId, this.requestId, this.activeId, name);
		this.scenarios = this.scenarios.map((s) => (s.id === scenario.id ? { ...s, name: scenario.name } : s));
	}

	async remove(): Promise<void> {
		const id = this.activeId;
		if (!id) return;
		this.cancelTimer();
		this.dirty = false;
		await compareApi.remove(this.projectId, this.requestId, id);
		this.scenarios = this.scenarios.filter((s) => s.id !== id);
		this.activeId = null;
		this.picks = new Map();
		this.leftOut = new Set();
		const next = this.scenarios[0];
		if (next) this.open(next);
	}

	async choose(chosen: boolean): Promise<void> {
		await this.flush();
		const { scenarios } = await compareApi.choose(this.projectId, this.requestId, chosen ? this.activeId : null);
		this.scenarios = scenarios;
	}

	/**
	 * Take the new picks. A package priced as one figure that was given whole and is no longer, by a
	 * change to another of its rows, is said: it went whole off that vendor.
	 */
	private change(picks: Picks, untouched: { bidId: string; package: string } | null = null): void {
		const grid = this.grid;
		if (grid) {
			const after = new Set(wholePackages(grid, picks).map((w) => `${w.bidId}|${w.package}`));
			const lost = wholePackages(grid, this.picks).filter((w) => !after.has(`${w.bidId}|${w.package}`) && !(untouched && untouched.bidId === w.bidId && untouched.package === w.package));
			if (lost.length > 0) {
				const column = grid.columns.findIndex((c) => c.bidId === lost[0].bidId);
				const name = grid.packages.find((p) => p.id === lost[0].package)?.name ?? 'The package';
				this.note = `${this.names[column] ?? 'That vendor'} priced ${name} as one figure, so all of ${name} came off it. A package priced as one figure is awarded whole or not at all.`;
			}
		}
		this.picks = picks;
		this.schedule();
	}

	async pick(row: Row, column: number): Promise<void> {
		const grid = this.grid;
		if (!grid) return;
		if (!this.activeId) await this.create();
		const cell = row.cells[column];
		// A click on a row in the package price takes the whole package on or off: no note for that.
		const own = cell?.kind === 'package' ? { bidId: grid.columns[column].bidId, package: cell.package } : null;
		this.note = null;
		this.change(pickCell(grid, this.picks, row, column), own);
	}

	split(row: Row, shares: readonly Share[]): string | null {
		const grid = this.grid;
		if (!grid) return null;
		const result = setShares(grid, this.picks, row, shares);
		if (!result.ok) return result.message;
		this.change(result.picks);
		return null;
	}

	clear(row: Row): void {
		const grid = this.grid;
		this.change(grid ? clearRow(this.picks, row, grid) : clearRow(this.picks, row));
	}

	private async bulk(work: (grid: Grid, picks: Picks) => { picks: Picks; skipped: number }, what: string): Promise<void> {
		const grid = this.grid;
		if (!grid) return;
		if (!this.activeId) await this.create();
		const { picks, skipped } = work(grid, this.picks);
		this.change(picks);
		this.note = skipped > 0 ? `${what} ${skipped} ${skipped === 1 ? 'row was' : 'rows were'} left unawarded.` : null;
	}

	awardAllTo(column: number): Promise<void> {
		return this.bulk((grid, picks) => awardAll(grid, picks, column), `${this.names[column]} did not price every row.`);
	}

	awardLowest(): Promise<void> {
		return this.bulk((grid, picks) => awardLowest(grid, picks), 'Some rows have no known lowest yet.');
	}

	awardGroupTo(groupKey: string, column: number): Promise<void> {
		const group = this.view?.groups.find((g) => g.key === groupKey);
		if (!group) return Promise.resolve();
		return this.bulk((grid, picks) => awardRows(grid, picks, group.rows, column), `${this.names[column]} did not price all of ${group.label}.`);
	}

	clearAll(): void {
		this.change(new Map());
		this.note = null;
	}

	toggleCosts(bidId: string, included: boolean): void {
		const next = new Set(this.leftOut);
		if (included) next.delete(bidId);
		else next.add(bidId);
		this.leftOut = next;
		this.schedule();
	}

	// Saving.

	private cancelTimer(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	private schedule(): void {
		this.dirty = true;
		this.saveState = 'waiting';
		this.cancelTimer();
		this.timer = setTimeout(() => void this.flush(), SAVE_AFTER_MS);
	}

	/** Save the active scenario now when it has changes. */
	async flush(): Promise<void> {
		this.cancelTimer();
		if (this.saving) await this.saving;
		if (!this.dirty || !this.activeId || !this.grid) return;
		const active = this.active;
		if (!active) return;
		this.dirty = false;
		this.saveState = 'saving';
		const body = { id: active.id, name: active.name, picks: picksToList(this.grid, this.picks), costsLeftOut: [...this.leftOut] };
		this.saving = compareApi
			.save(this.projectId, this.requestId, body)
			.then(({ scenario }) => {
				this.scenarios = this.scenarios.map((s) => (s.id === scenario.id ? scenario : s));
				if (!this.dirty) this.saveState = 'saved';
				this.saveError = null;
			})
			.catch((error: unknown) => {
				this.dirty = true;
				this.saveState = 'failed';
				this.saveError = error instanceof Error ? error.message : String(error);
			})
			.finally(() => {
				this.saving = null;
			});
		await this.saving;
	}
}
