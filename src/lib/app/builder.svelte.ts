/**
 * The request builder's page state: the draft, the project's schema and Sequences, the mapping.
 * It holds no rule of its own: each change goes through a pure module, then the draft goes to the
 * storage seam (`$lib/drafts`), debounced, with the tab's cushion kept on every change. One
 * instance per page load. An issued request opens read only.
 */

import type { EntityRow, FieldSchema } from 'sg-widgets-core';
import { liveAuth, liveContext, liveState, prepareLive } from '$lib/live';
import { api, ApiError, type RequestStatus } from '$lib/api';
import { setCurrentProject, currentProject } from '$lib/current-project';
import { cushion, drafts } from '$lib/drafts';
import { isLocalId, localId, savable } from '$lib/pure/persist';
import { loadMapping, storeMapping } from '$lib/app/mapping-store';
import { fptApi } from '$lib/io/fpt-api';
import { createField, readCreateRight } from '$lib/io/fpt-field-create';
import { loadSequences, loadShape, rowsByCodes, rowsByIds, type ProjectShape } from '$lib/io/reads';
import type { CreateAnswer, CreateRight, PlannedCreate } from '$lib/pure/field-create';
import { cleanMapping, detectMapping, mappingStatus, readFields, type ItemKind, type Mapping, type MappingStatus } from '$lib/pure/field-map';
import { freezeAsset, freezeShot, sequenceIndex, type SequenceIndex } from '$lib/pure/freeze';
import { emptyHeaderForm, suggestCode, type HeaderForm, type ProjectPick } from '$lib/pure/header';
import { addPicked, mergePicked, refrozen } from '$lib/pure/pick';
import { applyBreakdown, type BreakdownPlan } from '$lib/pure/breakdown';
import { codesToFind, matchRows, withLinks, type Match } from '$lib/pure/match';
import type { ItemLink } from '$lib/pure/wire';
import { readiness, type OtherRequest, type Readiness } from '$lib/pure/readiness';
import { buildRequest, editItem, editItems, removeItems, restoreState, tiersFor, type BuilderState } from '$lib/pure/request';
import type { RequestAsset, RequestShot } from '$lib/pure/model';
import { today } from '$lib/app/today';

type Load<T> = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error'; message: string };

export interface ProjectData {
	readonly shape: ProjectShape;
	readonly sequences: SequenceIndex;
	readonly sequenceRows: EntityRow[];
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function newId(): string {
	return localId(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()));
}

/** Where the draft stands against storage, for the header line. */
export type SaveState =
	| { kind: 'idle' }
	| { kind: 'waiting'; reason: string }
	| { kind: 'saving' }
	| { kind: 'saved'; at: Date }
	| { kind: 'error'; message: string };

/** How long the builder waits after the last change before it saves. */
const SAVE_DELAY_MS = 800;

export class Builder {
	state = $state<BuilderState>({ id: newId(), project: null, form: emptyHeaderForm(), shots: [], assets: [] });
	problem = $state<string | null>(null);
	data = $state.raw<Load<ProjectData>>({ state: 'idle' });
	mapping = $state<{ shot: Mapping; asset: Mapping } | null>(null);
	/** True once the draft has been read back from storage. */
	restored = $state(false);
	/** Picked items read with an older mapping than the one shown. */
	stale = $state(false);
	status = $state<RequestStatus>('draft');
	saving = $state<SaveState>({ kind: 'idle' });
	/** The project's other requests, for the code: made from the first free number, never one in use. */
	others = $state.raw<OtherRequest[]>([]);
	/** The list is read (or failed): a blank code may be made now without clashing with one in use. */
	private othersRead = false;
	/** The mapping was kept for this project: set by hand once, so it is not offered as a check again. */
	mappingKept = $state(false);

	/** How far the draft is from going out, named field by field. */
	readonly readiness: Readiness = $derived(readiness({ state: this.state, today: today(), others: this.others }));

	/** The code a blank one saves as. */
	get suggestedCode(): string {
		const project = this.state.project;
		return project ? suggestCode(project.name, this.others.filter((o) => o.id !== this.state.id).map((o) => o.code)) : '';
	}

