/**
 * The award in Flow PT: read what is there, apply a plan in batches, read it back, undo it, and total
 * each item's awarded lines. Every decision is in `src/lib/pure/fpt-award.ts`. Facts from
 * `../sg-groundtruth/corpus`:
 *
 * - One `_batch` is all or nothing and answers in request order (recipe 002). A failed batch wrote
 *   nothing, so `Written` holds the batches that answered 200 and no more.
 * - A batch delete of a row already gone fails the whole batch (recipe 002), so the undo reads which
 *   rows still exist and deletes only those.
 * - A `url` value is refused inside `_batch` (measured here, see `fpt-award.ts`), so a `single` step
 *   goes one PUT at a time. Its writes are not atomic: a refusal stops the run where it is.
 * - A write is confirmed by reading the row back (recipe 009). `?fields` on a write is ignored, so
 *   the read-back is its own search (recipe 002).
 * - Array filters go in the hash form the client sends; `is` on an entity takes one hash, `in` a list
 *   (recipe 009).
 */
import type { EntityRow, WireGroup } from 'sg-widgets-core';
import { BID, BID_FIELDS, LINE, LINE_FIELDS } from '../pure/fpt-fields';
import {
	attachmentOf,
	awardedTotals,
	awardedTotalsQuery,
	bidRowKeys,
	chunk,

	mergeWritten,
	planAward,
	planUndo,
	toBatchRequest,
	toLookUp,
	undoRequest,
	verify,
	type AwardInput,
	type AwardPlan,
	type BatchRequest,
	type CreatedRow,
	type CreatedType,
	type Existing,
	type FptSite,
	type ReadBack,
	type ReadRow,
	type Removed,
	type UndoPlan,
	type Written
} from '../pure/fpt-award';
import type { ItemType } from '../pure/fpt-setup';
import type { BidRequest, EntityRef, VendorBid } from '../pure/model';
import type { FptApi } from './fpt-api';

type Condition = [string, string, unknown];

function and(...conditions: Condition[]): WireGroup {
	return { logical_operator: 'and', conditions: conditions as WireGroup['conditions'] };
}

async function searchAll(api: FptApi, type: string, filters: WireGroup, fields: string[]): Promise<EntityRow[]> {
	const rows: EntityRow[] = [];
	for (let page = 1; ; page++) {
		const result = await api.client.search(type, { filters, fields, page: { size: 500, number: page } });
		rows.push(...result.data);
		if (!result.hasMore) return rows;
	}
}

/** Rows whose text field is one of `values`, 200 values to a search. */
async function byValues(api: FptApi, type: string, projectId: number, field: string, values: string[], fields: string[]): Promise<EntityRow[]> {
	const rows: EntityRow[] = [];
	for (const part of chunk(values)) {
		rows.push(...(await searchAll(api, type, and(['project', 'is', { type: 'Project', id: projectId }], [field, 'in', part]), fields)));
	}
	return rows;
}

function ids(value: unknown): number[] {
	const list = Array.isArray(value) ? value : value ? [value] : [];
	return list.map((v) => (v as { id?: unknown }).id).filter((id): id is number => typeof id === 'number');
}

/** The Group ids on each item's vendor field, keyed `Shot:123`. */
async function readGroups(api: FptApi, site: FptSite, refs: readonly EntityRef[]): Promise<Record<string, number[]>> {
	const out: Record<string, number[]> = {};
	for (const type of ['Shot', 'Asset'] as ItemType[]) {
		const field = site.vendorField[type];
		const wanted = refs.filter((r) => r.type === type).map((r) => r.id);
		if (!field || wanted.length === 0) continue;
		for (const part of chunk(wanted)) {
			for (const row of await searchAll(api, type, and(['id', 'in', part]), [field])) out[`${type}:${row.id}`] = ids(row.relationships[field]?.data);
		}
	}
	return out;
}

function itemRefs(request: BidRequest): EntityRef[] {
	return [...request.shots.map((s) => s.fpt), ...request.assets.map((a) => a.fpt)].filter((r): r is EntityRef => r !== undefined);
}

function keyOf(row: EntityRow, field: string): string {
	return String(row.attributes[field] ?? '');
}

