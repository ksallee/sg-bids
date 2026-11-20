/**
 * The data the app rests on: a bid request, the vendors' bids, the award and the change orders.
 * There is no industry standard. The fields follow the existing bid tools; `docs/data-model.md`
 * lists each one with the tools it appears in.
 *
 * Money is `money.ts`: whole minor units with an ISO 4217 code. A percent is a plain decimal
 * string, as typed (`39`, `12.5`), read by `percent.ts`. A day is `YYYY-MM-DD`. Ids are opaque
 * strings.
 */

import type { Money, Rate } from './money';

export type Id = string;

/** A day, `YYYY-MM-DD`. */
export type Day = string;

/** A percent as typed, a plain non-negative decimal: `65` is 65%. */
export type Percent = string;

/** A Flow Production Tracking entity: `{ type: 'Shot', id: 1234 }`. */
export interface EntityRef {
	readonly type: string;
	readonly id: number;
}

/** One amount in the bid's currency and in the request's base currency. */
export interface Dual {
	readonly bid: Money;
	readonly base: Money;
}

/** What a line, an award or a pick is for: one shot or one asset of the request. */
export type Target = { readonly kind: 'shot'; readonly id: Id } | { readonly kind: 'asset'; readonly id: Id };

/** A key that names a target in a map: `shot:sh010`. */
export function targetKey(target: Target): string {
	return `${target.kind}:${target.id}`;
}

// The bid request: what production sends.

export interface BidRequest {
	readonly id: Id;
	readonly header: RequestHeader;
	readonly shots: readonly RequestShot[];
	readonly assets: readonly RequestAsset[];
	readonly vendors: readonly InvitedVendor[];
}

export interface RequestHeader {
	/** Production's own reference for the request: `SHOW_R1`. */
	readonly code?: string;
	readonly title?: string;
	readonly project: string;
	readonly projectRef?: EntityRef;
	readonly studio?: string;
	readonly director?: string;
	readonly clientSupervisor?: string;
	readonly clientProducer?: string;
	/** The script or cut the shots come from. */
	readonly cutVersion?: string;
	/** 1 for the first round. A change order opens the next. */
	readonly round: number;
	readonly dueDate?: Day;
	/** The currency production compares and awards in. Each vendor bids in its own. */
	readonly baseCurrency: string;
	readonly turnoverWeek?: string;
	/** When the plates and material are turned over to the vendor. */
	readonly turnoverDate?: Day;
	readonly deliveryDate?: Day;
	readonly deliveryFormat?: string;
	/** A link to the bid material: cut, script, boards. */
	readonly materialLink?: string;
	readonly assumptions: readonly string[];
}

export interface RequestShot {
	readonly id: Id;
	readonly code: string;
	readonly fpt?: EntityRef;
	readonly description?: string;
	readonly episode?: string;
	readonly sequence?: string;
	readonly scene?: string;
	readonly page?: string;
	readonly type?: string;
	readonly difficulty?: string;
	readonly cutCount?: number;
	readonly frames?: number;
	readonly omitted: boolean;
	/** Ids of the request's assets the shot uses. */
	readonly assetIds: readonly Id[];
	readonly thumbnail?: string;
	readonly directorNotes?: string;
	/** Production's note to the vendors on this shot. */
	readonly notes?: string;
	/** Tech requirements by department name. */
	readonly techRequirements?: Readonly<Record<string, string>>;
}

export interface RequestAsset {
	readonly id: Id;
	readonly name: string;
	readonly fpt?: EntityRef;
	readonly description?: string;
	readonly type?: string;
	readonly difficulty?: string;
	readonly timesUsed?: number;
	/** The asset is out. Absent means in. */
	readonly omitted?: boolean;
	/** Production's note to the vendors on this asset. */
	readonly notes?: string;
}

export interface InvitedVendor {
	readonly id: Id;
	readonly name: string;
	/** The vendor's Group in FPT, written to the shot at award. */
	readonly fpt?: EntityRef;
	readonly email: string;
	readonly ndaFile?: string;
	readonly ndaExecuted: boolean;
	/** Trusted Partner Network status, as typed. */
	readonly tpn?: string;
	readonly capacity?: string;
}

// The vendor bid: what a vendor answers, once per round.

export type BidStatus = 'draft' | 'submitted' | 'awarded' | 'not_awarded' | 'withdrawn';