	readonly ready: Promise<void>;
	/** Called once a new draft has its stored id, so the page can put it in the URL. */
	onStored: ((id: string) => void) | null = null;

	private timer: ReturnType<typeof setTimeout> | null = null;
	private inFlight: Promise<void> | null = null;
	private again = false;

	constructor(requestId: string | null) {
		this.ready = this.start(requestId);
	}

	get readOnly(): boolean {
		return this.status !== 'draft';
	}

	private async start(requestId: string | null): Promise<void> {
		const live = await prepareLive();
		this.problem = live.problem;
		if (live.problem) return;
		if (requestId) {
			const project = currentProject(live.siteUrl);
			if (!project) throw new Error('Open the request from the requests list.');
			const loaded = await drafts.loadDraft(requestId, project.id);
			this.state = restoreState(loaded.request);
			this.status = loaded.status;
			if (this.state.project) this.state = { ...this.state, project: { ...this.state.project, name: this.state.project.name || project.name } };
			this.saving = { kind: 'saved', at: new Date() };
		} else {
			const kept = await cushion.read();
			if (kept && isLocalId(kept.id)) this.state = restoreState(kept);
		}
		this.restored = true;
		if (this.state.project) await this.loadProject(this.state.project);
	}

	request() {
		return buildRequest(this.state);
	}

	/** Keep the cushion now and store the draft once the changes settle. */
	private save(): void {
		if (this.readOnly) return;
		void cushion.keep(buildRequest(this.state));
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
	}

	/** Store the draft now. One save at a time; a change during a save saves again after it. */
	async flush(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		if (this.inFlight) {
			this.again = true;
			return this.inFlight;
		}
		if (this.state.project && !this.othersRead && this.state.form.code.trim() === '') {
			this.saving = { kind: 'waiting', reason: 'Making the request code.' };
			return;
		}
		const ready = savable(this.state, this.suggestedCode);
		if (!ready.ok) {
			this.saving = { kind: 'waiting', reason: ready.reason };
			return;
		}
		this.saving = { kind: 'saving' };
		const wasLocal = isLocalId(this.state.id);
		this.inFlight = drafts
			.saveDraft({ id: this.state.id, header: ready.header, shots: [...ready.items.shots], assets: [...ready.items.assets], vendors: [] })
			.then((stored) => {
				if (wasLocal) {
					this.state = { ...this.state, id: stored.id };
					void cushion.clear();
					this.onStored?.(stored.id);
				}
				this.saving = { kind: 'saved', at: new Date() };
			})
			.catch((error) => {
				// The database keeps one request per code and round in a project; `readiness` names the clash first.
				const clash = error instanceof ApiError && error.status === 409;
				this.saving = { kind: 'error', message: clash ? `Another request in this project has the code ${ready.code} in this round. Change the code.` : message(error) };
			})
			.finally(() => {
				this.inFlight = null;
				if (this.again) {
					this.again = false;
					void this.flush();
				}
			});
		return this.inFlight;
	}

	/** Issue the stored draft: its items freeze, and the builder turns read only. */
	async issue(): Promise<void> {
		await this.flush();
		if (this.inFlight) await this.inFlight;
		if (isLocalId(this.state.id) || !this.state.project) throw new Error('The draft is not saved yet.');
		await api.issue(this.state.project.id, this.state.id);
		this.status = 'issued';
	}

	/** A new draft for the next round of this issued request. Answers its id. */
	async newRound(): Promise<string> {
		if (!this.state.project) throw new Error('No project.');
		const { request } = await api.newRound(this.state.project.id, this.state.id);
		return request.id;
	}

