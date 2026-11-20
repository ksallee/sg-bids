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
	bidKey,
	chunk,
	lineKey,
	planAward,
	planUndo,
	toBatchRequest,
	undoRequest,
	verify,
	type AwardInput,
	type AwardPlan,
	type BatchRequest,
	type Existing,
	type FptSite,
	type ReadBack,
	type ReadRow,
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
	const bidKeys = bids.map((b) => bidKey(request.id, b.vendorId, b.round));
	const lineKeys = bids.flatMap((b) => b.lines.map((l) => lineKey(bidKey(request.id, b.vendorId, b.round), l.target)));
	const bidRows = await byValues(api, site.bidType, site.projectId, BID.key, bidKeys, [BID.key]);
	const lineRows = await byValues(api, site.lineType, site.projectId, LINE.key, lineKeys, [LINE.key]);
	return {
		bids: bidRows.map((r) => ({ id: r.id, key: keyOf(r, BID.key) })),
		lines: lineRows.map((r) => ({ id: r.id, key: keyOf(r, LINE.key) })),
		groups: await readGroups(api, site, itemRefs(request))
	};
}

export interface Applied {
	readonly written: Written;
	/** Each Bid's id by key, new and updated. */
	readonly bidIds: ReadonlyMap<string, number>;
	/** Why the run stopped, when it did. What was written before it is in `written`. */
	readonly error: string | null;
}

/** Send the plan's steps in order, 200 requests a batch. Stops at the first refusal. */
export async function applyPlan(api: FptApi, plan: AwardPlan, site: FptSite): Promise<Applied> {
	const bids: { key: string; id: number; created: boolean }[] = [];
	const lines: { key: string; id: number; created: boolean }[] = [];
	const groups: { itemType: ItemType; id: number; field: string; groups: number[] }[] = [];
	const bidIds = new Map<string, number>();
	const done = (error: string | null): Applied => ({ written: { bids, lines, groups, attachments: [] }, bidIds, error });
	for (const step of plan.steps) {
		if (step.mode === 'single') {
			for (const write of step.writes) {
				try {
					const request = toBatchRequest(write, site, bidIds);
					if (request.request_type !== 'update') throw new Error(`${step.label}: only an update goes one by one.`);
					await api.client.update(request.entity, request.record_id, request.data);
				} catch (e) {
					return done(`${step.label}: ${(e as Error).message}`);
				}
			}
			continue;
		}
		for (const part of chunk(step.writes)) {
			let requests: BatchRequest[];
			try {
				requests = part.map((w) => toBatchRequest(w, site, bidIds));
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
					groups.push({ itemType: write.itemType, id: write.id, field: write.field, groups: [...write.groups] });
					return;
				}
				if (write.kind === 'link') return;
				const id = result.request_type === 'delete' ? result.id : result.data.id;
				const row = { key: write.key, id, created: write.kind === 'create' };
				if (write.entity === 'bid') {
					bids.push(row);
					bidIds.set(write.key, id);
				} else lines.push(row);
			});
		}
	}
	return done(null);
}

function asRead(row: EntityRow): ReadRow {
	return { id: row.id, attributes: row.attributes, relationships: row.relationships as ReadRow['relationships'] };
}

/** Every Bid and Bid Line of the plan read back by key, with the Groups on its items. */
export async function readBack(api: FptApi, plan: AwardPlan, site: FptSite): Promise<ReadBack> {
	const keys = { bid: [] as string[], line: [] as string[] };
	for (const step of plan.steps) for (const w of step.writes) if (w.kind === 'create' || w.kind === 'update') keys[w.entity].push(w.key);
	const bidRows = await byValues(api, site.bidType, site.projectId, BID.key, keys.bid, [...BID_FIELDS.map((f) => f.name), 'project']);
	const lineRows = await byValues(api, site.lineType, site.projectId, LINE.key, keys.line, [...LINE_FIELDS.map((f) => f.name), 'project']);
	return {
		bids: new Map(bidRows.map((r) => [keyOf(r, BID.key), asRead(r)])),
		lines: new Map(lineRows.map((r) => [keyOf(r, LINE.key), asRead(r)])),
		groups: await readGroups(
			api,
			site,
			plan.preview.groups.map((g) => g.ref)
		)
	};
}

export interface Published {
	readonly plan: AwardPlan;
	readonly written: Written;
	readonly back: ReadBack;
	/** Differences between the plan and the read-back. Empty when every write landed as sent. */
	readonly problems: readonly string[];
	readonly error: string | null;
}

/** Plan against what the site holds now, apply, read back and check. */
export async function publishAward(api: FptApi, input: Omit<AwardInput, 'existing'>): Promise<Published> {
	const existing = await readExisting(api, input.site, input.request, input.bids);
	const plan = planAward({ ...input, existing });
	const applied = await applyPlan(api, plan, input.site);
	const back = await readBack(api, plan, input.site);
	const created = new Set(applied.written.bids.filter((b) => b.created).map((b) => b.key));
	const attachments = [...back.bids].filter(([key]) => created.has(key)).flatMap(([, row]) => attachmentOf(row) ?? []);
	const written = { ...applied.written, attachments };
	const problems = applied.error ? [] : verify(plan, back, input.site, applied.bidIds);
	return { plan, written, back, problems, error: applied.error };
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
	const attachments: number[] = [];
	for (const id of written.attachments) {
		try {
			await api.client.read('Attachment', id, { fields: ['id'] });
			attachments.push(id);
		} catch {
			/* Gone already, or never readable: nothing to delete. */
		}
	}
	return {
		bids: written.bids.filter((b) => bids.has(b.id)),
		lines: written.lines.filter((l) => lines.has(l.id)),
		groups: written.groups,
		attachments
	};
}

export interface Undone {
	readonly undo: UndoPlan;
	readonly error: string | null;
}

/** Take back what a run wrote: its Groups unless still needed, then the rows it created. */
export async function undoAward(api: FptApi, site: FptSite, written: Written): Promise<Undone> {
	const live = await stillThere(api, site, written);
	const undo = planUndo(live, site, await stillNeeded(api, site, live));
	for (const part of chunk(undo.writes.map(undoRequest))) {
		try {
			await api.client.batch(part as Parameters<FptApi['client']['batch']>[0]);
		} catch (e) {
			return { undo, error: (e as Error).message };
		}
	}
	return { undo, error: null };
}

/** Each item's awarded total in the base currency, keyed `Shot:123`, from one `_summarize` (167). */
export async function readAwardedTotals(api: FptApi, site: FptSite, items: readonly EntityRef[], baseCurrency: string) {
	if (items.length === 0) return {};
	const query = awardedTotalsQuery(site, items, baseCurrency);
	const result = await api.client.summarize(site.lineType, { ...query, filters: query.filters as WireGroup });
	return awardedTotals(result.groups, baseCurrency);
}