export interface VendorBid {
	readonly id: Id;
	readonly requestId: Id;
	readonly vendorId: Id;
	/** The vendor's own bid number. */
	readonly number: string;
	/** The request round this bid answers. */
	readonly round: number;
	readonly date: Day;
	readonly status: BidStatus;
	/** Every amount in the bid is in this currency. */
	readonly currency: string;
	/**
	 * From the bid currency to the request's base currency, locked with its date. Null only when
	 * the two are the same.
	 */
	readonly rate: Rate | null;
	readonly validUntil?: Day;
	readonly assumptions: readonly string[];
	readonly exclusions: readonly string[];
	readonly milestones: readonly PaymentMilestone[];
	readonly lines: readonly BidLine[];
	readonly costs: readonly NonShotCost[];
	readonly discount: Adjustment | null;
	readonly tax: Adjustment | null;
	readonly rebate: readonly RebateSplit[];
}

export interface PaymentMilestone {
	readonly label: string;
	readonly percent: Percent;
	/** A day or an event, as typed: `on turnover`. */
	readonly due?: string;
}

/** One line per shot or asset. */
export interface BidLine {
	readonly id: Id;
	readonly target: Target;
	/** The price of the line, all in: departments, compute and markup. Ignored when excluded. */
	readonly total: Money;
	/** Days and cost per department. Optional: many vendors give only a total. */
	readonly departments?: readonly DepartmentCost[];
	/** Render and cloud cost, inside the total. Not labour. */
	readonly compute?: Money;
	/** Markup, inside the total. */
	readonly markup?: Money;
	readonly notes?: string;
	/** How the vendor plans to do the work. */
	readonly methodology?: string;
	readonly elementsNeeded?: string;
	readonly startWeek?: string;
	/** The vendor will not do this shot or asset. */
	readonly excluded: boolean;
}

export interface DepartmentCost {
	readonly department: string;
	/** Days as a plain decimal string. */
	readonly days?: string;
	readonly cost?: Money;
}

export type NonShotCostKind = 'overhead' | 'supervision' | 'on_set' | 'contingency' | 'other';

export interface NonShotCost {
	readonly kind: NonShotCostKind;
	readonly label: string;
	readonly amount: Money;
	/** Whether the cost counts toward a rebate's labour base. Set by the vendor, never guessed. */
	readonly labour: boolean;
}

/** A discount or a tax: an amount, or a percent of the subtotal. */
export type Adjustment =
	| { readonly kind: 'amount'; readonly amount: Money }
	| { readonly kind: 'percent'; readonly percent: Percent };

// Rebates: several jurisdictions per bid, at bid level.

/**
 * What a rebate rate applies to. `all` is the bid before tax. `labour` is the labour part only.
 * `contract` is a fixed percent of the bid before tax, as Quebec's 65% of a service contract.
 */
export type RebateBase =
	| { readonly kind: 'all' }
	| { readonly kind: 'labour' }
	| { readonly kind: 'contract'; readonly percent: Percent };

export interface RebateSplit {
	/** ISO 3166 code: `GB`, `CA-BC`. */
	readonly jurisdiction: string;
	/** The share of the work done there. Splits sum to 100 at most. */
	readonly workPercent: Percent;
	readonly rate: Percent;
	readonly base: RebateBase;
}

// The award and its scenarios.

/** One per shot or asset per vendor. A split shot has two. */
export interface Award {
	readonly id: Id;
	readonly requestId: Id;
	readonly target: Target;
	readonly vendorId: Id;
	readonly bidId: Id;
	/** The round of the bid awarded. */
	readonly bidRound: number;
	readonly amount: Dual;
	readonly rate: Rate | null;
	readonly date: Day;
	readonly poNumber?: string;
}

/** A named per-shot pick of vendors, to compare splits before awarding. */
export interface AwardScenario {
	readonly id: Id;
	readonly requestId: Id;
	readonly name: string;
	readonly picks: readonly ScenarioPick[];
}

/** The bids picked for one shot or asset. One share of 100, or several for a split shot. */
export interface ScenarioPick {
	readonly target: Target;
	readonly shares: readonly { readonly bidId: Id; readonly percent: Percent }[];
}

// The change order: a new round.

export type ChangeOrderStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface ChangeOrder {
	readonly id: Id;
	readonly requestId: Id;
	readonly vendorId: Id;
	readonly number: string;
	readonly status: ChangeOrderStatus;
	readonly reason: string;
	/** The round it opens. */
	readonly round: number;
	/** The vendor's bid for that round. */
	readonly bidId: Id;
	/** The new round's total minus the awarded one. */
	readonly delta: Dual;
	readonly added: readonly Target[];
	readonly omitted: readonly Target[];
	readonly approval?: { readonly by: string; readonly date: Day };
}
