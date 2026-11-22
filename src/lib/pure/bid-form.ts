/**
 * The vendor's bid form: what the inputs hold, as typed, and the bid draft it makes.
 *
 * Every input is a string as typed. `formToDraft` reads them in the vendor's locale (`amount.ts`),
 * names each field it cannot read, and builds the draft from the rest, so totals and autosave work
 * while a cell is wrong. A submit waits for `blockers` to be empty.
 *
 * - A line exists for a priced or excluded item. An item with neither is not bid. A row omitted in
 *   a later round was cut: it takes no line, however its bid is priced.
 * - An excluded line keeps its typed price (zero when none); the price is ignored in every total.
 * - The vendor never gives an exchange rate. Production locks one.
 * - Totals run in the bid's own currency (`totals.ts`, `rebate.ts`).
 * - Per package, the vendor prices row by row, or gives one figure for the package. With a figure,
 *   each row of the package not omitted goes as a line in the package price. A figure left blank
 *   leaves the package's rows not bid. Switching clears what the other way held, so nothing typed
 *   is kept out of sight: `typedFor` says what would go, for a confirm first.
 * - A row that stands for several (`count.ts`) is priced per unit: the line's total is the unit
 *   price times the count, in whole minor units, and the line keeps its unit price. The rate card
 *   fills the unit price. Its department detail and compute are for the whole row.
 * - The vendor may decline a package it was invited to: "Not bidding". Its rows need no price and
 *   go as no line; it bids on one package at least. Declining clears what the package held, after
 *   the same confirm (`typedFor`).
 */

import { parseAmount, showAmount, type DecimalMark } from './amount';
import type { Adjustment, BidLine, BidRequest, Day, DepartmentCost, Id, NonShotCost, NonShotCostKind, PackagePrice, RebateSplit, RequestPackage, Target, VendorBid } from './model';
import { targetKey } from './model';
import { add, fromDecimal, minorDigits, money, toDecimal, type Money } from './money';
import { comparePercent, sumPercents } from './percent';
import { totalProblems } from './bid-limits';
import { ANSWER_ONE } from './packages';
import { estimateRebate, type RebateEstimate } from './rebate';
import type { BidDraft } from './rows';
import { bidTotals, type BidTotals } from './totals';
import { applyRates, followsRate, rateForm, type RateForm } from './rate-card';
import { countOf, extend } from './count';

export interface DepartmentForm {
	department: string;
	days: string;
	cost: string;
}

export interface LineForm {
	/** `shot:sh010`. */
	readonly key: string;
	readonly target: Target;
	/** The row's package. Absent: a request from before packages, one package. */
	readonly package?: Id;
	/** The row is out of the request: a package figure does not cover it. */
	readonly omitted?: boolean;
	/** The row's difficulty, which picks its rate. */
	readonly difficulty?: string;
	/** How many the row stands for (`count.ts`). Absent: 1. The price is then per unit. */
	readonly count?: number;
	/** The price as typed: per unit on a counted row. */
	price: string;
	/** The vendor typed this price: an override of any rate, kept whatever the rates do. */
	typed: boolean;
	excluded: boolean;
	departments: DepartmentForm[];
	compute: string;
	methodology: string;
	assumptions: string;
	notes: string;
}

export interface CostForm {
	kind: NonShotCostKind;
	label: string;
	amount: string;
	labour: boolean;
}

export interface AdjustmentForm {
	kind: 'amount' | 'percent';
	value: string;
}

export interface SplitForm {
	jurisdiction: string;
	workPercent: string;
	rate: string;
	base: 'all' | 'labour' | 'contract';
	contractPercent: string;
}

export interface MilestoneForm {
	label: string;
	percent: string;
	due: string;
}

/** How the vendor prices a package: row by row, or one figure for all its rows. */
export interface PackageForm {
	readonly id: Id;
	readonly name: string;
	/** False: the vendor is not bidding on the package. */
	bidding: boolean;
	mode: 'rows' | 'package';
	/** The figure, as typed. */
	price: string;
	notes: string;
}

