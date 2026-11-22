/**
 * Generators for the property tests (`*.property.test.ts`): realistic, valid domain values. Test
 * only: no app code imports it.
 *
 * A world is a request with its rows and bids (packages), its vendors and their answers, and an
 * award scenario that holds together. Answers come in several currencies with a locked rate, row by
 * row or as one figure per bid, with bids declined, rows excluded or left open, non-shot costs, a
 * discount, a tax and rebate splits. Breakdown rows may stand for several (`count.ts`), and their
 * lines are priced per unit, the total the unit times the count. Sizes stay small, so a run stays fast.
 *
 * In CI the seed is fixed, so a run is the same run. `FC_SEED=<seed>` replays a failure anywhere;
 * fast-check prints the seed, the path and the shrunk counterexample when a property fails.
 * `FC_RUNS=<n>` runs each property n times instead of 100, for a deeper search by hand.
 */

import fc from 'fast-check';
import type {
	Adjustment,
	AwardScenario,
	BidLine,
	BidRequest,
	DepartmentCost,
	Id,
	InvitedVendor,
	NonShotCost,
	PackagePrice,
	RebateSplit,
	RequestAsset,
	RequestPackage,
	RequestShot,
	ScenarioPick,
	Target,
	VendorBid
} from './model';
import { targetKey } from './model';
import { minorDigits, money, rate, type Money, type Rate } from './money';
import type { AwardInput, AwardPlan, Existing, FptSite, Write, Written } from './fpt-award';
import { resolvePackages } from './packages';
import { countOf, extend } from './count';
import type { DeletionFacts } from './request-delete';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const seed = env.FC_SEED ? Number(env.FC_SEED) : env.CI ? 40 : undefined;
fc.configureGlobal({ ...(seed === undefined ? {} : { seed }), ...(env.FC_RUNS ? { numRuns: Number(env.FC_RUNS) } : {}), verbose: 1 });

// Money.

/** Roughly what one unit of each currency is worth in US dollars, to keep amounts and rates real. */
export const USD_VALUE: Readonly<Record<string, number>> = {
	USD: 1,
	EUR: 1.08,
	GBP: 1.27,
	CAD: 0.73,
	AUD: 0.66,
	CHF: 1.13,
	NZD: 0.6,
	JPY: 0.0067,
	KRW: 0.00073,
	ISK: 0.0072,
	CLP: 0.0011,
	KWD: 3.25,
	BHD: 2.65,
	JOD: 1.41,
	OMR: 2.6,
	TND: 0.32
};

export const CODES: readonly string[] = Object.keys(USD_VALUE);

/** Currencies by minor digits: 0, 2 and 3. */
export const BY_DIGITS: Readonly<Record<0 | 2 | 3, readonly string[]>> = {
	0: CODES.filter((c) => minorDigits(c) === 0),
	2: CODES.filter((c) => minorDigits(c) === 2),
	3: CODES.filter((c) => minorDigits(c) === 3)
};

export const currencyArb: fc.Arbitrary<string> = fc.constantFrom(...CODES);

/** The most minor units a figure takes in `currency`: about `usd` dollars. */
function maxMinor(currency: string, usd: number): number {
	return Math.round((usd / USD_VALUE[currency]) * 10 ** minorDigits(currency));
}

/** An amount of zero or more in `currency`, up to about `usd` dollars; small ones often, for rounding. */
export function amountArb(currency: string, usd = 2_000_000): fc.Arbitrary<Money> {
	const max = maxMinor(currency, usd);
	return fc.oneof(fc.integer({ min: 0, max: 1_000 }), fc.integer({ min: 0, max })).map((minor) => money(minor, currency));
}