/** The Bids and Bid Lines already written for these bids, found by key, and each item's Groups. */
export async function readExisting(api: FptApi, site: FptSite, request: BidRequest, bids: readonly VendorBid[]): Promise<Existing> {
	const keys = bids.map((b) => bidRowKeys(request, b));
	const bidKeys = keys.flatMap((k) => k.bids);
	const lineKeys = keys.flatMap((k) => k.lines);
	const bidRows = await byValues(api, site.bidType, site.projectId, BID.key, bidKeys, [BID.key]);
	const lineRows = await byValues(api, site.lineType, site.projectId, LINE.key, lineKeys, [LINE.key]);
	return {
		bids: bidRows.map((r) => ({ id: r.id, key: keyOf(r, BID.key) })),
		lines: lineRows.map((r) => ({ id: r.id, key: keyOf(r, LINE.key) })),
		groups: await readGroups(api, site, itemRefs(request))
	};
}

/** The project's rows whose code is one of `codes`: text filters ignore case (field_types/text). */
async function withCodes(api: FptApi, type: string, projectId: number, codes: readonly string[]): Promise<{ id: number; code: string }[]> {
	if (codes.length === 0) return [];
	const rows = await byValues(api, type, projectId, 'code', [...codes], ['code']);
	return rows.map((r) => ({ id: r.id, code: keyOf(r, 'code') }));
}

const CHILDREN = ['Task', 'Version'] as const;
/** Links on the row itself that something else made, per type (entity_types/Shot, Asset, Sequence). */
const OWN_LINKS: Readonly<Record<CreatedType, readonly { field: string; word: string }[]>> = {
	Shot: [
		{ field: 'notes', word: 'Note' },
		{ field: 'sg_published_files', word: 'Published File' },
		{ field: 'assets', word: 'linked Asset' },
		{ field: 'shots', word: 'child Shot' },
		{ field: 'parent_shots', word: 'parent Shot' }
	],
	Asset: [
		{ field: 'notes', word: 'Note' },
		{ field: 'sg_published_files', word: 'Published File' },
		{ field: 'shots', word: 'linked Shot' },
		{ field: 'parents', word: 'parent Asset' },
		{ field: 'assets', word: 'child Asset' }
	],
	Sequence: [
		{ field: 'notes', word: 'Note' },
		{ field: 'sg_published_files', word: 'Published File' },
		{ field: 'assets', word: 'linked Asset' },
		{ field: 'shots', word: 'Shot' }
	]
};