export interface BidForm {
	number: string;
	date: string;
	currency: string;
	validUntil: string;
	lines: LineForm[];
	costs: CostForm[];
	discount: AdjustmentForm;
	tax: AdjustmentForm;
	rebate: SplitForm[];
	milestones: MilestoneForm[];
	/** One per line. */
	assumptions: string;
	/** One per line. */
	exclusions: string;
	/** One per package the vendor may price, in the request's order. */
	packages: PackageForm[];
	/** The vendor's rates, which fill the lines it has not typed (`rate-card.ts`). */
	rates: RateForm;
}

/** A bid as the form reads it back: a saved one, or a draft. */
export type BidSource = Pick<VendorBid, 'number' | 'date' | 'currency' | 'validUntil' | 'assumptions' | 'exclusions' | 'milestones' | 'costs' | 'discount' | 'tax' | 'rebate' | 'packages' | 'declined' | 'rateCard'> & {
	readonly lines: readonly (Omit<BidLine, 'id'> & { readonly id?: string })[];
};

/** The request as the form reads it: rows with their package, and the packages. */
export type FormRequest = Pick<BidRequest, 'header'> & {
	readonly shots: readonly { readonly id: Id; readonly omitted?: boolean; readonly package?: Id; readonly difficulty?: string; readonly count?: number }[];
	readonly assets: readonly { readonly id: Id; readonly omitted?: boolean; readonly package?: Id; readonly difficulty?: string; readonly count?: number }[];
	readonly packages?: readonly RequestPackage[];
};

export interface FormResult {
	readonly draft: BidDraft;
	/** Field key to message: `line:shot:sh010:price`, `cost:0:amount`, `discount`, `split:1:rate`. */
	readonly errors: Readonly<Record<string, string>>;
	readonly warnings: readonly string[];
	/** What stops a submit, in words, each field named. Empty when it may go. */
	readonly blockers: readonly string[];
	/** The same, each with the control that fixes it, in the order of the form. */
	readonly problems: readonly FormProblem[];
	/** `packaged`: rows covered by a package figure. `declined`: rows of packages not bid on. */
	readonly counts: { readonly priced: number; readonly excluded: number; readonly open: number; readonly packaged: number; readonly declined: number };
}

/** One thing to fix before a submit: the field by name, what is wrong, and the control's id. */
export interface FormProblem {
	/** The error key (`line:shot:sh010:price`), or `priced` and `total` for the bid as a whole. */
	readonly key: string;
	readonly label: string;
	readonly message: string;
	/** The id of the control that fixes it (`vendorControlId`). */
	readonly control: string;
	/** The line it sits on, `shot:sh010`, so its row can be shown and its detail opened. */
	readonly line?: string;
}

/** The element id of the control a form error key points at. */
export function vendorControlId(key: string): string {
	return `vf-${key}`;
}

/** Each item's code by its form key, `shot:<id>`, and each package's name by `package:<id>`, for the names in a problem. */
export function itemNames(request: {
	readonly shots: readonly { id: string; code: string }[];
	readonly assets: readonly { id: string; name: string }[];
	readonly packages?: readonly RequestPackage[];
}): Map<string, string> {
	return new Map([
		...request.shots.map((s) => [targetKey({ kind: 'shot', id: s.id }), s.code] as const),
		...request.assets.map((a) => [targetKey({ kind: 'asset', id: a.id }), a.name] as const),
		...(request.packages ?? []).map((p) => [`package:${p.id}`, p.name] as const)
	]);
}

const FIXED_LABELS: Readonly<Record<string, string>> = {
	currency: 'Currency',
	date: 'Bid date',
	validUntil: 'Valid until',
	discount: 'Discount',
	tax: 'Tax',
	splits: 'Rebate splits',
	milestones: 'Payment milestones'
};

const SPLIT_WORDS: Readonly<Record<string, string>> = { jurisdiction: 'where', workPercent: 'share of the work', rate: 'rate', contractPercent: 'share of the contract' };

