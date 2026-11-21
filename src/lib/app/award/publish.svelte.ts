/**
 * The publish page's state: the comparison and the chosen scenario, the site's setup report, the
 * choices made on the page, the plan the preview shows, the run and its record. Logic lives in
 * `$lib/pure` (award-gate, fpt-award, award-view) and `$lib/io` (fpt-setup, fpt-award); this holds
 * the values and calls them, as production, from this browser.
 */

import type { EntityRef } from 'sg-widgets-core';
import { compareApi, type Comparison, type StoredScenario } from '$lib/compare-api';
import { prepareAward, publishAward, type Prepared, type Published } from '$lib/io/fpt-award';
import { ensureFields, readSetup, type EnsureResult, type SetupRead } from '$lib/io/fpt-setup';
import { liveContext, liveState, whoAmI } from '$lib/live';
import { loadMapping } from '$lib/app/mapping-store';
import { loadShape } from '$lib/io/reads';
import { cleanMapping, createFieldsOf, detectMapping } from '$lib/pure/field-map';
import type { CreateFields, MissingOptions } from '$lib/pure/fpt-award';
import { gate, type Gate } from '$lib/pure/award-gate';
import type { Publication } from '$lib/pure/award-record';
import { today } from '$lib/app/today';
import { siteApi } from './run';

export type Phase = 'idle' | 'publishing' | 'recording' | 'done' | 'failed';

export class PublishState {
	readonly projectId: number;
	readonly requestId: string;

	data = $state<Comparison | null>(null);
	scenario = $state<StoredScenario | null>(null);
	setup = $state<SetupRead | null>(null);
	setupError = $state<string | null>(null);
	ensured = $state<EnsureResult | null>(null);
	creating = $state(false);

	allLines = $state(false);
	/** Choices made here, per vendor id: a Group id or null for none. */
	groups = $state<Record<string, number | null>>({});
	/** The Group picked here, for its name. */
	picked = $state<Record<string, EntityRef>>({});
	accepted = $state(false);
	/** What to do with awarded rows that have no Flow PT row, per kind; the Sequence switch off. */
	missing = $state<MissingOptions>({});
	/** Where a created Shot's or Asset's values go: the project's field mapping in this browser. */
	itemFields = $state<CreateFields | null>(null);

	prepared = $state<Prepared | null>(null);
	previewing = $state(false);
	previewError = $state<string | null>(null);

	phase = $state<Phase>('idle');
	stepNow = $state<string | null>(null);
	published = $state<Published | null>(null);
	recordError = $state<string | null>(null);
	publication = $state<Publication | null>(null);

	constructor(projectId: number, requestId: string) {
		this.projectId = projectId;
		this.requestId = requestId;
	}

	readonly gate = $derived.by<Gate | null>(() => {
		if (!this.data) return null;
		return gate({
			projectId: this.projectId,
			report: this.setup?.report ?? null,
			request: this.data.request,
			bids: this.data.bids,
			scenario: this.scenario,
			allLines: this.allLines,
			groups: this.groups,
			exposureAccepted: this.accepted,
			missing: this.missing
		});
	});

	/** The comparison, showing the versions the chosen scenario names. */
	async load(): Promise<void> {
		const first = await compareApi.load(this.projectId, this.requestId);
		const chosen = first.scenarios.find((s) => s.chosen) ?? null;
		const asked = chosen ? [...new Set(chosen.picks.flatMap((p) => p.shares.map((s) => s.bidId)))] : [];
		this.data = asked.length ? await compareApi.load(this.projectId, this.requestId, asked) : first;
		this.scenario = this.data.scenarios.find((s) => s.chosen) ?? null;
		this.publication = this.data.publication;
		if (this.publication) {
			this.allLines = this.publication.options.allLines;
			this.groups = { ...this.publication.options.groups };
			this.missing = { ...(this.publication.options.missing ?? {}) };
		}
	}

	async readSite(): Promise<void> {
		this.setupError = null;
		try {
			const me = await whoAmI().catch(() => null);
			this.setup = await readSetup(siteApi(), this.projectId, { me: me?.id });
			const shape = await loadShape(liveContext());
			const saved = loadMapping(liveState().siteUrl, this.projectId);
			const mapping = {
				shot: saved ? cleanMapping('shot', saved.shot, shape.shot, shape.site) : detectMapping('shot', shape.shot, shape.site),
				asset: saved ? cleanMapping('asset', saved.asset, shape.asset, shape.site) : detectMapping('asset', shape.asset, shape.site)
			};
			this.itemFields = createFieldsOf(mapping, { shot: shape.shot, asset: shape.asset });
		} catch (e) {
			this.setupError = e instanceof Error ? e.message : String(e);
		}
	}

