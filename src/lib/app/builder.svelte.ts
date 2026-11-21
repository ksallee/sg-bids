/**
 * A draft request's page state: its name and details, its bids and their rows, its vendors, and the
 * project's schema, Sequences and field mapping. It holds no rule of its own: each change goes
 * through a pure module (`request-draft`, `vendor-rows`, `readiness`, `row-edit`), then the whole
 * page goes to the storage seam (`$lib/drafts`), debounced, in one write. One instance per page load.
 *
 * Rows are live: opening the page reads its rows' values from Flow PT in one batched read per kind,
 * and an edit to a column a Flow PT field feeds writes that field as the signed in person, then reads
 * it back (`$lib/pure/row-edit`, `$lib/io/fpt-write`). Every row sits in one bid, named by its
 * `package`. New rows go to the bid picked (`current`).
 */

import type { EntityRow, FieldSchema } from 'sg-widgets-core';
import { liveAuth, liveContext, liveState, liveWriter } from '$lib/live';
import type { LoadedRequest } from '$lib/api';
import { drafts } from '$lib/drafts';
import { requestColumns, type ColumnKey, type RequestColumn } from '$lib/pure/live-columns';
import { liveItems, liveKeys } from '$lib/pure/live-read';
import { applyLocal, changesOf, itemValue, planEdits, readBack, undoPlan, type CellChange, type Change, type FptWrite, type Refusal, type WriteOutcome } from '$lib/pure/row-edit';
import { loadMapping, storeMapping } from '$lib/app/mapping-store';
import { fptApi } from '$lib/io/fpt-api';
import { createField, createMany, readCreateRight } from '$lib/io/fpt-field-create';
import { preflight, readRows, writeFields } from '$lib/io/fpt-write';
import { loadSequences, loadShape, rowsByCodes, rowsByIds, type ProjectShape } from '$lib/io/reads';
import type { CreateAnswer, CreateRight, PlannedCreate } from '$lib/pure/field-create';
import { cleanMapping, detectMapping, mappingStatus, readFields, type ItemKind, type Mapping, type MappingStatus } from '$lib/pure/field-map';
import { freezeAsset, freezeShot, sequenceIndex, type SequenceIndex } from '$lib/pure/freeze';
import { headerForm, type HeaderForm, type ProjectPick } from '$lib/pure/header';
import { addPicked } from '$lib/pure/pick';
import { applyBreakdown, type BreakdownPlan } from '$lib/pure/breakdown';
import { codesToFind, matchRows, withLinks, type Match } from '$lib/pure/match';
import type { ItemLink } from '$lib/pure/wire';
import { handAsset, handShot, removeItems, tiersFor } from '$lib/pure/request';
import type { Id, RequestAsset, RequestShot, Target } from '$lib/pure/model';
import { addBid, bidKey, bidStats, deleteBid, draftFrom, inBid, moveRows, renameBid, type BidStats, type DraftBid } from '$lib/pure/request-draft';
import { blankVendor, fromInvited, isBlank, withoutBid, type VendorRow } from '$lib/pure/vendor-rows';
import { readiness, type Readiness, type Target as Place } from '$lib/pure/readiness';
import { today } from '$lib/app/today';

/** The table column a mapping slot fills. */
const SLOT_COLUMN: Readonly<Record<string, ColumnKey>> = { description: 'description', frames: 'frames', type: 'type', difficulty: 'difficulty' };

type Load<T> = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error'; message: string };

export interface ProjectData {
	readonly shape: ProjectShape;
	readonly sequences: SequenceIndex;
	readonly sequenceRows: EntityRow[];
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function uuid(): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/** Where the page stands against storage, for the header line. */
export type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: Date } | { kind: 'error'; message: string };

/** What one edit to the rows did: the changes that landed, and each cell left unchanged with why. */
export interface EditOutcome {
	readonly kind: ItemKind;
	readonly key: ColumnKey;
	readonly changes: readonly Change[];
	readonly failures: readonly Refusal[];
}

/** How long the page waits after the last change before it saves. */
const SAVE_DELAY_MS = 800;