/** The words for an error key: which field, on which item or row. */
function problemOf(key: string, message: string, form: BidForm, names: ReadonlyMap<string, string>): FormProblem {
	const base = { key, message, control: vendorControlId(key) };
	if (FIXED_LABELS[key]) return { ...base, label: FIXED_LABELS[key] };
	if (key === 'rate:fallback') return { ...base, label: 'Your rate for rows with no difficulty' };
	const rate = /^rate:(\d+)$/.exec(key);
	if (rate) return { ...base, label: `Your rate for ${form.rates.tiers[Number(rate[1])]?.difficulty ?? 'a difficulty'}` };
	const pkg = /^package:(.+):price$/.exec(key);
	if (pkg) return { ...base, label: `Price for ${names.get(`package:${pkg[1]}`) ?? 'the bid'}` };
	const line = /^line:((?:shot|asset):[^:]+):(.+)$/.exec(key);
	if (line) {
		const name = names.get(line[1]) ?? (line[1].startsWith('shot') ? 'A shot' : 'An asset');
		const rest = line[2];
		const dept = /^dept:(\d+):(\w+)$/.exec(rest);
		const label =
			rest === 'price' ? `Price for ${name}` : rest === 'compute' ? `${name}, compute` : dept ? `${name}, department ${Number(dept[1]) + 1}${dept[2] === 'department' ? '' : `, ${dept[2]}`}` : name;
		return { ...base, label, line: line[1] };
	}
	const cost = /^cost:(\d+):(\w+)$/.exec(key);
	if (cost) {
		const i = Number(cost[1]);
		return { ...base, label: cost[2] === 'label' ? `Cost ${i + 1}, name` : form.costs[i]?.label.trim() || `Cost ${i + 1}` };
	}
	const split = /^split:(\d+):(\w+)$/.exec(key);
	if (split) return { ...base, label: `Rebate split ${Number(split[1]) + 1}, ${SPLIT_WORDS[split[2]] ?? split[2]}` };
	const milestone = /^milestone:(\d+):(\w+)$/.exec(key);
	if (milestone) return { ...base, label: `Milestone ${Number(milestone[1]) + 1}, ${milestone[2] === 'label' ? 'name' : 'percent'}` };
	return { ...base, label: key };
}

