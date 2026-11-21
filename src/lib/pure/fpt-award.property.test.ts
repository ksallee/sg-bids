import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { apply, AWARD_SITE as SITE, awardInput as input, worldArb, writes } from './arbitraries';
import { BID } from './fpt-fields';
import { bidKey, packageBidKey, planAward, planUndo, verify, type ReadRow, type Write } from './fpt-award';
import type { EntityRef } from './model';
import { minorDigits } from './money';
import { bidTotals } from './totals';

/** A currency field's text back in minor units, for a currency of two digits or none. */
function minorOf(text: string, currency: string): bigint {
	const digits = minorDigits(currency);
	const [whole, fraction = ''] = text.replace('-', '').split('.');
	const minor = BigInt(whole + fraction.padEnd(digits, '0').slice(0, digits));
	return text.startsWith('-') ? -minor : minor;
}

/** The Bid key a line key sits under: item ids hold no slash. */
const bidOfLine = (key: string) => key.slice(0, key.lastIndexOf('/'));

const worlds = worldArb();

describe('the Flow PT award plan, for any request, answers and scenario', () => {
	it('puts amounts on a vendor’s Bids that sum to its bid total exactly, in the bid and the base currency', () => {
		fc.assert(
			fc.property(worlds, (world) => {
				const plan = planAward(input(world));
				const base = world.request.header.baseCurrency;
				for (const bid of world.bids) {
					const totals = bidTotals(bid, base);
					const mine = plan.preview.bids.filter((b) => b.bidId === bid.id);
					expect(mine.reduce((n, b) => n + b.total.minor, 0)).toBe(totals.grand.bid.minor);
					expect(mine.reduce((n, b) => n + b.totalBase.minor, 0)).toBe(totals.grand.base.minor);
					// What Flow PT is sent sums the same, where its two decimals hold the currency.
					const sent = writes(plan).filter((w): w is Extract<Write, { kind: 'create' }> => w.kind === 'create' && w.entity === 'bid' && mine.some((b) => b.key === w.key));
					if (minorDigits(bid.currency) <= 2) {
						expect(sent.reduce((n, w) => n + minorOf(w.data[BID.total] as string, bid.currency), 0n)).toBe(BigInt(totals.grand.bid.minor));
					}
					if (minorDigits(base) <= 2) {
						expect(sent.reduce((n, w) => n + minorOf(w.data[BID.totalBase] as string, base), 0n)).toBe(BigInt(totals.grand.base.minor));
					}
				}
			})
		);
	});

	it('puts Bid Line amounts on a row-priced Bid that sum to its amount, and none on a one-figure Bid’s lines', () => {
		fc.assert(
			fc.property(worlds, (world) => {
				const plan = planAward(input(world, true));
				const implicit = !world.request.packages?.length;
				const figures = new Set(
					world.bids.flatMap((b) => (b.packages ?? []).map((p) => (implicit ? bidKey(b.requestId, b.vendorId, b.round) : packageBidKey(bidKey(b.requestId, b.vendorId, b.round), p.package))))
				);
				for (const preview of plan.preview.bids.filter((b) => !b.general)) {
					const lines = plan.preview.lines.filter((l) => bidOfLine(l.key) === preview.key);
					if (figures.has(preview.key)) {
						for (const line of lines) expect(line.amount).toBeNull();
						continue;
					}
					const priced = lines.filter((l) => l.amount !== null);
					expect(priced.reduce((n, l) => n + l.amount!.minor, 0)).toBe(preview.total.minor);
				}
			})
		);
	});

	it('writes no Bid for a bid of the request a vendor declined', () => {
		fc.assert(
			fc.property(worlds, (world) => {
				const plan = planAward(input(world, true));
				const keys = new Set(plan.preview.bids.map((b) => b.key));
				for (const bid of world.bids) {
					for (const pkg of bid.declined ?? []) expect(keys.has(packageBidKey(bidKey(world.request.id, bid.vendorId, bid.round), pkg))).toBe(false);
				}
			})
		);
	});

	it('plans the same writes twice from the same input, every key once', () => {
		fc.assert(
			fc.property(worlds, fc.boolean(), (world, allLines) => {
				const plan = planAward(input(world, allLines));
				expect(planAward(input(world, allLines))).toEqual(plan);
				const keyed = writes(plan).flatMap((w) => (w.kind === 'create' || w.kind === 'update' ? [`${w.entity}|${w.key}`] : []));
				expect(new Set(keyed).size).toBe(keyed.length);
			})
		);
	});

	it('planned again once written, updates the same rows by key with the same values and creates nothing', () => {
		fc.assert(
			fc.property(worlds, fc.boolean(), (world, allLines) => {
				const first = planAward(input(world, allLines));
				const { existing, written } = apply(first);
				const again = planAward({ ...input(world, allLines), existing, previous: written });
				const kinds = new Set(writes(again).map((w) => w.kind));
				expect([...kinds].filter((k) => k !== 'update')).toEqual([]);
				const created = new Map(writes(first).flatMap((w) => (w.kind === 'create' ? [[`${w.entity}|${w.key}`, w.data] as const] : [])));
				const updated = writes(again).flatMap((w) => (w.kind === 'update' ? [[`${w.entity}|${w.key}`, w.data] as const] : []));
				expect(updated.map(([k]) => k).sort()).toEqual([...created.keys()].sort());
				for (const [key, data] of updated) {
					const { project: _, ...sent } = created.get(key)!;
					// A line's link to its new Bid is the Bid's id now, not a pending one.
					const want = Object.fromEntries(Object.entries(sent).map(([f, v]) => [f, v && typeof v === 'object' && 'pendingBid' in v ? { type: SITE.bidType, id: existing.bids.find((b) => b.key === v.pendingBid)!.id } : v]));
					expect(data).toEqual(want);
				}
			})
		);
	});

	it('undoes exactly what it created: every row, Attachment and Group, nothing else', () => {
		fc.assert(
			fc.property(worlds, fc.boolean(), (world, allLines) => {
				const { written } = apply(planAward(input(world, allLines)));
				const undo = planUndo(written, SITE);
				const deleted = undo.writes.flatMap((w) => (w.kind === 'delete' ? [`${w.entityType}:${w.id}`] : [])).sort();
				const made = [...written.lines.map((l) => `${SITE.lineType}:${l.id}`), ...written.attachments.map((a) => `Attachment:${a.id}`), ...written.bids.map((b) => `${SITE.bidType}:${b.id}`)].sort();
				expect(deleted).toEqual(made);
				const removed = undo.writes.flatMap((w) => (w.kind === 'removeGroups' ? w.groups.map((g) => `${w.itemType}:${w.id}:${g}`) : [])).sort();
				expect(removed).toEqual(written.groups.flatMap((g) => g.groups.map((group) => `${g.itemType}:${g.id}:${group}`)).sort());
				expect(undo.untouched).toEqual([]);
			})
		);
	});

	it('finds no difference when Flow PT reads back what it was sent', () => {
		fc.assert(
			fc.property(worlds, fc.boolean(), (world, allLines) => {
				const plan = planAward(input(world, allLines));
				const { existing, bidIds } = apply(plan);
				const row = (id: number, data: Readonly<Record<string, unknown>>): ReadRow => {
					const attributes: Record<string, unknown> = {};
					const relationships: Record<string, { data: unknown }> = {};
					for (const [field, value] of Object.entries(data)) {
						if (value && typeof value === 'object') relationships[field] = { data: 'pendingBid' in value ? { type: SITE.bidType, id: bidIds.get((value as { pendingBid: string }).pendingBid) } : (value as EntityRef) };
						else attributes[field] = value;
					}
					return { id, attributes, relationships };
				};
				const bids = new Map<string, ReadRow>();
				const lines = new Map<string, ReadRow>();
				for (const w of writes(plan)) {
					if (w.kind !== 'create') continue;
					const id = (w.entity === 'bid' ? existing.bids : existing.lines).find((r) => r.key === w.key)!.id;
					(w.entity === 'bid' ? bids : lines).set(w.key, row(id, w.data));
				}
				for (const w of writes(plan)) {
					const read = w.kind === 'link' ? bids.get(w.key)! : null;
					if (w.kind === 'link' && read) bids.set(w.key, { ...read, attributes: { ...read.attributes, [BID.appLink]: { url: w.url, type: 'Attachment', id: 1 } } });
				}
				expect(verify(plan, { bids, lines, groups: existing.groups }, SITE, bidIds)).toEqual([]);
			})
		);
	});
});
