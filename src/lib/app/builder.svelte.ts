/**
 * The request builder's page state: the draft, the project's schema and Sequences, the mapping.
 * It holds no rule of its own: each change goes through a pure module, then the draft goes to the
 * storage seam (`$lib/drafts`), debounced, with the tab's cushion kept on every change. One
 * instance per page load. An issued request opens read only.
 */

import type { EntityRow, FieldSchema } from 'sg-widgets-core';
import { liveContext, liveState, prepareLive } from '$lib/live';
import { api, type RequestStatus } from '$lib/api';
import { setCurrentProject, currentProject } from '$lib/current-project';
import { cushion, drafts } from '$lib/drafts';
import { isLocalId, localId, savable } from '$lib/pure/persist';
import { loadMapping, storeMapping } from '$lib/app/mapping-store';
import { loadSequences, loadShape, rowsByIds, type ProjectShape } from '$lib/io/reads';
import { cleanMapping, detectMapping, readFields, type ItemKind, type Mapping } from '$lib/pure/field-map';
import { freezeAsset, freezeShot, sequenceIndex, type SequenceIndex } from '$lib/pure/freeze';
import { emptyHeaderForm, type HeaderForm, type ProjectPick } from '$lib/pure/header';
import { addPicked, mergePicked } from '$lib/pure/pick';
import { buildRequest, editItem, restoreState, tiersFor, type BuilderState } from '$lib/pure/request';
import type { RequestAsset, RequestShot } from '$lib/pure/model';

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
		const ready = savable(this.state);
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
				this.saving = { kind: 'error', message: message(error) };
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
		try {
			const context = liveContext();
			const shape = await loadShape(context);
			const rows = await loadSequences(context.client, project.id, shape.site.sequenceEpisodeField);
			const saved = loadMapping(liveState().siteUrl, project.id);
			this.mapping = {
				shot: saved ? cleanMapping('shot', saved.shot, shape.shot, shape.site) : detectMapping('shot', shape.shot, shape.site),
				asset: saved ? cleanMapping('asset', saved.asset, shape.asset, shape.site) : detectMapping('asset', shape.asset, shape.site)
			};
			this.data = { state: 'ready', value: { shape, sequenceRows: rows, sequences: sequenceIndex(rows, shape.site.sequenceEpisodeField) } };
		} catch (error) {
			this.data = { state: 'error', message: message(error) };
		}
	}

	/** One project per request: a new one starts the picks over. */
	async setProject(project: ProjectPick | null): Promise<void> {
		if (this.readOnly || project?.id === this.state.project?.id) return;
		setCurrentProject(liveState().siteUrl, project);
		this.state = { ...this.state, project, shots: [], assets: [] };
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

	setMapping(kind: ItemKind, slot: string, field: string | null): void {
		if (!this.mapping || !this.state.project) return;
		this.mapping = { ...this.mapping, [kind]: { ...this.mapping[kind], [slot]: field } };
		storeMapping(liveState().siteUrl, this.state.project.id, this.mapping);
		if (this.state.shots.length + this.state.assets.length > 0) this.stale = true;
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

	/** Copy the picked items again from Flow PT with the mapping shown. Edits to them are lost. */
	async refreeze(): Promise<void> {
		const client = liveContext().client;
		const shotIds = this.state.shots.flatMap((s) => (s.fpt ? [s.fpt.id] : []));
		const assetIds = this.state.assets.flatMap((a) => (a.fpt ? [a.fpt.id] : []));
		const [shotRows, assetRows] = await Promise.all([
			rowsByIds(client, 'Shot', shotIds, this.fieldsFor('shot')),
			rowsByIds(client, 'Asset', assetIds, this.fieldsFor('asset'))
		]);
		this.state = {
			...this.state,
			shots: mergePicked([], shotIds, shotRows, this.freezer('shot')).items,
			assets: mergePicked([], assetIds, assetRows, this.freezer('asset')).items
		};
		this.stale = false;
		this.save();
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