export const FIXED_COSTS: readonly { kind: Exclude<NonShotCostKind, 'other'>; label: string }[] = [
	{ kind: 'overhead', label: 'Overhead' },
	{ kind: 'supervision', label: 'Supervision' },
	{ kind: 'on_set', label: 'On set' },
	{ kind: 'contingency', label: 'Contingency' }
];

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isDay(text: string): boolean {
	const parts = DAY.exec(text);
	if (!parts) return false;
	const [year, month, day] = parts.slice(1).map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function blankLine(target: Target, row: { readonly omitted?: boolean; readonly package?: Id; readonly difficulty?: string; readonly count?: number }): LineForm {
	const count = countOf(row);
	return {
		key: targetKey(target),
		target,
		...(row.package !== undefined ? { package: row.package } : {}),
		...(row.omitted ? { omitted: true } : {}),
		...(row.difficulty?.trim() ? { difficulty: row.difficulty.trim() } : {}),
		...(count > 1 ? { count } : {}),
		price: '',
		typed: false,
		excluded: false,
		departments: [],
		compute: '',
		methodology: '',
		assumptions: '',
		notes: ''
	};
}

export function emptyForm(request: FormRequest, today: Day): BidForm {
	const lines = [...request.shots.map((s) => blankLine({ kind: 'shot', id: s.id }, s)), ...request.assets.map((a) => blankLine({ kind: 'asset', id: a.id }, a))];
	return {
		number: '',
		date: today,
		currency: request.header.baseCurrency,
		validUntil: '',
		lines,
		costs: FIXED_COSTS.map(({ kind, label }) => ({ kind, label, amount: '', labour: false })),
		discount: { kind: 'percent', value: '' },
		tax: { kind: 'percent', value: '' },
		rebate: [],
		milestones: [],
		assumptions: '',
		exclusions: '',
		packages: (request.packages ?? []).map((p) => ({ id: p.id, name: p.name, bidding: true, mode: 'rows', price: '', notes: '' })),
		rates: rateForm(lines)
	};
}

const shown = (amount: Money, mark: DecimalMark) => showAmount(toDecimal(amount), mark);
const plainShown = (text: string, mark: DecimalMark) => (mark === ',' ? text.replace('.', ',') : text);

export function formFromBid(bid: BidSource, request: FormRequest, mark: DecimalMark): BidForm {
	const form = emptyForm(request, bid.date || '');
	// A line in a package price carries no price of its own: its row starts blank.
	const byKey = new Map(bid.lines.filter((l) => !l.inPackage).map((l) => [targetKey(l.target), l]));
	const figures = new Map((bid.packages ?? []).map((p) => [p.package, p]));
	const declined = new Set(bid.declined ?? []);
	form.packages = form.packages.map((p) => {
		if (declined.has(p.id)) return { ...p, bidding: false };
		const figure = figures.get(p.id);
		return figure ? { ...p, mode: 'package', price: shown(figure.total, mark), notes: figure.notes ?? '' } : p;
	});
	form.number = bid.number;
	form.currency = bid.currency;
	form.validUntil = bid.validUntil ?? '';
	form.lines = form.lines.map((blank) => {
		const saved = byKey.get(blank.key);
		if (!saved) return blank;
		// A counted row's price is its unit price; the line's total is that times the count.
		const price = saved.unit ?? saved.total;
		return {
			...blank,
			price: saved.excluded && saved.total.minor === 0 ? '' : shown(price, mark),
			// A line from before rates, or one the vendor typed, is its own price.
			typed: saved.fromRate !== true,
			excluded: saved.excluded,
			departments: (saved.departments ?? []).map((d) => ({
				department: d.department,
				days: d.days ? plainShown(d.days, mark) : '',
				cost: d.cost ? shown(d.cost, mark) : ''
			})),
			compute: saved.compute ? shown(saved.compute, mark) : '',
			methodology: saved.methodology ?? '',
			assumptions: saved.assumptions ?? '',
			notes: saved.notes ?? ''
		};
	});
	const rest = [...bid.costs];
	form.costs = form.costs.map((fixed) => {
		const index = rest.findIndex((c) => c.kind === fixed.kind);
		if (index < 0) return fixed;
		const [cost] = rest.splice(index, 1);
		return { kind: cost.kind, label: cost.label, amount: shown(cost.amount, mark), labour: cost.labour };
	});
	form.costs.push(...rest.map((c) => ({ kind: c.kind, label: c.label, amount: shown(c.amount, mark), labour: c.labour })));
	const adjustment = (value: Adjustment | null): AdjustmentForm =>
		value === null ? { kind: 'percent', value: '' } : value.kind === 'amount' ? { kind: 'amount', value: shown(value.amount, mark) } : { kind: 'percent', value: plainShown(value.percent, mark) };
	form.discount = adjustment(bid.discount);
	form.tax = adjustment(bid.tax);
	form.rebate = bid.rebate.map((s) => ({
		jurisdiction: s.jurisdiction,
		workPercent: plainShown(s.workPercent, mark),
		rate: plainShown(s.rate, mark),
		base: s.base.kind,
		contractPercent: s.base.kind === 'contract' ? plainShown(s.base.percent, mark) : ''
	}));
	form.milestones = bid.milestones.map((m) => ({ label: m.label, percent: plainShown(m.percent, mark), due: m.due ?? '' }));
	form.assumptions = bid.assumptions.join('\n');
	form.exclusions = bid.exclusions.join('\n');
	form.rates = rateForm(form.lines, bid.rateCard, mark);
	return applyRates(form);
}

type Plain = { kind: 'blank' } | { kind: 'value'; text: string } | { kind: 'error' };

/** A plain non-negative decimal as typed: `4,5`, `12.5 %`. */
function parsePlain(text: string): Plain {
	const t = text.replace(/[\s% ]/g, '');
	if (t === '') return { kind: 'blank' };
	const dotted = (t.match(/,/g) ?? []).length === 1 && !t.includes('.') ? t.replace(',', '.') : t;
	return /^\d+(\.\d+)?$/.test(dotted) ? { kind: 'value', text: dotted } : { kind: 'error' };
}

const lines = (text: string) =>
	text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);