/** A positive number written as a plain decimal with six significant digits: `0.923412`, `1412.5`. */
export function plainDecimal(value: number): string {
	const places = Math.max(0, 5 - Math.floor(Math.log10(value)));
	const text = value.toFixed(places);
	return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** A rate from `from` to `to`, near the real one, locked on a day. */
export function rateArb(from: string, to: string): fc.Arbitrary<Rate> {
	const mid = USD_VALUE[from] / USD_VALUE[to];
	return fc.integer({ min: 8_000, max: 12_500 }).map((jitter) => rate(from, to, plainDecimal((mid * jitter) / 10_000), '2026-11-20'));
}

/** Thousandths of a percent written as a percent is typed: 12500 is `12.5`. */
export function writePercent(thousandths: number): string {
	const whole = Math.floor(thousandths / 1000);
	const fraction = String(thousandths % 1000).padStart(3, '0').replace(/0+$/, '');
	return fraction ? `${whole}.${fraction}` : String(whole);
}

/** A percent from 0 to `max`, as typed: whole often, up to three decimals. */
export function percentArb(max = 100): fc.Arbitrary<string> {
	return fc.oneof(fc.integer({ min: 0, max }).map(String), fc.integer({ min: 0, max: max * 1000 }).map(writePercent));
}

// The world: a request, its vendors' answers, a scenario.

export interface World {
	readonly request: BidRequest;
	readonly bids: readonly VendorBid[];
	readonly scenario: AwardScenario;
}

export interface WorldOptions {
	/** Rows with no Flow PT row, from a breakdown. On by default. */
	readonly breakdown?: boolean;
	/** Breakdown rows that stand for several (`count.ts`), priced per unit. On by default. */
	readonly counts?: boolean;
	/** The highest rebate rate. 50 by default: the real ones sit below. */
	readonly maxRebateRate?: number;
	/** The most vendors. */
	readonly maxVendors?: number;
}

/**
 * Choices read in turn from numbers fast-check draws and shrinks. Past the end every choice is the
 * smallest, and a smaller number is a simpler choice: no optional part, the first of a list.
 */
class Tape {
	private at = 0;
	constructor(private readonly values: readonly number[]) {}
	next(): number {
		return this.values[this.at++] ?? 0;
	}
}

type G = Tape;
const TAPE = 600;

/** A UUID made from a kind and a number, so ids stay distinct while a counterexample shrinks. */
export function uuid(kind: number, n: number): string {
	return `${String(kind).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export const REQUEST_ID = uuid(1, 0);
const VENDOR_NAMES = ['Northlight', 'Pixel Forge', 'Bluebird', 'Ironclad', 'Lumen'];
const JURISDICTIONS = ['GB', 'CA-BC', 'CA-QC', 'AU', 'NZ', 'FR'];
const COST_KINDS: readonly NonShotCost['kind'][] = ['overhead', 'supervision', 'on_set', 'contingency', 'other'];

function int(g: G, min: number, max: number): number {
	const span = max - min + 1;
	const draw = span > 2 ** 31 ? g.next() * 2 ** 31 + g.next() : g.next();
	return min + (draw % span);
}
const chance = (g: G, percent: number): boolean => int(g, 0, 99) >= 100 - percent;
const pickOne = <T>(g: G, list: readonly T[]): T => list[int(g, 0, list.length - 1)];
/** Small amounts often, for rounding; up to about `usd` dollars. */
const amount = (g: G, currency: string, usd = 2_000_000): Money => money(chance(g, 30) ? int(g, 0, 1_000) : int(g, 0, maxMinor(currency, usd)), currency);
const percent = (g: G, max: number): string => (chance(g, 50) ? writePercent(int(g, 0, max * 1000)) : String(int(g, 0, max)));
const SEQUENCE_CHARS = 'SQ010 |/%&é_-.#';

/** A package id as the app makes them: `bid:<id>`, `seq:<sequence>` with any character, or a key from before. */
function packageId(g: G, i: number): Id {
	switch (int(g, 0, 2)) {
		case 0:
			return `bid:${uuid(9, i)}`;
		case 1:
			return `seq:${Array.from({ length: int(g, 1, 6) }, () => SEQUENCE_CHARS[int(g, 0, SEQUENCE_CHARS.length - 1)]).join('').trim() || 'SQ'}~${i}`;
		default:
			return `pkg:${i}`;
	}
}

function packagesOf(g: G): RequestPackage[] | undefined {
	if (chance(g, 20)) return undefined;
	const names = ['Hero shots', 'Environments', 'Creatures', 'Cleanup'];
	return Array.from({ length: int(g, 1, 3) }, (_, i) => ({ id: packageId(g, i), name: `${pickOne(g, names)} ${i + 1}` }));
}

function rowsOf(g: G, packages: readonly RequestPackage[] | undefined, breakdown: boolean, counts: boolean): { shots: RequestShot[]; assets: RequestAsset[] } {
	const pkg = () => (packages ? pickOne(g, packages).id : undefined);
	/** A breakdown row may stand for several: 2 to 500 of its kind. */
	const counted = (fromBreakdown: boolean) => (fromBreakdown && counts && chance(g, 40) ? { count: int(g, 2, 500) } : {});
	const shots = Array.from({ length: int(g, 1, 7) }, (_, i): RequestShot => {
		const fromBreakdown = breakdown && chance(g, 15);
		const frames = chance(g, 70) ? int(g, 1, 400) : undefined;
		const sequence = pickOne(g, ['SQ010', 'SQ020', undefined]);
		return {
			id: fromBreakdown ? `bd-s${i}` : `shot-${100 + i}`,
			code: `SH${(i + 1) * 10}`,
			...(fromBreakdown ? { source: 'breakdown' as const } : { fpt: { type: 'Shot', id: 100 + i } }),
			...(frames === undefined ? {} : { frames }),
			...(sequence ? { sequence } : {}),
			omitted: chance(g, 15),
			assetIds: [],
			...(packages ? { package: pkg() } : {}),
			...counted(fromBreakdown)
		};
	});
	const assets = Array.from({ length: int(g, 0, 3) }, (_, i): RequestAsset => {
		const fromBreakdown = breakdown && chance(g, 15);
		return {
			id: fromBreakdown ? `bd-a${i}` : `asset-${200 + i}`,
			name: `Asset ${i + 1}`,
			...(fromBreakdown ? { source: 'breakdown' as const } : { fpt: { type: 'Asset', id: 200 + i } }),
			...(chance(g, 10) ? { omitted: true } : {}),
			...(packages ? { package: pkg() } : {}),
			...counted(fromBreakdown)
		};
	});
	return { shots, assets };
}

function vendorsOf(g: G, packages: readonly RequestPackage[] | undefined, most: number): InvitedVendor[] {
	return Array.from({ length: int(g, 1, most) }, (_, j): InvitedVendor => {
		let invited: Id[] | undefined;
		if (packages && chance(g, 50)) {
			invited = packages.filter(() => chance(g, 50)).map((p) => p.id);
			if (invited.length === 0) invited = [packages[0].id];
		}
		return {
			id: uuid(2, j),
			name: VENDOR_NAMES[j],
			email: `bids@vendor${j}.test`,
			ndaExecuted: true,
			fpt: { type: 'Group', id: 38 + j },
			...(invited ? { packages: invited } : {})
		};
	});
}

/** Shares of the work, in thousandths of a percent, that sum to 100% at most. */
function workShares(g: G, n: number): number[] {
	let left = 100_000;
	return Array.from({ length: n }, () => {
		const share = int(g, 0, left);
		left -= share;
		return share;
	});
}

function rebateOf(g: G, maxRate: number): RebateSplit[] {
	return workShares(g, int(g, 0, 3)).map((work) => ({
		jurisdiction: pickOne(g, JURISDICTIONS),
		workPercent: writePercent(work),
		rate: percent(g, maxRate),
		base: pickOne(g, [{ kind: 'all' as const }, { kind: 'labour' as const }, { kind: 'contract' as const, percent: percent(g, 100) }])
	}));
}

function adjustment(g: G, currency: string, of: number, maxPercent: number): Adjustment | null {
	const roll = int(g, 1, 100);
	if (roll <= 20) return { kind: 'percent', percent: percent(g, maxPercent) };
	if (roll <= 35) return { kind: 'amount', amount: money(int(g, 0, Math.floor((of * maxPercent) / 100)), currency) };
	return null;
}

/** A line on its row. A counted row's is priced per unit: its total is the unit times the count. */
function lineOf(g: G, bidIndex: number, target: Target, currency: string, count: number): BidLine | null {
	if (chance(g, 12)) return null;
	const id = `l${bidIndex}-${targetKey(target)}`;
	if (count > 1) {
		const unit = amount(g, currency, 2_000);
		return { id, target, total: extend(unit, count), unit, excluded: chance(g, 10) };
	}
	if (chance(g, 10)) return { id, target, total: chance(g, 50) ? money(0, currency) : amount(g, currency, 200_000), excluded: true };
	const total = amount(g, currency, 200_000);
	const detail = chance(g, 50);
	const departments: DepartmentCost[] = [{ department: 'Comp', days: String(int(g, 1, 20)), cost: total }];
	const compute = chance(g, 40) ? money(int(g, 0, total.minor), currency) : undefined;
	return { id, target, total, excluded: false, ...(detail ? { departments } : {}), ...(compute ? { compute } : {}) };
}

function bidOf(g: G, j: number, request: BidRequest, vendor: InvitedVendor, maxRate: number): VendorBid {
	const base = request.header.baseCurrency;
	const resolved = resolvePackages(request);
	const currency = chance(g, 45) ? base : pickOne(g, CODES);
	const invited = vendor.packages ?? resolved.packages.map((p) => p.id);
	const declined = resolved.implicit ? [] : invited.filter(() => chance(g, 25));
	if (declined.length === invited.length) declined.shift();
	const lines: BidLine[] = [];
	const packages: PackagePrice[] = [];
	const counts = new Map([...request.shots.map((s) => [targetKey({ kind: 'shot', id: s.id }), countOf(s)] as const), ...request.assets.map((a) => [targetKey({ kind: 'asset', id: a.id }), countOf(a)] as const)]);
	for (const pkg of invited) {
		if (declined.includes(pkg)) continue;
		const live = resolved.live.get(pkg) ?? [];
		if (chance(g, 30)) {
			packages.push({ package: pkg, total: amount(g, currency, 1_000_000) });
			for (const target of live) lines.push({ id: `l${j}-${targetKey(target)}`, target, total: money(0, currency), excluded: false, inPackage: true });
		} else {
			for (const target of live) {
				const line = lineOf(g, j, target, currency, counts.get(targetKey(target)) ?? 1);
				if (line) lines.push(line);
			}
		}
	}
	const costs: NonShotCost[] = Array.from({ length: int(g, 0, 2) }, (_, k) => ({
		kind: pickOne(g, COST_KINDS),
		label: `Cost ${k + 1}`,
		amount: amount(g, currency, 50_000),
		labour: chance(g, 50)
	}));
	const rough = [...lines.filter((l) => !l.excluded).map((l) => l.total.minor), ...packages.map((p) => p.total.minor)].reduce((a, b) => a + b, 0);
	return {
		id: uuid(3, j),
		requestId: request.id,
		vendorId: vendor.id,
		number: chance(g, 90) ? String(int(g, 1, 30)) : `A${int(g, 1, 9)}`,
		round: request.header.round,
		date: '2026-11-20',
		status: 'submitted',
		currency,
		rate: currency === base ? null : rate(currency, base, plainDecimal((USD_VALUE[currency] / USD_VALUE[base]) * (int(g, 8_000, 12_500) / 10_000)), '2026-11-20'),
		assumptions: [],
		exclusions: [],
		milestones: [],
		lines,
		costs,
		discount: adjustment(g, currency, rough, 30),
		tax: adjustment(g, currency, rough, 25),
		rebate: rebateOf(g, maxRate),
		...(packages.length > 0 ? { packages } : {}),
		...(declined.length > 0 ? { declined } : {})
	};
}

/** A scenario that holds together: a package priced as one figure goes whole, split rows sum to 100. */
function scenarioOf(g: G, request: BidRequest, bids: readonly VendorBid[]): AwardScenario {
	const resolved = resolvePackages(request);
	const picks: ScenarioPick[] = [];
	for (const pkg of resolved.packages) {
		const live = resolved.live.get(pkg.id) ?? [];
		const figures = bids.filter((b) => b.packages?.some((p) => p.package === pkg.id));
		if (figures.length > 0 && chance(g, 35)) {
			const winner = pickOne(g, figures);
			for (const target of live) picks.push({ target, shares: [{ bidId: winner.id, percent: '100' }] });
			continue;
		}
		for (const target of live) {
			const priced = bids.filter((b) => b.lines.some((l) => targetKey(l.target) === targetKey(target) && !l.excluded && !l.inPackage));
			if (priced.length === 0 || chance(g, 15)) continue;
			if (priced.length >= 2 && chance(g, 25)) {
				const first = int(g, 0, priced.length - 1);
				const second = (first + int(g, 1, priced.length - 1)) % priced.length;
				const part = int(g, 1, 99_999);
				picks.push({
					target,
					shares: [
						{ bidId: priced[first].id, percent: writePercent(part) },
						{ bidId: priced[second].id, percent: writePercent(100_000 - part) }
					]
				});
			} else picks.push({ target, shares: [{ bidId: pickOne(g, priced).id, percent: '100' }] });
		}
	}
	return { id: uuid(4, 0), requestId: request.id, name: 'Lowest', picks };
}

export function buildWorld(g: G, options: WorldOptions = {}): World {
	const packages = packagesOf(g);
	const { shots, assets } = rowsOf(g, packages, options.breakdown ?? true, options.counts ?? true);
	const vendors = vendorsOf(g, packages, options.maxVendors ?? 3);
	const request: BidRequest = {
		id: REQUEST_ID,
		header: { project: 'Test', round: 1, baseCurrency: pickOne(g, CODES), assumptions: [] },
		shots,
		assets,
		vendors,
		...(packages ? { packages } : {})
	};
	const bids = vendors.flatMap((v, j) => (chance(g, 85) ? [bidOf(g, j, request, v, options.maxRebateRate ?? 50)] : []));
	return { request, bids, scenario: scenarioOf(g, request, bids) };
}

export function worldArb(options: WorldOptions = {}): fc.Arbitrary<World> {
	return fc.array(fc.nat(), { minLength: TAPE, maxLength: TAPE }).map((values) => buildWorld(new Tape(values), options));
}

/** One bid with the request it answers. */
export function answerArb(options: WorldOptions = {}): fc.Arbitrary<{ request: BidRequest; bid: VendorBid }> {
	return fc
		.tuple(worldArb(options), fc.nat())
		.filter(([w]) => w.bids.length > 0)
		.map(([w, n]) => ({ request: w.request, bid: w.bids[n % w.bids.length] }));
}

// The Flow PT award, as a site would take it.

export const AWARD_SITE: FptSite = {
	projectId: 1180,
	bidType: 'CustomEntity14',
	lineType: 'CustomEntity15',
	vendorField: { Shot: 'sg_vendor_groups', Asset: 'sg_vendor_groups' },
	statuses: { draft: 'wtg', submitted: 'ip', awarded: 'fin', not_awarded: 'omt' }
};

const NOTHING_THERE: Existing = { bids: [], lines: [], groups: {} };

export function awardInput(world: World, allLines = false): AwardInput {
	return {
		request: world.request,
		bids: world.bids,
		scenario: world.scenario,
		options: {
			date: '2026-11-21',
			allLines,
			missing: { shot: 'without', asset: 'without' },
			appLinks: Object.fromEntries(world.bids.map((b) => [b.id, `https://bids.example.test/requests/${b.requestId}?bid=${b.id}`]))
		},
		site: AWARD_SITE,
		existing: NOTHING_THERE
	};
}