function counted(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * The rows a publish created that have gained links since, keyed `Shot:123`, with why. Tasks and
 * Versions are read from their own side, where they link (entity_types/Shot); Notes, Published Files
 * and the hierarchy from the row. A Bid Line the app did not write counts. A Sequence counts a Shot
 * under it unless the undo deletes that Shot too. Deleting a linked row would hide its links (161).
 */
export async function foreignLinks(api: FptApi, site: FptSite, written: Written): Promise<Map<string, string>> {
	const items = written.items ?? [];
	const reasons = new Map<string, string[]>();
	const add = (key: string, why: string) => reasons.set(key, [...(reasons.get(key) ?? []), why]);
	if (items.length === 0) return new Map();
	const project = ['project', 'is', { type: 'Project', id: site.projectId }] as Condition;
	const refs = items.map((i) => ({ type: i.type, id: i.id }));
	for (const child of CHILDREN) {
		const counts = new Map<string, number>();
		for (const part of chunk(refs)) {
			for (const row of await searchAll(api, child, and(project, ['entity', 'in', part]), ['entity'])) {
				const e = row.relationships.entity?.data as { type?: string; id?: number } | null;
				if (e?.type && e.id) counts.set(`${e.type}:${e.id}`, (counts.get(`${e.type}:${e.id}`) ?? 0) + 1);
			}
		}
		for (const [key, n] of counts) add(key, `it has ${counted(n, child)}`);
	}
	const ours = new Set(written.lines.map((l) => l.id));
	const lineRefs = refs.filter((r) => r.type !== 'Sequence');
	for (const part of chunk(lineRefs)) {
		if (part.length === 0) continue;
		const lines = (await searchAll(api, site.lineType, and(project, [LINE.item, 'in', part]), [LINE.item])).filter((l) => !ours.has(l.id));
		const counts = new Map<string, number>();
		for (const l of lines) {
			const e = l.relationships[LINE.item]?.data as { type?: string; id?: number } | null;
			if (e?.type && e.id) counts.set(`${e.type}:${e.id}`, (counts.get(`${e.type}:${e.id}`) ?? 0) + 1);
		}
		for (const [key, n] of counts) add(key, `${counted(n, 'Bid Line')} the app did not write ${n === 1 ? 'points' : 'point'} at it`);
	}
	const created = new Set(items.map((i) => `${i.type}:${i.id}`));
	const seqShots = new Map<string, string[]>();
	for (const type of ['Shot', 'Asset', 'Sequence'] as const) {
		const ids = items.filter((i) => i.type === type).map((i) => i.id);
		if (ids.length === 0) continue;
		const fields = OWN_LINKS[type].map((l) => l.field);
		for (const part of chunk(ids)) {
			for (const row of await searchAll(api, type, and(['id', 'in', part]), fields)) {
				const key = `${type}:${row.id}`;
				for (const { field, word } of OWN_LINKS[type]) {
					const linked = (Array.isArray(row.relationships[field]?.data) ? (row.relationships[field].data as { type: string; id: number }[]) : []).map((r) => `${r.type}:${r.id}`);
					if (type === 'Sequence' && field === 'shots') {
						seqShots.set(key, linked);
						continue;
					}
					const others = linked.filter((l) => !created.has(l));
					if (others.length > 0) add(key, `it has ${counted(others.length, word)}`);
				}
			}
		}
	}
	// A Sequence keeps a Shot the undo leaves, or one it never made.
	for (const [key, shots] of seqShots) {
		const staying = shots.filter((s) => !created.has(s) || reasons.has(s));
		if (staying.length > 0) add(key, `it has ${counted(staying.length, 'Shot')} that ${staying.length === 1 ? 'stays' : 'stay'}`);
	}
	return new Map([...reasons].map(([key, why]) => [key, why.join(', ')]));
}

export interface Applied {
	readonly written: Written;
	/** What the run took back of an earlier run's writes. */
	readonly removed: Removed;
	/** Each Bid's id by key, new and updated. */
	readonly bidIds: ReadonlyMap<string, number>;
	/** Each Shot, Asset and Sequence the run created, by key. */
	readonly rowIds: ReadonlyMap<string, EntityRef>;
	/** Why the run stopped, when it did. What was written before it is in `written`. */
	readonly error: string | null;
	/** The labels of the steps that answered, in order. */
	readonly stepsDone: readonly string[];
}

/** Send the plan's steps in order, 200 requests a batch. Stops at the first refusal. */
export async function applyPlan(api: FptApi, plan: AwardPlan, site: FptSite, onStep?: (label: string) => void): Promise<Applied> {
	const bids: { key: string; id: number; created: boolean }[] = [];
	const lines: { key: string; id: number; created: boolean }[] = [];
	const groups: { itemType: ItemType; id: number; field: string; groups: number[] }[] = [];
	const removed = {
		bids: [] as number[],
		lines: [] as number[],
		attachments: [] as number[],
		groups: [] as { itemType: ItemType; id: number; field: string; groups: number[] }[],
		items: [...plan.released]
	};
	const bidIds = new Map<string, number>();
	const rowIds = new Map<string, EntityRef>();
	const items: CreatedRow[] = [];
	const stepsDone: string[] = [];
	const done = (error: string | null): Applied => ({ written: { bids, lines, groups, attachments: [], items }, removed, bidIds, rowIds, error, stepsDone });
	for (const step of plan.steps) {
		onStep?.(step.label);
		if (step.mode === 'single') {
			for (const write of step.writes) {
				try {
					const request = toBatchRequest(write, site, bidIds, rowIds);
					if (request.request_type !== 'update') throw new Error(`${step.label}: only an update goes one by one.`);
					await api.client.update(request.entity, request.record_id, request.data);
				} catch (e) {
					return done(`${step.label}: ${(e as Error).message}`);
				}
			}
			stepsDone.push(step.label);
			continue;
		}
		for (const part of chunk(step.writes)) {
			let requests: BatchRequest[];
			try {
				requests = part.map((w) => toBatchRequest(w, site, bidIds, rowIds));
			} catch (e) {
				return done((e as Error).message);
			}
			let results;
			try {
				results = await api.client.batch(requests as Parameters<FptApi['client']['batch']>[0]);
			} catch (e) {
				return done(`${step.label}: ${(e as Error).message}`);
			}
			part.forEach((write, i) => {
				const result = results[i];
				if (write.kind === 'addGroups') {
					const id = typeof write.id === 'number' ? write.id : rowIds.get(write.id.pendingRow)!.id;
					groups.push({ itemType: write.itemType, id, field: write.field, groups: [...write.groups] });
					return;
				}
				if (write.kind === 'link') return;
				if (write.kind === 'removeGroups') {
					removed.groups.push({ itemType: write.itemType, id: write.id, field: write.field, groups: [...write.groups] });
					return;
				}
				if (write.kind === 'delete') {
					(write.entity === 'bid' ? removed.bids : write.entity === 'line' ? removed.lines : write.entity === 'item' ? removed.items : removed.attachments).push(write.id);
					return;
				}
				if (write.kind === 'createItem') {
					const id = result.request_type === 'delete' ? result.id : result.data.id;
					items.push({ key: write.key, type: write.itemType, id });
					rowIds.set(write.key, { type: write.itemType, id });
					return;
				}
				const id = result.request_type === 'delete' ? result.id : result.data.id;
				const row = { key: write.key, id, created: write.kind === 'create' };
				if (write.entity === 'bid') {
					bids.push(row);
					bidIds.set(write.key, id);
				} else lines.push(row);
			});
		}
		stepsDone.push(step.label);
	}
	return done(null);
}

function asRead(row: EntityRow): ReadRow {
	return { id: row.id, attributes: row.attributes, relationships: row.relationships as ReadRow['relationships'] };
}

/** Every Bid and Bid Line of the plan read back by key, every row it created by id, with the Groups on its items. */
export async function readBack(api: FptApi, plan: AwardPlan, site: FptSite, rowIds: ReadonlyMap<string, EntityRef> = new Map()): Promise<ReadBack> {
	const keys = { bid: [] as string[], line: [] as string[] };
	const refs: EntityRef[] = plan.preview.groups.flatMap((g) => (g.ref ? [g.ref] : []));
	const made: { key: string; type: string; fields: string[] }[] = [];
	const gone: { key: string; type: string; id: number }[] = [];
	for (const step of plan.steps) {
		for (const w of step.writes) {
			if (w.kind === 'create' || w.kind === 'update') keys[w.entity].push(w.key);
			if (w.kind === 'delete' && (w.entity === 'bid' || w.entity === 'line')) keys[w.entity].push(w.key);
			if (w.kind === 'delete' && w.entity === 'item') gone.push({ key: w.key, type: w.itemType, id: w.id });
			if (w.kind === 'removeGroups') refs.push({ type: w.itemType, id: w.id });
			if (w.kind === 'addGroups' && typeof w.id !== 'number') {
				const ref = rowIds.get(w.id.pendingRow);
				if (ref) refs.push(ref);
			}
			if (w.kind === 'createItem') made.push({ key: w.key, type: w.itemType, fields: Object.keys(w.data) });
		}
	}
	const bidRows = await byValues(api, site.bidType, site.projectId, BID.key, keys.bid, [...BID_FIELDS.map((f) => f.name), 'project']);
	const lineRows = await byValues(api, site.lineType, site.projectId, LINE.key, keys.line, [...LINE_FIELDS.map((f) => f.name), 'project']);
	const items = new Map<string, ReadRow>();
	for (const type of ['Sequence', 'Shot', 'Asset']) {
		const wanted = made.filter((m) => m.type === type && rowIds.has(m.key));
		const deleted = gone.filter((g) => g.type === type);
		if (wanted.length + deleted.length === 0) continue;
		const fields = [...new Set(wanted.flatMap((m) => m.fields))];
		const byId = new Map([...wanted.map((m) => [rowIds.get(m.key)!.id, m.key] as const), ...deleted.map((g) => [g.id, g.key] as const)]);
		for (const part of chunk([...byId.keys()])) {
			for (const row of await searchAll(api, type, and(['id', 'in', part]), fields.length ? fields : ['code'])) items.set(byId.get(row.id)!, asRead(row));
		}
	}
	return {
		bids: new Map(bidRows.map((r) => [keyOf(r, BID.key), asRead(r)])),
		lines: new Map(lineRows.map((r) => [keyOf(r, LINE.key), asRead(r)])),
		groups: await readGroups(api, site, refs),
		items
	};
}

export interface Prepared {
	readonly plan: AwardPlan;
	/** The earlier runs' writes that still exist on the site. */
	readonly previous: Written | null;
}

/** Read what the site holds now and plan against it. The preview shows this plan. */
export async function prepareAward(api: FptApi, input: Omit<AwardInput, 'existing'>): Promise<Prepared> {
	const previous = input.previous ? await stillThere(api, input.site, input.previous) : null;
	const existing = await readExisting(api, input.site, input.request, input.bids);
	const needed = previous ? await stillNeeded(api, input.site, previous) : new Set<string>();
	// Rows to create: their codes, to catch a collision, and the Sequences they name.
	const look = toLookUp({ ...input, previous });
	const projectId = input.site.projectId;
	const codes = { Shot: await withCodes(api, 'Shot', projectId, look.Shot), Asset: await withCodes(api, 'Asset', projectId, look.Asset) };
	const sequences = await withCodes(api, 'Sequence', projectId, look.sequences);
	const itemLinks = previous ? await foreignLinks(api, input.site, previous) : new Map<string, string>();
	return { plan: planAward({ ...input, previous, existing: { ...existing, needed, codes, sequences, itemLinks } }), previous };
}

export interface Published {
	readonly plan: AwardPlan;
	/** This run's writes merged with the earlier runs': what the undo takes back. */
	readonly written: Written;
	readonly back: ReadBack;
	/** Differences between the plan and the read-back. Empty when every write landed as sent. */
	readonly problems: readonly string[];
	readonly error: string | null;
	readonly stepsDone: readonly string[];
}

/** Plan against what the site holds now, apply, read back and check. */
export async function publishAward(api: FptApi, input: Omit<AwardInput, 'existing'>, onStep?: (label: string) => void): Promise<Published> {
	const { plan, previous } = await prepareAward(api, input);
	if (plan.collisions.length > 0) {
		// Nothing is written: a second Shot with a code already there is a 201, never refused (entity_types/Shot).
		throw new Error(`Not published. ${plan.collisions.map((c) => (c.twice ? `Two rows have the code ${c.code}.` : `${c.code} is in Flow PT already as ${c.found.map((f) => `${f.type} ${f.id}`).join(' and ')}.`)).join(' ')} Match them, or change the codes in a new round.`);
	}
	const applied = await applyPlan(api, plan, input.site, onStep);
	onStep?.('Reading back');
	const back = await readBack(api, plan, input.site, applied.rowIds);
	const created = new Set(applied.written.bids.filter((b) => b.created).map((b) => b.key));
	const attachments = [...back.bids].filter(([key]) => created.has(key)).flatMap(([key, row]) => {
		const id = attachmentOf(row);
		return id === null ? [] : [{ key, id }];
	});
	const written = mergeWritten(previous, { ...applied.written, attachments }, applied.removed);
	const problems = applied.error ? [] : verify(plan, back, input.site, applied.bidIds, applied.rowIds);
	return { plan, written, back, problems, error: applied.error, stepsDone: applied.stepsDone };
}

/** `Shot:123:38` for each Group an awarded line outside this run still needs on its item. */
async function stillNeeded(api: FptApi, site: FptSite, written: Written): Promise<Set<string>> {
	const refs = written.groups.map((g) => ({ type: g.itemType, id: g.id }));
	if (refs.length === 0) return new Set();
	const ours = new Set(written.lines.map((l) => l.id));
	const lines = (
		await searchAll(api, site.lineType, and(['project', 'is', { type: 'Project', id: site.projectId }], [LINE.item, 'in', refs], [LINE.awarded, 'is', true]), [LINE.item, LINE.bid])
	).filter((l) => !ours.has(l.id));
	const bidIds = [...new Set(lines.flatMap((l) => ids(l.relationships[LINE.bid]?.data)))];
	const vendorOf = new Map<number, number[]>();
	for (const part of chunk(bidIds)) {
		for (const b of await searchAll(api, site.bidType, and(['id', 'in', part]), [BID.vendor])) vendorOf.set(b.id, ids(b.relationships[BID.vendor]?.data));
	}
	const out = new Set<string>();
	for (const l of lines) {
		const item = ids(l.relationships[LINE.item]?.data)[0];
		const type = (l.relationships[LINE.item]?.data as { type?: string } | null)?.type;
		for (const bid of ids(l.relationships[LINE.bid]?.data)) for (const g of vendorOf.get(bid) ?? []) out.add(`${type}:${item}:${g}`);
	}
	return out;
}

/** The rows of `written` that still exist, so a delete never names a row already gone. */
async function stillThere(api: FptApi, site: FptSite, written: Written): Promise<Written> {
	const live = async (type: string, list: readonly number[]) => {
		const found = new Set<number>();
		for (const part of chunk([...list])) for (const r of await searchAll(api, type, and(['id', 'in', part]), ['id'])) found.add(r.id);
		return found;
	};
	const bids = await live(site.bidType, written.bids.map((b) => b.id));
	const lines = await live(site.lineType, written.lines.map((l) => l.id));
	const attachments: { key: string; id: number }[] = [];
	for (const a of written.attachments) {
		try {
			await api.client.read('Attachment', a.id, { fields: ['id'] });
			attachments.push(a);
		} catch {
			/* Gone already, or never readable: nothing to delete. */
		}
	}
	const items: CreatedRow[] = [];
	for (const type of ['Shot', 'Asset', 'Sequence'] as const) {
		const mine = (written.items ?? []).filter((i) => i.type === type);
		if (mine.length === 0) continue;
		const found = await live(type, mine.map((i) => i.id));
		items.push(...mine.filter((i) => found.has(i.id)));
	}
	return {
		bids: written.bids.filter((b) => bids.has(b.id)),
		lines: written.lines.filter((l) => lines.has(l.id)),
		groups: written.groups,
		attachments,
		items
	};
}

export interface Undone {
	readonly undo: UndoPlan;
	readonly error: string | null;
	/**
	 * Read back after the undo: what the app wrote that is still on the site. Empty when the undo is
	 * complete. A Group kept because another award needs it is left out: it is no longer the app's.
	 */
	readonly remaining: Written;
}

/** Take back what a run wrote: its Groups unless still needed, then the rows it created. Read back after. */
export async function undoAward(api: FptApi, site: FptSite, written: Written): Promise<Undone> {
	const live = await stillThere(api, site, written);
	const undo = planUndo(live, site, await stillNeeded(api, site, live), await foreignLinks(api, site, live));
	let error: string | null = null;
	for (const part of chunk(undo.writes.map(undoRequest))) {
		try {
			await api.client.batch(part as Parameters<FptApi['client']['batch']>[0]);
		} catch (e) {
			error = (e as Error).message;
			break;
		}
	}
	const after = await stillThere(api, site, live);
	const kept = new Set(undo.kept.map((k) => `${k.itemType}:${k.id}:${k.group}`));
	const present = await readGroups(
		api,
		site,
		live.groups.map((g) => ({ type: g.itemType, id: g.id }))
	);
	const groups = live.groups
		.map((g) => ({ ...g, groups: g.groups.filter((group) => !kept.has(`${g.itemType}:${g.id}:${group}`) && (present[`${g.itemType}:${g.id}`] ?? []).includes(group)) }))
		.filter((g) => g.groups.length > 0);
	// Rows the run only updated are left in place by design; they are not the app's to delete. A
	// created row that gained links is left too, and named: it is no longer the app's alone.
	const left = new Set(undo.left.map((l) => l.id));
	const remaining: Written = {
		bids: after.bids.filter((b) => b.created),
		lines: after.lines.filter((l) => l.created),
		groups,
		attachments: after.attachments,
		items: (after.items ?? []).filter((i) => !left.has(i.id))
	};
	return { undo, error, remaining };
}

/** Each item's awarded total in the base currency, keyed `Shot:123`, from one `_summarize` (167). */
export async function readAwardedTotals(api: FptApi, site: FptSite, items: readonly EntityRef[], baseCurrency: string) {
	if (items.length === 0) return {};
	const query = awardedTotalsQuery(site, items, baseCurrency);
	const result = await api.client.summarize(site.lineType, { ...query, filters: query.filters as WireGroup });
	return awardedTotals(result.groups, baseCurrency);
}