export function formToDraft(form: BidForm, mark: DecimalMark, names: ReadonlyMap<string, string> = new Map()): FormResult {
	const errors: Record<string, string> = {};
	const warnings: string[] = [];
	let currency = form.currency;
	try {
		minorDigits(currency);
	} catch {
		errors.currency = 'Pick a currency.';
		currency = 'USD';
	}

	/** An amount, or undefined when blank or wrong (and then the error is written). */
	const amount = (text: string, key: string): Money | undefined => {
		const parsed = parseAmount(text, currency, mark);
		if (parsed.kind === 'error') errors[key] = parsed.message;
		return parsed.kind === 'amount' ? fromDecimal(parsed.decimal, currency) : undefined;
	};
	const percent = (text: string, key: string, word = 'Not a percent.', max?: { value: string; message: string }): string | undefined => {
		const parsed = parsePlain(text);
		if (parsed.kind === 'error') {
			errors[key] = word;
			return undefined;
		}
		if (parsed.kind === 'blank') return undefined;
		if (max && comparePercent(parsed.text, max.value) > 0) {
			errors[key] = max.message;
			return undefined;
		}
		return parsed.text;
	};
	const upTo100 = (message: string) => ({ value: '100', message });

	if (!isDay(form.date)) errors.date = 'Use a real day.';
	if (form.validUntil !== '' && !isDay(form.validUntil)) errors.validUntil = 'Use a real day.';
	else if (form.validUntil !== '' && isDay(form.date) && form.validUntil < form.date) warnings.push('The bid is valid until a day before its date.');

	// Packages priced as one figure: the figure, and every row of the package not omitted in it.
	const figures: PackagePrice[] = [];
	const asFigure = new Set<Id>();
	const blankFigure = new Set<Id>();
	const declined = new Set((form.packages ?? []).filter((p) => !p.bidding).map((p) => p.id));
	for (const pkg of form.packages ?? []) {
		if (pkg.mode !== 'package' || !pkg.bidding) continue;
		const total = amount(pkg.price, `package:${pkg.id}:price`);
		if (total === undefined) {
			blankFigure.add(pkg.id);
			continue;
		}
		asFigure.add(pkg.id);
		const notes = pkg.notes.trim();
		figures.push({ package: pkg.id, total, ...(notes ? { notes } : {}) });
	}

	// The vendor's rates. A line that follows a rate that does not read is not bid: the rate is named once.
	const rates: { difficulty: string; amount: Money }[] = [];
	const badRates = new Set<string>();
	for (const [index, tier] of (form.rates?.tiers ?? []).entries()) {
		const value = amount(tier.price, `rate:${index}`);
		if (value !== undefined) rates.push({ difficulty: tier.difficulty, amount: value });
		else if (tier.price.trim() !== '') badRates.add(tier.price);
	}
	const fallback = form.rates ? amount(form.rates.fallback, 'rate:fallback') : undefined;
	if (form.rates && fallback === undefined && form.rates.fallback.trim() !== '') badRates.add(form.rates.fallback);

	const counts = { priced: 0, excluded: 0, open: 0, packaged: 0, declined: 0 };
	const draftLines: BidDraft['lines'][number][] = [];
	for (const line of form.lines) {
		const at = `line:${line.key}`;
		const pkg = line.package ?? 'all';
		// A row omitted in a later round was cut: it takes no price, however the bid is priced.
		if (line.omitted) continue;
		if (declined.has(pkg)) {
			counts.declined++;
			continue;
		}
		if (asFigure.has(pkg)) {
			counts.packaged++;
			draftLines.push({ target: line.target, total: money(0, currency), excluded: false, inPackage: true });
			continue;
		}
		if (blankFigure.has(pkg)) {
			counts.open++;
			continue;
		}
		const viaRate = form.rates !== undefined && followsRate(form, line);
		if (viaRate && badRates.has(line.price)) {
			if (!line.excluded) counts.open++;
			continue;
		}
		const unit = amount(line.price, `${at}:price`);
		// A counted row is priced per unit: its total is the unit price times its count, exact.
		const count = line.count ?? 1;
		let price = unit;
		if (unit !== undefined && count > 1) {
			try {
				price = extend(unit, count);
			} catch {
				errors[`${at}:price`] = `Too large: ${count} times this price does not hold exactly.`;
				price = undefined;
			}
		}
		const departments: DepartmentCost[] = [];
		for (const [index, row] of line.departments.entries()) {
			const name = row.department.trim();
			if (!name && !row.days.trim() && !row.cost.trim()) continue;
			const days = percent(row.days, `${at}:dept:${index}:days`, 'Not a number of days.');
			const cost = amount(row.cost, `${at}:dept:${index}:cost`);
			if (!name) {
				errors[`${at}:dept:${index}:department`] = 'Name the department.';
				continue;
			}
			departments.push({ department: name, ...(days !== undefined ? { days } : {}), ...(cost !== undefined ? { cost } : {}) });
		}
		const compute = amount(line.compute, `${at}:compute`);
		if (!line.excluded && price === undefined) {
			counts.open++;
			continue;
		}
		if (line.excluded) counts.excluded++;
		else counts.priced++;
		const texts = { methodology: line.methodology.trim(), assumptions: line.assumptions.trim(), notes: line.notes.trim() };
		draftLines.push({
			target: line.target,
			total: price ?? money(0, currency),
			excluded: line.excluded,
			...(departments.length > 0 ? { departments } : {}),
			...(compute !== undefined ? { compute } : {}),
			...Object.fromEntries(Object.entries(texts).filter(([, v]) => v !== '')),
			...(viaRate && price !== undefined ? { fromRate: true } : {}),
			...(count > 1 && price !== undefined && unit !== undefined ? { unit } : {})
		});
	}

	const costs: NonShotCost[] = [];
	for (const [index, cost] of form.costs.entries()) {
		const value = amount(cost.amount, `cost:${index}:amount`);
		if (value === undefined) continue;
		const label = cost.label.trim();
		if (!label) {
			errors[`cost:${index}:label`] = 'Name the cost.';
			continue;
		}
		costs.push({ kind: cost.kind, label, amount: value, labour: cost.labour });
	}

	const adjustment = (value: AdjustmentForm, key: 'discount' | 'tax'): Adjustment | null => {
		if (value.kind === 'amount') {
			const found = amount(value.value, key);
			return found === undefined ? null : { kind: 'amount', amount: found };
		}
		const found = percent(value.value, key, 'Not a percent.', upTo100(key === 'discount' ? 'A discount is 100% at most.' : 'A tax is 100% at most.'));
		return found === undefined ? null : { kind: 'percent', percent: found };
	};
	const discount = adjustment(form.discount, 'discount');
	const tax = adjustment(form.tax, 'tax');

	let rebate: RebateSplit[] = [];
	for (const [index, split] of form.rebate.entries()) {
		const at = `split:${index}`;
		const jurisdiction = split.jurisdiction.trim();
		if (!jurisdiction && !split.workPercent.trim() && !split.rate.trim()) continue;
		if (!jurisdiction) errors[`${at}:jurisdiction`] = 'Pick where the work is done.';
		const work = percent(split.workPercent, `${at}:workPercent`, 'Not a percent.', upTo100('100% at most.'));
		const rate = percent(split.rate, `${at}:rate`, 'Not a percent.', upTo100('100% at most.'));
		if (work === undefined && !errors[`${at}:workPercent`]) errors[`${at}:workPercent`] = 'Give the share of the work done there.';
		if (rate === undefined && !errors[`${at}:rate`]) errors[`${at}:rate`] = 'Give the rate.';
		let contract: string | undefined;
		if (split.base === 'contract') {
			contract = percent(split.contractPercent, `${at}:contractPercent`, 'Not a percent.', upTo100('100% at most.'));
			if (contract === undefined && !errors[`${at}:contractPercent`]) errors[`${at}:contractPercent`] = 'Give the share of the contract.';
		}
		if (!jurisdiction || work === undefined || rate === undefined || (split.base === 'contract' && contract === undefined)) continue;
		rebate.push({
			jurisdiction,
			workPercent: work,
			rate,
			base: split.base === 'contract' ? { kind: 'contract', percent: contract! } : { kind: split.base }
		});
	}
	if (rebate.length > 0) {
		const covered = sumPercents(rebate.map((s) => s.workPercent));
		if (comparePercent(covered, '100') > 0) {
			errors.splits = `The splits cover ${covered}% of the work. 100% at most.`;
			rebate = [];
		}
	}

	const milestones: VendorBid['milestones'][number][] = [];
	for (const [index, row] of form.milestones.entries()) {
		const label = row.label.trim();
		if (!label && !row.percent.trim() && !row.due.trim()) continue;
		const share = percent(row.percent, `milestone:${index}:percent`, 'Not a percent.');
		if (!label) errors[`milestone:${index}:label`] = 'Name the milestone.';
		if (share === undefined && !errors[`milestone:${index}:percent`]) errors[`milestone:${index}:percent`] = 'Give its percent.';
		if (!label || share === undefined) continue;
		const due = row.due.trim();
		milestones.push({ label, percent: share, ...(due ? { due } : {}) });
	}
	if (milestones.length > 0) {
		const total = sumPercents(milestones.map((m) => m.percent));
		if (comparePercent(total, '100') > 0) errors.milestones = `The payment milestones add up to ${total}%. 100% at most.`;
		else if (comparePercent(total, '100') < 0) warnings.push(`The payment milestones add up to ${total}%, not 100%.`);
	}

	if (counts.open > 0) {
		warnings.push(counts.open === 1 ? '1 item has no price. It will show as not bid.' : `${counts.open} items have no price. They will show as not bid.`);
	}
	// Every problem named by its field, in the order of the form, never only counted.
	const problems: FormProblem[] = Object.entries(errors).map(([key, message]) => problemOf(key, message, form, names));
	const wrong = problems.length;
	const firstPrice = form.lines.find((l) => !l.excluded) ?? form.lines[0];
	const priceControl = firstPrice ? { control: vendorControlId(`line:${firstPrice.key}:price`), line: firstPrice.key } : { control: 'items' };
	const packages = form.packages ?? [];
	if (packages.length > 0 && packages.every((p) => !p.bidding)) {
		problems.push({ key: 'bidding', label: 'Bids', message: ANSWER_ONE, control: vendorControlId(`package:${packages[0].id}:bidding`) });
	} else if (counts.priced === 0 && counts.packaged === 0) problems.push({ key: 'priced', label: 'Shots and assets', message: 'Price at least one shot or asset.', ...priceControl });

	const validUntil = form.validUntil !== '' && isDay(form.validUntil) ? form.validUntil : undefined;
	const draft: BidDraft = {
		number: form.number.trim(),
		date: isDay(form.date) ? form.date : '',
		currency,
		rate: null,
		...(validUntil ? { validUntil } : {}),
		assumptions: lines(form.assumptions),
		exclusions: lines(form.exclusions),
		milestones,
		lines: draftLines,
		costs,
		discount,
		tax,
		rebate,
		...(figures.length > 0 ? { packages: figures } : {}),
		...(declined.size > 0 ? { declined: [...declined] } : {}),
		...(rates.length > 0 || fallback !== undefined ? { rateCard: { rates, ...(fallback !== undefined ? { fallback } : {}) } } : {})
	};
	if (counts.priced + counts.packaged > 0 && wrong === 0) {
		for (const message of totalProblems(asBid(draft), currency)) {
			const discount = message.startsWith('The discount');
			problems.push({ key: discount ? 'discount' : 'total', label: discount ? 'Discount' : 'Total', message, ...(discount ? { control: vendorControlId('discount') } : priceControl) });
		}
	}
	const blockers = problems.map((p) => (p.key === 'priced' || p.key === 'bidding' || p.key === 'total' || (p.key === 'discount' && p.message.startsWith('The discount')) ? p.message : `${p.label}: ${p.message}`));
	return { draft, errors, warnings, blockers, problems, counts };
}