export const writes = (plan: AwardPlan): Write[] => plan.steps.flatMap((s) => s.writes);

/** The site after the plan is written: an id for each new row, the Groups added, an Attachment per link. */
export function apply(plan: AwardPlan): { existing: Existing; written: Written; bidIds: Map<string, number> } {
	let next = 1000;
	const bids: { key: string; id: number }[] = [];
	const lines: { key: string; id: number }[] = [];
	const groups: Record<string, number[]> = {};
	const added: Written['groups'][number][] = [];
	const attachments: { key: string; id: number }[] = [];
	for (const w of writes(plan)) {
		if (w.kind === 'create') (w.entity === 'bid' ? bids : lines).push({ key: w.key, id: next++ });
		else if (w.kind === 'addGroups') {
			const id = w.id as number;
			groups[`${w.itemType}:${id}`] = [...(groups[`${w.itemType}:${id}`] ?? []), ...w.groups];
			added.push({ itemType: w.itemType, id, field: w.field, groups: w.groups });
		} else if (w.kind === 'link') attachments.push({ key: w.key, id: next++ });
	}
	return {
		existing: { bids, lines, groups },
		written: {
			bids: bids.map((b) => ({ ...b, created: true })),
			lines: lines.map((l) => ({ ...l, created: true })),
			groups: added,
			attachments
		},
		bidIds: new Map(bids.map((b) => [b.key, b.id]))
	};
}

/** What production may know of a request before it deletes it: a draft, issued or closed, with an award or none. */
export const deletionFactsArb: fc.Arbitrary<DeletionFacts> = fc
	.record({
		n: fc.nat({ max: 999 }),
		title: fc.option(fc.constantFrom('Rooftop', 'Beach', 'Harbour', 'Night', 'Tunnel', ' '), { nil: null }),
		round: fc.integer({ min: 1, max: 4 }),
		status: fc.constantFrom<DeletionFacts['status']>('draft', 'issued', 'awarded', 'closed'),
		shots: fc.nat({ max: 40 }),
		assets: fc.nat({ max: 10 }),
		invitations: fc.nat({ max: 4 }),
		bids: fc.nat({ max: 6 }),
		scenarios: fc.nat({ max: 3 }),
		rates: fc.nat({ max: 3 }),
		award: fc.option(fc.constantFrom<NonNullable<DeletionFacts['award']>>('published', 'partial', 'undo_partial'), { nil: null, freq: 4 })
	})
	.map(({ n, ...f }) => ({ ...f, id: uuid(9, n), code: `BR-${n}`, vendors: f.bids > 0 ? VENDOR_NAMES.slice(0, Math.min(f.bids, VENDOR_NAMES.length)) : [] }));
