/**
 * A vendor's draft as it arrives over the wire, read field by field into a `BidDraft`. Nothing the
 * vendor sends is trusted: unknown keys are dropped (ids, status, round: the server owns them),
 * every amount is whole minor units, zero or more, and every list and text has a size cap. The
 * vendor never sends an exchange rate; the rate is always null. The currency is on the ISO 4217
 * list. A discount or tax percent, a rebate rate and a share of the work or contract is 0 to 100,
 * and the shares add up to 100 at most (`bid-limits.ts`).
 *
 * Whether every amount is in the bid's currency is `totals.checkBid`'s job, in the store. Whether
 * the total is above zero is checked at submit (`bid-limits.submitProblems`). Whether the package
 * figures hold together, and stay within the vendor's packages, is `packages.packageProblems`'s,
 * in the store.
 */

import type { Adjustment, BidLine, DepartmentCost, NonShotCost, NonShotCostKind, PackagePrice, PaymentMilestone, RebateSplit } from './model';
import type { Money } from './money';
import { MAX_DISCOUNT_PERCENT, MAX_TAX_PERCENT } from './bid-limits';
import { isCurrency } from './currencies';
import { comparePercent, isPercent, sumPercents } from './percent';
import type { BidDraft } from './rows';

export type DraftInput = { readonly ok: true; readonly draft: BidDraft } | { readonly ok: false; readonly message: string };

const MAX_TEXT = 20_000;
const MAX_LINES = 10_000;
const CODE = /^[A-Z]{3}$/;
const COST_KINDS: readonly NonShotCostKind[] = ['overhead', 'supervision', 'on_set', 'contingency', 'other'];

class Wrong extends Error {
	constructor(readonly where: string) {
		super(where);
	}
}

type Obj = Record<string, unknown>;

function object(value: unknown, where: string): Obj {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Wrong(where);
	return value as Obj;
}

function list(value: unknown, where: string, max: number): unknown[] {
	if (!Array.isArray(value) || value.length > max) throw new Wrong(where);
	return value;
}

function text(value: unknown, where: string, max = MAX_TEXT): string {
	if (typeof value !== 'string' || value.length > max) throw new Wrong(where);
	return value;
}

function optionalText(value: unknown, where: string): string | undefined {
	return value === undefined ? undefined : text(value, where);
}

function amount(value: unknown, where: string): Money {
	const o = object(value, where);
	if (!Number.isSafeInteger(o.minor) || (o.minor as number) < 0 || typeof o.currency !== 'string' || !CODE.test(o.currency)) throw new Wrong(where);
	return { minor: o.minor as number, currency: o.currency };
}

function percent(value: unknown, where: string, max?: string): string {
	if (typeof value !== 'string' || value.length > 40 || !isPercent(value)) throw new Wrong(where);
	if (max !== undefined && comparePercent(value, max) > 0) throw new Wrong(where);
	return value;
}

function bool(value: unknown, where: string): boolean {
	if (typeof value !== 'boolean') throw new Wrong(where);
	return value;
}

/** Keys whose value is undefined are left out, so the draft matches what the store reads back. */
function defined<T extends Obj>(record: T): T {
	return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined)) as T;
}

function line(value: unknown, where: string): BidDraft['lines'][number] {
	const o = object(value, where);
	const target = object(o.target, `${where}.target`);
	if ((target.kind !== 'shot' && target.kind !== 'asset') || typeof target.id !== 'string' || target.id === '' || target.id.length > 200) {
		throw new Wrong(`${where}.target`);
	}
	const departments =
		o.departments === undefined
			? undefined
			: list(o.departments, `${where}.departments`, 100).map((d, i): DepartmentCost => {
					const at = `${where}.departments[${i}]`;
					const row = object(d, at);
					return defined({
						department: text(row.department, `${at}.department`, 200),
						days: row.days === undefined ? undefined : percent(row.days, `${at}.days`),
						cost: row.cost === undefined ? undefined : amount(row.cost, `${at}.cost`)
					});
				});
	const result: Omit<BidLine, 'id'> = defined({
		target: { kind: target.kind, id: target.id },
		total: amount(o.total, `${where}.total`),
		excluded: bool(o.excluded, `${where}.excluded`),
		departments,
		compute: o.compute === undefined ? undefined : amount(o.compute, `${where}.compute`),
		markup: o.markup === undefined ? undefined : amount(o.markup, `${where}.markup`),
		notes: optionalText(o.notes, `${where}.notes`),
		methodology: optionalText(o.methodology, `${where}.methodology`),
		assumptions: optionalText(o.assumptions, `${where}.assumptions`),
		elementsNeeded: optionalText(o.elementsNeeded, `${where}.elementsNeeded`),
		startWeek: optionalText(o.startWeek, `${where}.startWeek`),
		inPackage: o.inPackage === undefined || o.inPackage === false ? undefined : bool(o.inPackage, `${where}.inPackage`)
	});
	return result;
}