	async createFields(): Promise<void> {
		if (!this.setup) return;
		this.creating = true;
		try {
			this.ensured = await ensureFields(siteApi(), this.setup);
			await this.readSite();
		} catch (e) {
			this.setupError = e instanceof Error ? e.message : String(e);
		} finally {
			this.creating = false;
		}
	}

	/** The choice for the awarded rows of a kind with no Flow PT row. */
	setMissing(kind: 'shot' | 'asset', choice: 'create' | 'without'): void {
		this.missing = { ...this.missing, [kind]: choice };
	}

	/** Also create the Sequences the new Shots name that the project lacks. */
	setSequences(on: boolean): void {
		this.missing = { ...this.missing, sequences: on };
	}

	setGroup(vendorId: string, group: EntityRef | null | 'none'): void {
		if (group === 'none') {
			this.groups = { ...this.groups, [vendorId]: null };
			return;
		}
		if (group === null) {
			const { [vendorId]: _, ...rest } = this.groups;
			this.groups = rest;
			return;
		}
		this.groups = { ...this.groups, [vendorId]: group.id };
		this.picked = { ...this.picked, [vendorId]: group };
	}

	private input() {
		const g = this.gate!;
		const data = this.data!;
		return {
			request: data.request,
			bids: g.bids,
			scenario: this.scenario!,
			site: g.site!,
			previous: this.publication?.written ?? null,
			createFields: this.itemFields ?? undefined,
			options: {
				missing: this.missing,
				date: today(),
				requestCode: data.code,
				allLines: this.allLines,
				groups: g.groups,
				appLinks: Object.fromEntries(g.bids.map((b) => [b.id, `${location.origin}/requests/${data.request.id}/compare`]))
			}
		};
	}

	/** Plan against what the site holds now. Only once nothing blocks. */
	async preview(): Promise<void> {
		const g = this.gate;
		if (!g || g.blockers.length > 0 || !g.site || !this.scenario || !this.itemFields) {
			this.prepared = null;
			return;
		}
		this.previewing = true;
		this.previewError = null;
		try {
			this.prepared = await prepareAward(siteApi(), this.input());
		} catch (e) {
			this.prepared = null;
			this.previewError = e instanceof Error ? e.message : String(e);
		} finally {
			this.previewing = false;
		}
	}

	/** Write to Flow PT, read it back, then record it. A stop part way is recorded as it is. */
	async publish(): Promise<void> {
		if (!this.gate?.ready || !this.scenario) return;
		this.phase = 'publishing';
		this.recordError = null;
		try {
			this.published = await publishAward(siteApi(), this.input(), (label) => (this.stepNow = label));
		} catch (e) {
			// Nothing the run wrote is known: it stopped before a step answered, or while reading.
			this.phase = 'failed';
			this.recordError = e instanceof Error ? e.message : String(e);
			return;
		}
		this.stepNow = null;
		await this.record();
	}

	/** Tell the app what Flow PT holds. Safe to send again: the record is replaced. */
	async record(): Promise<void> {
		const run = this.published;
		if (!run || !this.scenario || !this.gate?.site) return;
		this.phase = 'recording';
		const me = await whoAmI().catch(() => null);
		const exposure = this.gate.exposure && this.gate.exposure.state !== 'safe' ? { state: this.gate.exposure.state, lines: [...this.gate.exposure.lines] } : null;
		const partial = run.error !== null || run.problems.length > 0;
		try {
			const { publication } = await compareApi.recordAward(this.projectId, {
				requestId: this.requestId,
				scenarioId: this.scenario.id,
				state: partial ? 'partial' : 'published',
				site: this.gate.site,
				written: run.written,
				options: { allLines: this.allLines, groups: this.gate.groups, missing: this.missing },
				problems: [...run.problems].slice(0, 1000),
				error: run.error ? run.error.slice(0, 2000) : null,
				exposure,
				byName: typeof me?.attributes?.name === 'string' ? me.attributes.name : null
			});
			this.publication = publication;
			this.phase = partial ? 'failed' : 'done';
		} catch (e) {
			this.recordError = e instanceof Error ? e.message : String(e);
			this.phase = 'failed';
		}
	}
}