	private async loadProject(project: ProjectPick): Promise<void> {
		this.data = { state: 'loading' };
		void this.loadOthers(project);
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

	/** The project's requests, for a free code. A blank code is filled with it, so the draft saves at once. */
	private async loadOthers(project: ProjectPick): Promise<void> {
		try {
			const rows = await api.list(project.id);
			if (this.state.project?.id !== project.id) return;
			this.others = rows.map((r) => ({ id: r.id, code: r.code, round: r.round }));
		} catch {
			// Without the list the code is made from the project alone; a clash is named when it saves.
		}
		if (this.state.project?.id === project.id) this.othersRead = true;
		if (!this.readOnly && this.state.project?.id === project.id && this.state.form.code.trim() === '') {
			this.setForm({ ...this.state.form, code: this.suggestedCode });
		}
	}

	/** One project per request: a new one starts the picks over. */
	async setProject(project: ProjectPick | null): Promise<void> {
		if (this.readOnly || project?.id === this.state.project?.id) return;
		setCurrentProject(liveState().siteUrl, project);
		// A code made from the last project goes with it; one typed by hand stays.
		const made = this.state.form.code.trim() !== '' && this.state.form.code.trim() === this.suggestedCode;
		this.state = { ...this.state, project, form: made ? { ...this.state.form, code: '' } : this.state.form, shots: [], assets: [] };
		this.others = [];
		this.othersRead = false;
		this.mapping = null;
		this.stale = false;
		this.data = { state: 'idle' };
		this.save();
		if (project) await this.loadProject(project);
	}

	setForm(form: HeaderForm): void {
		if (this.readOnly) return;
		this.state = { ...this.state, form };
		this.save();
	}

	schemaOf(kind: ItemKind): Record<string, FieldSchema> {
		if (this.data.state !== 'ready') return {};
		return kind === 'shot' ? this.data.value.shape.shot : this.data.value.shape.asset;
	}

	setMapping(kind: ItemKind, slot: string, field: string | null, options: { fresh?: boolean } = {}): void {
		if (!this.mapping || !this.state.project) return;
		this.mapping = { ...this.mapping, [kind]: { ...this.mapping[kind], [slot]: field } };
		this.keepMapping();
		// A field made a moment ago is empty on every row: copying again would only drop edits.
		if (!options.fresh && this.state.shots.length + this.state.assets.length > 0) this.stale = true;
	}

	/** Keep the mapping shown for this project, so it is not offered as a check again. */
	keepMapping(): void {
		if (!this.mapping || !this.state.project) return;
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
		this.setMapping(plan.kind, plan.slot, answer.name, { fresh: true });
		return answer;
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

	/** The table's selection changed. Rows not at hand are read by id. */
	async select(kind: ItemKind, ids: number[], rows: EntityRow[]): Promise<void> {
		const type = kind === 'shot' ? 'Shot' : 'Asset';
		const current = kind === 'shot' ? this.state.shots : this.state.assets;
		let merged = kind === 'shot' ? mergePicked(current as RequestShot[], ids, rows, this.freezer('shot')) : mergePicked(current as RequestAsset[], ids, rows, this.freezer('asset'));
		if (merged.missing.length > 0) {
			const extra = await rowsByIds(liveContext().client, type, merged.missing, this.fieldsFor(kind));
			merged = kind === 'shot' ? mergePicked(current as RequestShot[], ids, [...rows, ...extra], this.freezer('shot')) : mergePicked(current as RequestAsset[], ids, [...rows, ...extra], this.freezer('asset'));
		}
		this.setItems(kind, merged.items);
	}

	/** Select all: every row the filter matches joins the picks. */
	addRows(kind: ItemKind, rows: EntityRow[]): void {
		if (kind === 'shot') this.setItems('shot', addPicked(this.state.shots, rows, this.freezer('shot')));
		else this.setItems('asset', addPicked(this.state.assets, rows, this.freezer('asset')));
	}

	clear(kind: ItemKind): void {
		this.setItems(kind, []);
	}

	private setItems(kind: ItemKind, items: RequestShot[] | RequestAsset[]): void {
		if (this.readOnly) return;
		this.state = kind === 'shot' ? { ...this.state, shots: items as RequestShot[] } : { ...this.state, assets: items as RequestAsset[] };
		this.save();
	}

	editShot(id: string, patch: Parameters<typeof editItem>[2]): void {
		this.setItems('shot', editItem(this.state.shots, id, patch));
	}

	editAsset(id: string, patch: Parameters<typeof editItem>[2]): void {
		this.setItems('asset', editItem(this.state.assets, id, patch));
	}

	/** One edit to several items of a kind: a difficulty for every row shown. */
	editMany(kind: ItemKind, ids: string[], patch: Parameters<typeof editItem>[2]): void {
		if (kind === 'shot') this.setItems('shot', editItems(this.state.shots, ids, patch));
		else this.setItems('asset', editItems(this.state.assets, ids, patch));
	}

	/** Take items out of the request. Picking them again copies them fresh from Flow PT. */
	remove(kind: ItemKind, ids: string[]): void {
		if (kind === 'shot') this.setItems('shot', removeItems(this.state.shots, ids));
		else this.setItems('asset', removeItems(this.state.assets, ids));
	}

	/** Copy the picked items again from Flow PT with the mapping shown. Edits to them are lost. Breakdown rows stay as typed. */
	async refreeze(): Promise<void> {
		const client = liveContext().client;
		const fromFpt = <T extends { fpt?: { id: number }; source?: string }>(items: readonly T[]) => items.flatMap((i) => (i.fpt && i.source !== 'breakdown' ? [i.fpt.id] : []));
		const [shotRows, assetRows] = await Promise.all([
			rowsByIds(client, 'Shot', fromFpt(this.state.shots), this.fieldsFor('shot')),
			rowsByIds(client, 'Asset', fromFpt(this.state.assets), this.fieldsFor('asset'))
		]);
		this.state = {
			...this.state,
			shots: refrozen(this.state.shots, shotRows, this.freezer('shot')),
			assets: refrozen(this.state.assets, assetRows, this.freezer('asset'))
		};
		this.stale = false;
		this.save();
	}

	/** Rows from a breakdown, as `breakdown.ts` planned them: replaced in place, new ones after. */
	addBreakdown(kind: ItemKind, plan: BreakdownPlan<RequestShot> | BreakdownPlan<RequestAsset>): void {
		if (this.readOnly) return;
		const next = applyBreakdown({ shots: this.state.shots, assets: this.state.assets }, plan, kind);
		this.state = { ...this.state, shots: next.shots, assets: next.assets };
		this.save();
	}

	/** A new id for a breakdown row. Never `shot-<n>`: that is a Flow PT row's. */
	breakdownId(kind: ItemKind): string {
		const seed = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
		return `${kind}-bd-${seed}`;
	}

	/** Each breakdown row of a kind with no Flow PT row, against the project's rows with the same code. */
	async findMatches(kind: ItemKind): Promise<Match[]> {
		const project = this.state.project;
		if (!project) return [];
		const items = kind === 'shot' ? this.state.shots : this.state.assets;
		const codes = codesToFind(items);
		if (codes.length === 0) return [];
		const rows = await rowsByCodes(liveContext().client, kind === 'shot' ? 'Shot' : 'Asset', project.id, codes);
		const candidates = rows.flatMap((r) => (typeof r.attributes?.code === 'string' ? [{ id: r.id, code: r.attributes.code }] : []));
		return matchRows(kind, items, candidates);
	}

	/**
	 * Give breakdown rows their Flow PT row. A draft saves them as any edit. An issued request takes
	 * them through the one change its freeze allows; vendors see nothing new.
	 */
	async link(kind: ItemKind, links: ItemLink[]): Promise<void> {
		if (links.length === 0 || !this.state.project) return;
		if (!this.readOnly) {
			if (kind === 'shot') this.setItems('shot', withLinks(this.state.shots, links));
			else this.setItems('asset', withLinks(this.state.assets, links));
			return;
		}
		const { request } = await api.linkItems(this.state.project.id, this.state.id, links);
		this.state = { ...this.state, shots: request.shots, assets: request.assets };
	}

	tiers(kind: ItemKind): readonly string[] {
		const field = this.mapping?.[kind].difficulty;
		return tiersFor(field ? this.schemaOf(kind)[field] : undefined);
	}

	/** Leave this draft as stored and start another: the tab's cushion is cleared. */
	async discard(): Promise<void> {
		await cushion.clear();
	}
}