/** The draft as a bid in its own currency, for the totals. */
function asBid(draft: BidDraft): VendorBid {
	return {
		...draft,
		id: 'draft',
		requestId: '',
		vendorId: '',
		round: 1,
		status: 'draft',
		rate: null,
		lines: draft.lines.map((l, index) => ({ ...l, id: l.id ?? `line ${index + 1}` }))
	};
}

export interface FormTotals {
	readonly totals: BidTotals;
	/** Null with no splits. */
	readonly rebate: RebateEstimate | null;
}

/** The draft's totals in its own currency, and the rebate estimate when it has splits. */
export function formTotals(draft: BidDraft): FormTotals {
	const bid = asBid(draft);
	const totals = bidTotals(bid, bid.currency);
	let rebate: RebateEstimate | null = null;
	if (bid.rebate.length > 0) {
		try {
			rebate = estimateRebate(bid, bid.currency);
		} catch {
			rebate = null;
		}
	}
	return { totals, rebate };
}

/** A line's department costs plus its compute, or null when it has neither. Cells that do not read are skipped. */
export function lineDetailTotal(line: LineForm, currency: string, mark: DecimalMark): Money | null {
	const parts = [...line.departments.map((d) => d.cost), line.compute]
		.map((text) => parseAmount(text, currency, mark))
		.flatMap((p) => (p.kind === 'amount' ? [fromDecimal(p.decimal, currency)] : []));
	return parts.length === 0 ? null : parts.reduce((a, b) => add(a, b));
}

