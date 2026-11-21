/**
 * The send flow's page state: a draft request made from bids, its common header, its vendors, and
 * the issue. It holds no rule of its own: what is ready is `$lib/pure/readiness`, what the draft
 * holds is the server's composition of its bids (`request-bids`), and every change goes to the
 * server at once (bids, vendors) or debounced (the header), through `$lib/drafts` and `$lib/api`.
 *
 * Made from the Bids page (`?project=&bids=`), the draft is stored at once with a code made from the
 * project; opened again (`?id=`), it reads as stored. An issued request goes to its page.
 */

import { api, bidsApi, type BidOverview, type Invited, type LoadedRequest } from '$lib/api';
import { workingProject } from '$lib/current-project';
import { drafts } from '$lib/drafts';
import { prepareLive } from '$lib/live';
import { emptyHeaderForm, headerForm, suggestCode, toHeader, type HeaderForm, type ProjectPick } from '$lib/pure/header';
import type { BidRequest, Id } from '$lib/pure/model';
import { resolvePackages } from '$lib/pure/packages';
import { savable } from '$lib/pure/persist';
import { readiness, type OtherRequest, type Readiness } from '$lib/pure/readiness';
import type { BuilderState } from '$lib/pure/request';
import { today } from '$lib/app/today';

export type Step = 'bids' | 'details' | 'vendors' | 'review';
export const STEPS: readonly { readonly step: Step; readonly label: string }[] = [
	{ step: 'bids', label: 'Bids' },
	{ step: 'details', label: 'Details' },
	{ step: 'vendors', label: 'Vendors' },
	{ step: 'review', label: 'Review' }
];

export type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: Date } | { kind: 'error'; message: string };

