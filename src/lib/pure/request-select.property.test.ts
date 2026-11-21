import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deletionFactsArb } from './arbitraries';
import { deletionPlan, requestName } from './request-delete';
import { bulkDeletePlan, headerState, press, pressAll, prune, resultLine, splitDelete, type DeleteCheck, type Selection } from './request-select';

/** The rows shown, in order, and a selection among them and a few rows no longer shown. */
const worldArb = fc
	.uniqueArray(fc.integer({ min: 0, max: 60 }), { minLength: 1, maxLength: 20 })
	.chain((ns) => {
		const shown = ns.map((n) => `r${n}`);
		const pool = [...shown, 'gone1', 'gone2'];
		return fc.record({
			shown: fc.constant(shown),
			selection: fc.record({ selected: fc.subarray(pool).map((a) => new Set(a)), anchor: fc.option(fc.constantFrom(...pool), { nil: null }) }) as fc.Arbitrary<Selection>,
			id: fc.constantFrom(...shown),
			shift: fc.boolean()
		});
	});

const subset = (a: ReadonlySet<string>, b: Iterable<string>) => {
	const set = new Set(b);
	return [...a].every((x) => set.has(x));
};

describe('the selection, whatever the rows and the presses', () => {
	it('a press without Shift, twice, leaves the selection as it was', () => {
		fc.assert(
			fc.property(worldArb, ({ shown, selection, id }) => {
				const twice = press(press(selection, id, shown, false), id, shown, false);
				expect([...twice.selected].sort()).toEqual([...selection.selected].sort());
			})
		);
	});

	it('a press changes only rows shown between the anchor and the row, and they all take one state', () => {
		fc.assert(
			fc.property(worldArb, ({ shown, selection, id, shift }) => {
				const next = press(selection, id, shown, shift);
				const on = next.selected.has(id);
				expect(on).toBe(!selection.selected.has(id));
				const from = selection.anchor === null ? -1 : shown.indexOf(selection.anchor);
				const to = shown.indexOf(id);
				const range = shift && from >= 0 ? shown.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
				for (const row of [...shown, 'gone1', 'gone2']) {
					expect(next.selected.has(row)).toBe(range.includes(row) ? on : selection.selected.has(row));
				}
				expect(next.anchor).toBe(id);
			})
		);
	});

	it('the header box leaves every row shown ticked or none, and its state says which', () => {
		fc.assert(
			fc.property(worldArb, ({ shown, selection }) => {
				const pruned = prune(selection, shown);
				const next = pressAll(pruned, shown);
				const state = headerState(next, shown);
				expect(state === 'all' ? shown.every((r) => next.selected.has(r)) : next.selected.size === 0).toBe(true);
				expect(state === 'all').toBe(headerState(pruned, shown) !== 'all');
			})
		);
	});

	it('pruning keeps only rows shown, is idempotent, and keeps a selection already inside', () => {
		fc.assert(
			fc.property(worldArb, ({ shown, selection }) => {
				const once = prune(selection, shown);
				expect(subset(once.selected, shown)).toBe(true);
				expect(prune(once, shown)).toBe(once);
				expect([...once.selected].sort()).toEqual([...selection.selected].filter((r) => shown.includes(r)).sort());
				if (subset(selection.selected, shown) && (selection.anchor === null || shown.includes(selection.anchor))) expect(once).toBe(selection);
			})
		);
	});

	it('header state is all exactly when every row shown is ticked', () => {
		fc.assert(
			fc.property(worldArb, ({ shown, selection }) => {
				const ticked = shown.filter((r) => selection.selected.has(r)).length;
				expect(headerState(selection, shown)).toBe(ticked === 0 ? 'none' : ticked === shown.length ? 'all' : 'some');
			})
		);
	});
});

const checkArb: fc.Arbitrary<DeleteCheck> = fc.oneof(
	{ weight: 5, arbitrary: deletionFactsArb.map((facts) => ({ facts })) },
	{ weight: 1, arbitrary: fc.record({ id: fc.uuid(), name: fc.constantFrom('Gone', 'Lost'), reason: fc.constantFrom('The request is not there.', 'The server failed.') }) }
);

describe('splitting a selection for delete', () => {
	it('puts each request in one place, as its own delete would: a refusal skipped, a draft once, the rest typed', () => {
		fc.assert(
			fc.property(fc.array(checkArb, { maxLength: 12 }), (checks) => {
				const split = splitDelete(checks);
				expect(split.drafts.length + split.sent.length + split.skipped.length).toBe(checks.length);
				for (const f of split.drafts) expect(deletionPlan(f).kind).toBe('draft');
				for (const f of split.sent) expect(deletionPlan(f).kind).toBe('issued');
				const plan = bulkDeletePlan(split);
				expect(plan.typed).toBe(split.sent.length > 0);
				expect(plan.confirm === null).toBe(split.drafts.length + split.sent.length === 0);
				const skippedText = plan.skipped.join(' ');
				for (const s of split.skipped) expect(skippedText).toContain(s.name);
			})
		);
	});

	it('the result line names every request that did not go', () => {
		fc.assert(
			fc.property(fc.nat({ max: 20 }), fc.array(deletionFactsArb, { maxLength: 8 }), fc.constantFrom('delete' as const, 'duplicate' as const), (went, missedFacts, kind) => {
				const missed = missedFacts.map((f) => ({ id: f.id, name: requestName(f), reason: 'The server failed.' }));
				const line = resultLine(kind, { went, missed });
				for (const m of missed) expect(line).toContain(m.name);
				expect(line.endsWith('.')).toBe(true);
			})
		);
	});
});