export class Builder {
	/** The request's id, its project, and its rows: each row names its bid in `package`. */
	state = $state<{ id: Id; project: ProjectPick; shots: RequestShot[]; assets: RequestAsset[] }>({ id: '', project: { id: 0, name: '' }, shots: [], assets: [] });
	/** The name and the details, as typed. The name is `form.title`. */
	form = $state<HeaderForm>(headerForm({ project: '', round: 1, baseCurrency: 'USD', assumptions: [] }));
	bids = $state<DraftBid[]>([]);
	/** The bid new rows go to. */
	current = $state<Id>('');
	vendors = $state<VendorRow[]>([]);
	data = $state.raw<Load<ProjectData>>({ state: 'idle' });
	mapping = $state<{ shot: Mapping; asset: Mapping } | null>(null);
	/** Rows picked from Flow PT that it did not answer for at the last read: deleted, or out of reach. */
	gone = $state.raw<ReadonlySet<string>>(new Set());
	/** The fields the permission preflight was refused on, per kind, with the site's words (094). */
	denied = $state.raw<{ shot: Record<string, string>; asset: Record<string, string> }>({ shot: {}, asset: {} });
	/** Where the live read stands. */
	live = $state.raw<{ state: 'idle' | 'reading' | 'ready' } | { state: 'error'; message: string }>({ state: 'idle' });
	private asked = { shot: false, asset: false };
	saving = $state<SaveState>({ kind: 'idle' });
	/** The mapping was kept for this project: set by hand once, so it is not offered as a check again. */
	mappingKept = $state(false);
	/** A draft is always editable. The match dialog reads it. */
	readonly readOnly = false;
	/**
	 * A row the table should take the cursor to, its first cell open to type in: a row just added by
	 * hand, or one the issue list points at. The table clears it once it is there.
	 */
	cursor = $state<{ kind: ItemKind; id: Id; seq: number } | null>(null);
	private cursorSeq = 0;

	readonly ready: Promise<void>;

	private timer: ReturnType<typeof setTimeout> | null = null;
	private discarded = false;
	private inFlight: Promise<void> | null = null;
	private again = false;

	constructor(loaded: LoadedRequest, project: ProjectPick) {
		const draft = draftFrom(loaded.request, bidKey(uuid()));
		this.state = { id: loaded.request.id, project, shots: [...draft.rows.shots], assets: [...draft.rows.assets] };
		this.form = headerForm(loaded.request.header);
		this.bids = draft.bids;
		this.current = draft.bids[0].key;
		const vendors = loaded.invitations.map((inv) => fromInvited(inv.vendor, inv.state.kind === 'pending'));
		this.vendors = vendors.length > 0 ? vendors : [blankVendor(uuid())];
		this.saving = { kind: 'saved', at: new Date() };
		this.ready = this.start();
	}

	private async start(): Promise<void> {
		await this.loadProject(this.state.project);
		await this.readLive();
	}

	/* the page as a whole -------------------------------------------------- */

	/** How far the draft is from going out. */
	get readiness(): Readiness {
		return readiness({ form: this.form, today: today(), bids: this.bids, rows: { shots: this.state.shots, assets: this.state.assets }, vendors: this.vendors });
	}

	/** Each bid's counts, by key. */
	get stats(): Map<Id, BidStats> {
		return bidStats(this.bids, { shots: this.state.shots, assets: this.state.assets });
	}

	/** The vendors typed in: the blank rows left out. */
	get namedVendors(): VendorRow[] {
		return this.vendors.filter((v) => !isBlank(v));
	}

	/** Store the page once the changes settle. */
	private save(): void {
		if (this.discarded) return;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
	}

	/** Store the page now. One save at a time; a change during a save saves again after it. */
	async flush(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		if (this.discarded) return;
		if (this.inFlight) {
			this.again = true;
			return this.inFlight;
		}
		this.saving = { kind: 'saving' };
		this.inFlight = drafts
			.save({ id: this.state.id, project: this.state.project, form: this.form, bids: this.bids, rows: { shots: this.state.shots, assets: this.state.assets }, vendors: this.vendors })
			.then(() => {
				this.saving = { kind: 'saved', at: new Date() };
			})
			.catch((error) => {
				this.saving = { kind: 'error', message: message(error) };
			})
			.finally(() => {
				this.inFlight = null;
				if (this.again) {
					this.again = false;
					void this.flush();
				}
			});
		await this.inFlight;
		if (this.inFlight) await this.inFlight;
	}