const SAVE_DELAY_MS = 800;

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class SendFlow {
	project = $state.raw<ProjectPick | null>(null);
	form = $state<HeaderForm>(emptyHeaderForm());
	loaded = $state.raw<LoadedRequest | null>(null);
	/** The project's bids, to add one to the request. */
	projectBids = $state.raw<BidOverview[]>([]);
	others = $state.raw<OtherRequest[]>([]);
	saving = $state<SaveState>({ kind: 'idle' });
	problem = $state<string | null>(null);
	/** A change to the bids or the vendors on its way, or why it failed. */
	busy = $state(false);
	failure = $state<string | null>(null);
	/** Issued: the request and each vendor's link, shown once. */
	issued = $state.raw<{ request: BidRequest; links: Invited[] } | null>(null);

	readonly ready: Promise<void>;
	/** Called once the draft is stored, so the page can put its id in the URL. */
	onStored: ((id: string) => void) | null = null;

	private timer: ReturnType<typeof setTimeout> | null = null;
	private inFlight: Promise<void> | null = null;
	private again = false;

	constructor(input: { id: string | null; bids: readonly Id[] }) {
		this.ready = this.start(input);
	}

	get id(): string | null {
		return this.loaded?.request.id ?? null;
	}

	private async start(input: { id: string | null; bids: readonly Id[] }): Promise<void> {
		const live = await prepareLive();
		this.problem = live.problem;
		if (live.problem) return;
		const project = workingProject(live.siteUrl, new URL(location.href));
		if (!project) throw new Error('Open the request from the Bids or the Requests page.');
		this.project = project;
		void this.loadProjectBids();
		if (input.id) {
			await this.refresh(input.id);
			if (this.loaded) this.form = headerForm(this.loaded.request.header);
			return;
		}
		if (input.bids.length === 0) throw new Error('Tick the bids to send on the Bids page first.');
		const rows = await api.list(project.id).catch(() => []);
		this.others = rows.map((r) => ({ id: r.id, code: r.code, round: r.round }));
		this.form = { ...emptyHeaderForm(), code: suggestCode(project.name, this.others.map((o) => o.code)) };
		const ready = savable(this.builderState([{ id: 'x', code: 'x', omitted: false, assetIds: [] }]), this.form.code);
		if (!ready.ok) throw new Error(ready.reason);
		const stored = await drafts.save(project.id, { id: null, code: ready.code, header: ready.header, bids: input.bids });
		await this.refresh(stored.id);
		this.onStored?.(stored.id);
		this.saving = { kind: 'saved', at: new Date() };
	}

	private async loadProjectBids(): Promise<void> {
		if (!this.project) return;
		try {
			this.projectBids = (await bidsApi.list(this.project.id)).bids;
		} catch {
			// Without the list, a bid is added from the Bids page.
		}
	}

	private async refresh(id = this.id): Promise<void> {
		if (!id || !this.project) return;
		this.loaded = await drafts.load(id, this.project.id);
		if (this.loaded.status !== 'draft') return;
		if (this.others.length === 0) {
			const rows = await api.list(this.project.id).catch(() => []);
			this.others = rows.map((r) => ({ id: r.id, code: r.code, round: r.round }));
		}
	}

	private builderState(shots = this.loaded?.request.shots ?? []): BuilderState {
		return { id: this.id ?? 'local', project: this.project, form: this.form, shots, assets: this.loaded?.request.assets ?? [] };
	}

	/** The request's bids, in order, with what each holds. */
	get bids(): { id: Id; package: string; name: string; shots: number; assets: number; frames: number }[] {
		const request = this.loaded?.request;
		if (!request) return [];
		const resolved = resolvePackages(request);
		const frames = new Map(request.shots.map((s) => [s.id, s.frames ?? 0]));
		return (request.packages ?? []).flatMap((p) => {
			if (!p.bid) return [];
			const live = resolved.live.get(p.id) ?? [];
			return [
				{
					id: p.bid,
					package: p.id,
					name: p.name,
					shots: live.filter((t) => t.kind === 'shot').length,
					assets: live.filter((t) => t.kind === 'asset').length,
					frames: live.reduce((n, t) => n + (t.kind === 'shot' ? (frames.get(t.id) ?? 0) : 0), 0)
				}
			];
		});
	}

	/** How far the draft is from going out. */
	get readiness(): Readiness {
		const packages = this.loaded?.request.packages ?? [];
		const vendors = (this.loaded?.invitations ?? []).filter((i) => i.state.kind !== 'revoked' && i.state.kind !== 'expired');
		return readiness({
			state: this.builderState(),
			today: today(),
			others: this.others,
			send: {
				bids: this.bids.map((b) => b.name),
				overlaps: this.loaded?.overlaps ?? [],
				vendors: vendors.map((v) => ({ name: v.vendor.name, bids: v.vendor.packages ? v.vendor.packages.filter((k) => packages.some((p) => p.id === k)).length : packages.length }))
			}
		});
	}

	get suggestedCode(): string {
		return this.project ? suggestCode(this.project.name, this.others.filter((o) => o.id !== this.id).map((o) => o.code)) : '';
	}

	setForm(form: HeaderForm): void {
		this.form = form;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
	}

	/** Store the header now. One save at a time; a change during a save saves again after it. */
	async flush(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		if (this.inFlight) {
			this.again = true;
			return this.inFlight;
		}
		const id = this.id;
		if (!id || !this.project || this.loaded?.status !== 'draft') return;
		const ready = savable(this.builderState(), this.suggestedCode);
		if (!ready.ok) return;
		this.saving = { kind: 'saving' };
		this.inFlight = drafts
			.save(this.project.id, { id, code: ready.code, header: ready.header })
			.then((request) => {
				if (this.loaded) this.loaded = { ...this.loaded, request: { ...this.loaded.request, header: request.header } };
				this.saving = { kind: 'saved', at: new Date() };
			})
			.catch((error) => {
				const clash = (error as { status?: number }).status === 409;
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

	private async change(work: () => Promise<unknown>): Promise<void> {
		this.busy = true;
		this.failure = null;
		try {
			await work();
			await this.refresh();
		} catch (error) {
			this.failure = message(error);
		} finally {
			this.busy = false;
		}
	}

	setBids(ids: readonly Id[]): Promise<void> {
		return this.change(() => api.requestBids(this.project!.id, this.id!, [...ids]));
	}

	addBid(id: Id): Promise<void> {
		return this.setBids([...this.bids.map((b) => b.id), id]);
	}

	removeBid(id: Id): Promise<void> {
		return this.setBids(this.bids.map((b) => b.id).filter((b) => b !== id));
	}

	moveBid(id: Id, by: -1 | 1): Promise<void> {
		const ids = this.bids.map((b) => b.id);
		const at = ids.indexOf(id);
		const to = at + by;
		if (at < 0 || to < 0 || to >= ids.length) return Promise.resolve();
		[ids[at], ids[to]] = [ids[to], ids[at]];
		return this.setBids(ids);
	}

	vendorAdded(): Promise<void> {
		return this.change(async () => undefined);
	}

	removeVendor(invitationId: string): Promise<void> {
		return this.change(() => api.uninvite(this.project!.id, invitationId));
	}

	setVendorBids(invitationId: string, packages: string[] | null): Promise<void> {
		return this.change(() => api.invitePackages(this.project!.id, invitationId, packages));
	}

	/** Issue: the header saved first, then the bids copied and each vendor's link made, answered once. */
	async issue(): Promise<void> {
		await this.flush();
		if (this.inFlight) await this.inFlight;
		if (!this.id || !this.project) throw new Error('The draft is not saved yet.');
		this.issued = await api.issue(this.project.id, this.id);
	}
}