/** Rows of the package with a price, an exclusion or detail typed. */
function typedRows(form: BidForm, id: Id): number {
	return form.lines.filter(
		(l) =>
			(l.package ?? 'all') === id &&
			(l.price.trim() !== '' || l.excluded || l.compute.trim() !== '' || l.departments.length > 0 || l.methodology.trim() !== '' || l.assumptions.trim() !== '' || l.notes.trim() !== '')
	).length;
}

/**
 * What a change to a package would clear: to `mode`, the row prices and detail typed in it, or its
 * figure; to `declined`, whatever it holds.
 */
export function typedFor(form: BidForm, id: Id, mode: PackageForm['mode'] | 'declined'): { rows: number; figure: boolean } {
	const pkg = form.packages.find((p) => p.id === id);
	if (!pkg || !pkg.bidding) return { rows: 0, figure: false };
	const figure = pkg.mode === 'package' && (pkg.price.trim() !== '' || pkg.notes.trim() !== '');
	if (mode === 'declined') return { rows: pkg.mode === 'rows' ? typedRows(form, id) : 0, figure };
	if (pkg.mode === mode) return { rows: 0, figure: false };
	if (mode === 'rows') return { rows: 0, figure };
	return { rows: typedRows(form, id), figure: false };
}

/** Bid on the package again, or not: not bidding clears what it held. */
export function setBidding(form: BidForm, id: Id, bidding: boolean): BidForm {
	const pkg = form.packages.find((p) => p.id === id);
	if (!pkg || pkg.bidding === bidding) return form;
	if (bidding) return applyRates({ ...form, packages: form.packages.map((p) => (p.id === id ? { ...p, bidding: true, mode: 'rows' } : p)) });
	return {
		...form,
		packages: form.packages.map((p) => (p.id === id ? { ...p, bidding: false, mode: 'rows', price: '', notes: '' } : p)),
		lines: form.lines.map((l) => ((l.package ?? 'all') === id ? { ...l, price: '', typed: false, excluded: false, departments: [], compute: '', methodology: '', assumptions: '', notes: '' } : l))
	};
}

/** The package priced the other way, what the old way held cleared. */
export function switchMode(form: BidForm, id: Id, mode: PackageForm['mode']): BidForm {
	const pkg = form.packages.find((p) => p.id === id);
	if (!pkg || pkg.mode === mode) return form;
	return applyRates({
		...form,
		packages: form.packages.map((p) => (p.id === id ? { ...p, mode, price: '', notes: '' } : p)),
		lines:
			mode === 'package'
				? form.lines.map((l) => ((l.package ?? 'all') === id ? { ...l, price: '', typed: false, excluded: false, departments: [], compute: '', methodology: '', assumptions: '', notes: '' } : l))
				: form.lines
	});
}