	/** Leave the page: nothing is saved from here on, so a change waiting to save cannot bring a deleted draft back. */
	discard(): void {
		this.discarded = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	/* name and details ------------------------------------------------------ */

	setForm(form: HeaderForm): void {
		this.form = form;
		this.save();
	}

	setName(name: string): void {
		this.setForm({ ...this.form, title: name });
	}

	/* bids ------------------------------------------------------------------ */

	/** One more bid, named `Bid N`, and new rows go to it. Answers its key. */
	addBid(): Id {
		const key = bidKey(uuid());
		this.bids = addBid(this.bids, key);
		this.current = key;
		this.save();
		return key;
	}

	/** Rename a bid. Answers why not when the name does not fit. */
	renameBid(key: Id, name: string): string | null {
		const next = renameBid(this.bids, key, name);
		if (!next.ok) return next.message;
		this.bids = next.bids;
		this.save();
		return null;
	}

	/** Delete a bid: its rows go with it (`rowsTo` null) or move to that bid. Its vendors keep their others. */
	deleteBid(key: Id, rowsTo: Id | null): void {
		const next = deleteBid(this.bids, { shots: this.state.shots, assets: this.state.assets }, key, rowsTo);
		if (next.bids === this.bids) return;
		this.bids = [...next.bids];
		this.state = { ...this.state, shots: [...next.rows.shots], assets: [...next.rows.assets] };
		this.vendors = withoutBid(this.vendors, key);
		if (this.current === key) this.current = rowsTo ?? this.bids[0].key;
		this.save();
	}

	/** Rows to another bid of the request. */
	moveRows(targets: readonly Target[], to: Id): void {
		const next = moveRows({ shots: this.state.shots, assets: this.state.assets }, targets, to);
		this.state = { ...this.state, shots: [...next.shots], assets: [...next.assets] };
		this.save();
	}

	bidName(key: Id | undefined): string {
		return this.bids.find((b) => b.key === key)?.name ?? '';
	}

	/* vendors --------------------------------------------------------------- */

	setVendors(vendors: VendorRow[]): void {
		this.vendors = vendors;
		this.save();
	}

	setVendor(id: Id, change: (row: VendorRow) => VendorRow): void {
		this.setVendors(this.vendors.map((v) => (v.id === id ? change(v) : v)));
	}

	/** One more empty row to type in. Answers its id. */
	addVendor(): Id {
		const row = blankVendor(uuid());
		this.setVendors([...this.vendors, row]);
		return row.id;
	}

	/** A row goes. The last one is emptied rather than removed, so there is always a row to type in. */
	removeVendor(id: Id): void {
		const left = this.vendors.filter((v) => v.id !== id);
		this.setVendors(left.length > 0 ? left : [blankVendor(uuid())]);
	}

	/* the project ----------------------------------------------------------- */

	private async loadProject(project: ProjectPick): Promise<void> {
		this.data = { state: 'loading' };
		try {
			const context = liveContext();
			const shape = await loadShape(context);
			const rows = await loadSequences(context.client, project.id, shape.site.sequenceEpisodeField);
			const saved = loadMapping(liveState().siteUrl, project.id);
			this.mappingKept = saved !== null;
			this.mapping = {
				shot: saved ? cleanMapping('shot', saved.shot, shape.shot, shape.site) : detectMapping('shot', shape.shot, shape.site),
				asset: saved ? cleanMapping('asset', saved.asset, shape.asset, shape.site) : detectMapping('asset', shape.asset, shape.site)
			};
			this.data = { state: 'ready', value: { shape, sequenceRows: rows, sequences: sequenceIndex(rows, shape.site.sequenceEpisodeField) } };
		} catch (error) {
			this.data = { state: 'error', message: message(error) };
		}
	}

	schemaOf(kind: ItemKind): Record<string, FieldSchema> {
		if (this.data.state !== 'ready') return {};
		return kind === 'shot' ? this.data.value.shape.shot : this.data.value.shape.asset;
	}

	/**
	 * Map a slot to a field, then read the rows again so every live value follows the mapping. A
	 * field made a moment ago is empty on every row: it first takes what the page shows for the slot,
	 * so nothing typed is lost (`seed`).
	 */
	setMapping(kind: ItemKind, slot: string, field: string | null, options: { fresh?: boolean } = {}): Promise<void> {
		if (!this.mapping) return Promise.resolve();
		const key = SLOT_COLUMN[slot];
		this.mapping = { ...this.mapping, [kind]: { ...this.mapping[kind], [slot]: field } };
		this.keepMapping();
		this.asked[kind] = false;
		if (this.itemsOf(kind).length === 0) return Promise.resolve();
		return (async () => {
			if (options.fresh && field && key) await this.seed(kind, key, field);
			await this.readLive();
		})();
	}

	/** Keep the mapping shown for this project, so it is not offered as a check again. */
	keepMapping(): void {
		if (!this.mapping) return;
		storeMapping(liveState().siteUrl, this.state.project.id, this.mapping);
		this.mappingKept = true;
	}

	/** The fields read and what is left unmapped. Null until the project is read. */
	get mappingStatus(): MappingStatus | null {
		if (this.data.state !== 'ready' || !this.mapping) return null;
		const shape = this.data.value.shape;
		return mappingStatus(this.mapping, { shot: shape.shot, asset: shape.asset }, shape.site);
	}

	private right: Promise<CreateRight> | null = null;

	/** Whether the person may create a field in Flow PT, read once (132). */
	createRight(): Promise<CreateRight> {
		this.right ??= (async () => {
			const auth = liveAuth();
			return readCreateRight(fptApi(auth.siteUrl, auth.token), await auth.token());
		})().catch((error) => {
			this.right = null;
			return { state: 'unknown' as const, reason: `The right could not be read: ${message(error)}` };
		});
		return this.right;
	}

	/** Create the planned field, read the schema again and map the new field. Answers what the site said. */
	async createField(plan: PlannedCreate): Promise<CreateAnswer> {
		const auth = liveAuth();
		const answer = await createField(fptApi(auth.siteUrl, auth.token), plan);
		if (answer.state !== 'created' && answer.state !== 'renamed') return answer;
		const context = liveContext();
		context.schema.invalidate();
		const shape = await loadShape(context);
		if (this.data.state === 'ready') this.data = { state: 'ready', value: { ...this.data.value, shape } };
		await this.setMapping(plan.kind, plan.slot, answer.name, { fresh: true });
		return answer;
	}

	/**
	 * Create the planned fields in order (`createMany`), then read the schema again once and map each
	 * created field. Answers what the site said to each one it was sent; a refusal stops the run.
	 */
	async createFields(plans: readonly PlannedCreate[], onEach?: (index: number, answer: CreateAnswer) => void): Promise<CreateAnswer[]> {
		const auth = liveAuth();
		const answers = await createMany(fptApi(auth.siteUrl, auth.token), plans, onEach);
		const made = answers.flatMap((answer, i) => (answer.state === 'created' || answer.state === 'renamed' ? [{ plan: plans[i], name: answer.name }] : []));
		if (made.length === 0) return answers;
		const context = liveContext();
		context.schema.invalidate();
		const shape = await loadShape(context);
		if (this.data.state === 'ready') this.data = { state: 'ready', value: { ...this.data.value, shape } };
		for (const { plan, name } of made) await this.setMapping(plan.kind, plan.slot, name, { fresh: true });
		return answers;
	}

	fieldsFor(kind: ItemKind): string[] {
		return this.mapping ? readFields(kind, this.mapping[kind], this.schemaOf(kind)) : ['code'];
	}

	private freezer(kind: 'shot'): (row: EntityRow, position: number) => RequestShot;
	private freezer(kind: 'asset'): (row: EntityRow, position: number) => RequestAsset;
	private freezer(kind: ItemKind): (row: EntityRow, position: number) => RequestShot | RequestAsset {
		const mapping = this.mapping?.[kind] ?? {};
		const sequences = this.data.state === 'ready' ? this.data.value.sequences : new Map();
		return kind === 'shot' ? (row, position) => freezeShot(row, mapping, sequences, position) : (row, position) => freezeAsset(row, mapping, position);
	}

	/* rows ------------------------------------------------------------------ */

	/** Rows ticked in the Add from Flow PT dialog join the bid picked; one already in the request stays where it is. */
	addRows(kind: ItemKind, rows: EntityRow[], to: Id = this.current): void {
		if (kind === 'shot') this.setItems('shot', inBid(addPicked(this.state.shots, rows, this.freezer('shot')), to));
		else this.setItems('asset', inBid(addPicked(this.state.assets, rows, this.freezer('asset')), to));
		void this.askRights(kind, rows[0]);
	}

	private setItems(kind: ItemKind, items: RequestShot[] | RequestAsset[]): void {
		this.state = kind === 'shot' ? { ...this.state, shots: items as RequestShot[] } : { ...this.state, assets: items as RequestAsset[] };
		this.save();
	}

	/** Take rows out of the request. Picking them again reads them fresh from Flow PT. */
	remove(kind: ItemKind, ids: string[]): void {
		if (kind === 'shot') this.setItems('shot', removeItems(this.state.shots, ids));
		else this.setItems('asset', removeItems(this.state.assets, ids));
	}

	/** Put back rows taken out, each at its place and in its bid, when it is not in the request again already. */
	restore(kind: ItemKind, removed: readonly { index: number; item: RequestShot | RequestAsset }[]): void {
		const current = [...this.itemsOf(kind)];
		const have = new Set(current.map((i) => i.id));
		const known = new Set(this.bids.map((b) => b.key));
		for (const { index, item } of [...removed].sort((a, b) => a.index - b.index)) {
			if (have.has(item.id)) continue;
			const back = item.package && known.has(item.package) ? item : { ...item, package: this.bids[0].key };
			current.splice(Math.min(index, current.length), 0, back);
		}
		this.setItems(kind, current as RequestShot[] | RequestAsset[]);
	}

	/** The table's columns for a kind: live where a field feeds them, locked where the person may not write. */
	columns(kind: ItemKind): RequestColumn[] {
		if (!this.mapping) return [];
		return requestColumns(kind, this.mapping[kind], this.schemaOf(kind), this.denied[kind]);
	}

	private keysOf(kind: ItemKind): ReadonlySet<string> {
		return this.mapping ? liveKeys(kind, this.mapping[kind], this.schemaOf(kind)) : new Set(['code']);
	}

	itemsOf(kind: ItemKind): readonly (RequestShot | RequestAsset)[] {
		return kind === 'shot' ? this.state.shots : this.state.assets;
	}

	/** Merge rows read from Flow PT into the items held now: each read row's live values, nothing else. */
	private mergeRows(kind: ItemKind, rows: readonly EntityRow[]): void {
		if (rows.length === 0) return;
		const read = new Set(rows.map((r) => r.id));
		const items = this.itemsOf(kind);
		const touched = items.filter((i) => i.source !== 'breakdown' && i.fpt && read.has(i.fpt.id));
		const merged =
			kind === 'shot'
				? liveItems(touched as RequestShot[], rows, this.keysOf('shot'), this.freezer('shot'))
				: liveItems(touched as RequestAsset[], rows, this.keysOf('asset'), this.freezer('asset'));
		if (!merged.changed) return;
		const byId = new Map<string, RequestShot | RequestAsset>(merged.items.map((i) => [i.id, i]));
		this.setItems(kind, items.map((i) => byId.get(i.id) ?? i) as RequestShot[] | RequestAsset[]);
	}

	/**
	 * Read every row picked from Flow PT again, one batched read per kind, paged (`rowsByIds`), and
	 * take its live values. A row Flow PT does not answer for is flagged, never dropped. Every live
	 * read and write goes through the bare client: the context's client keeps reads, and a read back
	 * must see Flow PT as it is now.
	 */
	async readLive(): Promise<void> {
		if (!this.mapping || this.data.state !== 'ready') return;
		this.live = { state: 'reading' };
		try {
			const client = liveWriter();
			const gone = new Set<string>();
			for (const kind of ['shot', 'asset'] as const) {
				const type = kind === 'shot' ? 'Shot' : 'Asset';
				const picked = this.itemsOf(kind).filter((i) => i.source !== 'breakdown' && i.fpt);
				if (picked.length === 0) continue;
				const rows = await rowsByIds(client, type, picked.map((i) => i.fpt!.id), this.fieldsFor(kind));
				const read = new Set(rows.map((r) => r.id));
				for (const item of picked) if (!read.has(item.fpt!.id)) gone.add(item.id);
				this.mergeRows(kind, rows);
				void this.askRights(kind, rows[0]);
			}
			this.gone = gone;
			this.live = { state: 'ready' };
		} catch (error) {
			this.live = { state: 'error', message: message(error) };
		}
	}

	/** Ask once per kind which live fields the person may not write, on one of its rows (094). */
	async askRights(kind: ItemKind, row: EntityRow | undefined): Promise<void> {
		if (!row || this.asked[kind]) return;
		this.asked[kind] = true;
		const fields = this.columns(kind).flatMap((c) => (c.field && !c.lock ? [c.field] : []));
		if (fields.length === 0) return;
		try {
			const denied = await preflight(liveWriter(), row, fields);
			if (Object.keys(denied).length > 0) this.denied = { ...this.denied, [kind]: denied };
		} catch {
			this.asked[kind] = false;
		}
	}

	/** Write the Flow PT part of an edit and read its rows back. Answers each write's outcome. */
	private async sendWrites(kind: ItemKind, writes: readonly FptWrite[]): Promise<WriteOutcome[]> {
		if (writes.length === 0) return [];
		const client = liveWriter();
		const refused = await writeFields(client, writes);
		const rows = await readRows(client, writes, () => this.fieldsFor(kind));
		const outcomes = readBack(writes, refused, rows);
		this.mergeRows(kind, rows);
		const gone = writes.filter((_, i) => outcomes[i].state === 'gone').map((w) => w.itemId);
		if (gone.length > 0) this.gone = new Set([...this.gone, ...gone]);
		return outcomes;
	}

	/**
	 * Edit cells of the table. A cell a Flow PT field feeds writes it, as the signed in person, and
	 * shows the value read back; every other cell changes the request. Nothing optimistic stays: a
	 * refused or silent write leaves the row as Flow PT holds it.
	 */
	async editCells(kind: ItemKind, key: ColumnKey, changes: readonly CellChange[]): Promise<EditOutcome> {
		const plan = planEdits(changes, this.itemsOf(kind), this.columns(kind), this.gone);
		if (plan.local.length > 0) this.setItems(kind, applyLocal(this.itemsOf(kind), plan.local) as RequestShot[] | RequestAsset[]);
		let outcomes: WriteOutcome[];
		try {
			outcomes = await this.sendWrites(kind, plan.fpt);
		} catch (error) {
			outcomes = plan.fpt.map(() => ({ state: 'refused' as const, reason: message(error) }));
		}
		const failures: Refusal[] = [
			...plan.refused,
			...plan.fpt.flatMap((w, i) => {
				const o = outcomes[i];
				// A refusal or a write that changed nothing may go through on a second try; a gone row will not.
				return o.state === 'landed' ? [] : [{ itemId: w.itemId, key: w.key, reason: o.reason, retry: o.state !== 'gone' }];
			})
		];
		return { kind, key, changes: changesOf(plan.fpt, outcomes, plan.local), failures };
	}

	/**
	 * Put an edit back. Each Flow PT field is read first: one that no longer holds the edited value
	 * was changed by someone since, and is left. Answers the plan and the writes it could not make.
	 */
	async undo(kind: ItemKind, changes: readonly Change[]): Promise<{ plan: ReturnType<typeof undoPlan>; failures: Refusal[] }> {
		const client = liveWriter();
		const live = changes.flatMap((c) => (c.target ? [c.target] : []));
		const rows = live.length > 0 ? await readRows(client, live, () => this.fieldsFor(kind)) : [];
		const plan = undoPlan(changes, rows);
		// A value someone changed since the edit stays, and the table shows it as Flow PT holds it.
		this.mergeRows(kind, rows);
		if (plan.local.length > 0) this.setItems(kind, applyLocal(this.itemsOf(kind), plan.local) as RequestShot[] | RequestAsset[]);
		const outcomes = await this.sendWrites(kind, plan.fpt);
		const failures = plan.fpt.flatMap((w, i) => {
			const o = outcomes[i];
			return o.state === 'landed' ? [] : [{ itemId: w.itemId, key: w.key, reason: o.reason }];
		});
		return { plan, failures };
	}

	/**
	 * A field just created and mapped takes what the page shows for its column on each row picked from
	 * Flow PT. The field is new and empty, so nothing in Flow PT is overwritten.
	 */
	private async seed(kind: ItemKind, key: ColumnKey, field: string): Promise<void> {
		const writes: FptWrite[] = this.itemsOf(kind).flatMap((item) => {
			const value = itemValue(item, key);
			if (item.source === 'breakdown' || !item.fpt || this.gone.has(item.id) || value === null || typeof value === 'boolean') return [];
			return [{ itemId: item.id, key, type: item.fpt.type, id: item.fpt.id, field, value, before: null }];
		});
		try {
			await this.sendWrites(kind, writes);
		} catch {
			// The live read after it shows what the field holds.
		}
	}

	/** An item's code or name, for a line that names it. */
	codeOf(kind: ItemKind, id: string): string {
		const item = this.itemsOf(kind).find((i) => i.id === id);
		return item ? ('code' in item ? item.code : item.name) : id;
	}

	/**
	 * Rows from a breakdown, as `breakdown.ts` planned them: replaced in place, each in the bid it was
	 * in, new ones after, in the bid picked.
	 */
	addBreakdown(kind: ItemKind, plan: BreakdownPlan<RequestShot> | BreakdownPlan<RequestAsset>, to: Id = this.current): void {
		const was = new Map([...this.state.shots.map((s) => [`shot:${s.id}`, s.package] as const), ...this.state.assets.map((a) => [`asset:${a.id}`, a.package] as const)]);
		const next = applyBreakdown({ shots: this.state.shots, assets: this.state.assets }, plan, kind);
		const place = <T extends { id: Id; package?: Id }>(k: 'shot' | 'asset', rows: readonly T[]): T[] => rows.map((r) => ({ ...r, package: was.get(`${k}:${r.id}`) ?? r.package ?? to }));
		this.state = { ...this.state, shots: place('shot', next.shots), assets: place('asset', next.assets) };
		this.save();
	}

	/**
	 * One empty row typed by hand, in this request only, last in the bid named (the one picked by
	 * default), and the cursor in its first cell. Answers its id.
	 */
	addRow(kind: ItemKind, to: Id = this.current): Id {
		const id = this.breakdownId(kind);
		if (kind === 'shot') this.setItems('shot', [...this.state.shots, handShot(id, to)]);
		else this.setItems('asset', [...this.state.assets, handAsset(id, to)]);
		this.focusRow(kind, id);
		return id;
	}

	/** Take the table's cursor to a row, its first cell open. */
	focusRow(kind: ItemKind, id: Id): void {
		this.cursor = { kind, id, seq: ++this.cursorSeq };
	}

	/** A new id for a breakdown row. Never `shot-<n>`: that is a Flow PT row's. */
	breakdownId(kind: ItemKind): string {
		return `${kind}-bd-${uuid()}`;
	}

	/** Each breakdown row of a kind with no Flow PT row, against the project's rows with the same code. */
	async findMatches(kind: ItemKind): Promise<Match[]> {
		const items = kind === 'shot' ? this.state.shots : this.state.assets;
		const codes = codesToFind(items);
		if (codes.length === 0) return [];
		const rows = await rowsByCodes(liveContext().client, kind === 'shot' ? 'Shot' : 'Asset', this.state.project.id, codes);
		const candidates = rows.flatMap((r) => (typeof r.attributes?.code === 'string' ? [{ id: r.id, code: r.attributes.code }] : []));
		return matchRows(kind, items, candidates);
	}

	/** Give breakdown rows their Flow PT row: an ordinary edit of the draft. */
	async link(kind: ItemKind, links: ItemLink[]): Promise<void> {
		if (links.length === 0) return;
		if (kind === 'shot') this.setItems('shot', withLinks(this.state.shots, links));
		else this.setItems('asset', withLinks(this.state.assets, links));
	}

	tiers(kind: ItemKind): readonly string[] {
		const field = this.mapping?.[kind].difficulty;
		return tiersFor(field ? this.schemaOf(kind)[field] : undefined);
	}
}

/** Where a problem of the readiness list points, as the page marks it. */
export type { Place };