/** A package priced as one figure: the package's id, the figure, a note. */
function packagePrice(value: unknown, where: string): PackagePrice {
	const o = object(value, where);
	return defined({
		package: text(o.package, `${where}.package`, 200),
		total: amount(o.total, `${where}.total`),
		notes: optionalText(o.notes, `${where}.notes`)
	});
}

function adjustment(value: unknown, where: string, max: string): Adjustment | null {
	if (value === null || value === undefined) return null;
	const o = object(value, where);
	if (o.kind === 'amount') return { kind: 'amount', amount: amount(o.amount, where) };
	if (o.kind === 'percent') return { kind: 'percent', percent: percent(o.percent, where, max) };
	throw new Wrong(where);
}

function split(value: unknown, where: string): RebateSplit {
	const o = object(value, where);
	const base = object(o.base, `${where}.base`);
	let parsed: RebateSplit['base'];
	if (base.kind === 'all' || base.kind === 'labour') parsed = { kind: base.kind };
	else if (base.kind === 'contract') parsed = { kind: 'contract', percent: percent(base.percent, `${where}.base`, '100') };
	else throw new Wrong(`${where}.base`);
	return {
		jurisdiction: text(o.jurisdiction, `${where}.jurisdiction`, 20),
		workPercent: percent(o.workPercent, `${where}.workPercent`, '100'),
		rate: percent(o.rate, `${where}.rate`, '100'),
		base: parsed
	};
}

function splits(value: unknown): RebateSplit[] {
	const out = list(value ?? [], 'rebate', 50).map((s, i) => split(s, `rebate[${i}]`));
	if (out.length > 0 && comparePercent(sumPercents(out.map((s) => s.workPercent)), '100') > 0) throw new Wrong('rebate');
	return out;
}

export function readDraft(value: unknown): DraftInput {
	try {
		const o = object(value, 'the bid');
		if (typeof o.currency !== 'string' || !CODE.test(o.currency) || !isCurrency(o.currency)) throw new Wrong('currency');
		const draft: BidDraft = defined({
			number: text(o.number ?? '', 'number', 200),
			date: text(o.date ?? '', 'date', 10),
			currency: o.currency,
			rate: null,
			validUntil: o.validUntil === undefined ? undefined : text(o.validUntil, 'validUntil', 10),
			assumptions: list(o.assumptions ?? [], 'assumptions', 500).map((a, i) => text(a, `assumptions[${i}]`)),
			exclusions: list(o.exclusions ?? [], 'exclusions', 500).map((a, i) => text(a, `exclusions[${i}]`)),
			milestones: list(o.milestones ?? [], 'milestones', 100).map((m, i): PaymentMilestone => {
				const at = `milestones[${i}]`;
				const row = object(m, at);
				return defined({ label: text(row.label, `${at}.label`, 500), percent: percent(row.percent, `${at}.percent`), due: optionalText(row.due, `${at}.due`) });
			}),
			lines: list(o.lines, 'lines', MAX_LINES).map((l, i) => line(l, `lines[${i}]`)),
			costs: list(o.costs ?? [], 'costs', 200).map((c, i): NonShotCost => {
				const at = `costs[${i}]`;
				const row = object(c, at);
				if (!COST_KINDS.includes(row.kind as NonShotCostKind)) throw new Wrong(`${at}.kind`);
				return { kind: row.kind as NonShotCostKind, label: text(row.label, `${at}.label`, 500), amount: amount(row.amount, `${at}.amount`), labour: bool(row.labour, `${at}.labour`) };
			}),
			discount: adjustment(o.discount, 'discount', MAX_DISCOUNT_PERCENT),
			tax: adjustment(o.tax, 'tax', MAX_TAX_PERCENT),
			rebate: splits(o.rebate),
			packages: o.packages === undefined ? undefined : list(o.packages, 'packages', 500).map((p, i) => packagePrice(p, `packages[${i}]`)),
			declined: o.declined === undefined ? undefined : list(o.declined, 'declined', 500).map((d, i) => text(d, `declined[${i}]`, 200))
		});
		return { ok: true, draft };
	} catch (error) {
		if (error instanceof Wrong) return { ok: false, message: `The bid could not be read at ${error.where}.` };
		throw error;
	}
}
