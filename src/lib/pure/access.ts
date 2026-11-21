/**
 * Who may touch which table, and the exact filter they must use.
 *
 * The server builds a principal from what it verified itself, never from what the client says:
 *
 * - production: the Flow PT site host and project id of a session the site accepted. Its bids
 *   (`production_bids`) are its own: a vendor reads none of them, only what a request issued;
 * - vendor: the invitation (and its request) found by the hash of the link token, and the packages
 *   the invitation names: a vendor reads the rows and packages of those alone (`packages.ts`).
 *
 * `scope` answers the filter every query of that action carries: column equals value, and for a
 * few reads a status list. For an insert, `stamp` forces the same columns onto the row. Every row
 * carries `site_host` and `project_id`, and every row under an invitation carries
 * `invitation_id`, so one equality is enough for each table. Anything not listed is refused.
 */

export interface ProductionPrincipal {
	readonly kind: 'production';
	readonly siteHost: string;
	readonly projectId: number;
}

export interface VendorPrincipal {
	readonly kind: 'vendor';
	readonly invitationId: string;
	/** The invitation's request, read from the invitation's row. */
	readonly requestId: string;
	/** The packages the invitation names, read from its row. Null or absent: every package. */
	readonly packages?: readonly string[] | null;
}

export type Principal = ProductionPrincipal | VendorPrincipal;

/**
 * Production across a site: the projects the person's own bearer listed on that site, verified by
 * the server (`production.ts`). It only reads, and only for the requests and bids lists. It is no
 * `Principal`: `scope` refuses it, `siteScope` gives its filter.
 */
export interface SitePrincipal {
	readonly kind: 'production-site';
	readonly siteHost: string;
	readonly projectIds: readonly number[];
}

export const TABLES = [
	'production_bids',
	'production_bid_items',
	'bid_requests',
	'request_items',
	'request_packages',
	'invitations',
	'bids',
	'bid_lines',
	'award_scenarios',
	'award_scenario_items',
	'awards',
	'award_publications',
	'bid_rates'
] as const;

export type Table = (typeof TABLES)[number];

/**
 * Tables no principal reads: `withdrawn_links` holds the hashes of the link tokens of deleted
 * requests, looked up by a token's own hash alone, so a dead link says the request was withdrawn.
 */
export const LINK_TABLES = ['withdrawn_links'] as const;

/** Every table in `public`. */
export const ALL_TABLES = [...TABLES, ...LINK_TABLES] as const;
export type Action = 'read' | 'insert' | 'update' | 'delete';

export interface Scope {
	/** Every query carries `column = value` for each entry. */
	readonly eq: Readonly<Record<string, string | number>>;
	/** And `column in (values)` for each entry. */
	readonly in?: Readonly<Record<string, readonly (string | number)[]>>;
}

type Grants = Readonly<Partial<Record<Table, readonly Action[]>>>;

const PRODUCTION: Grants = {
	// A draft request's bids and their rows, written by `sg_save_draft` and read through its request.
	production_bids: ['read', 'insert', 'update', 'delete'],
	production_bid_items: ['read', 'insert', 'update', 'delete'],
	// Delete is whole, through `sg_delete_request`: the request and everything under it.
	bid_requests: ['read', 'insert', 'update', 'delete'],
	request_items: ['read', 'insert', 'update', 'delete'],
	// Written with the items, by `sg_save_request_items`.
	request_packages: ['read', 'insert', 'update', 'delete'],
	// Delete is a vendor added to a draft whose link was never made (`link_pending`).
	invitations: ['read', 'insert', 'update', 'delete'],
	bids: ['read'],
	bid_lines: ['read'],
	award_scenarios: ['read', 'insert', 'update', 'delete'],
	award_scenario_items: ['read', 'insert', 'delete'],
	awards: ['read', 'insert', 'update'],
	// What the award wrote to Flow PT. Written by `sg_record_award` and `sg_clear_award` only.
	award_publications: ['read'],
	// Production's rate per bid, to the base currency. The database locks it at the award.
	bid_rates: ['read', 'insert', 'update', 'delete']
};

const VENDOR: Grants = {
	bid_requests: ['read'],
	// Of the vendor's packages only.
	request_items: ['read'],
	request_packages: ['read'],
	// Update is the opened stamp only; the store writes no other column.
	invitations: ['read', 'update'],
	// Delete is the vendor's own draft, discarded. The database refuses a submitted bid.
	bids: ['read', 'insert', 'update', 'delete'],
	bid_lines: ['read', 'insert', 'update', 'delete']
};

export function allowed(principal: Principal, table: Table, action: Action): boolean {
	const grants = principal.kind === 'production' ? PRODUCTION : VENDOR;
	return grants[table]?.includes(action) ?? false;
}

function check(principal: Principal): void {
	if (principal.kind === 'production') {
		if (!principal.siteHost) throw new Error('A production principal needs a site host.');
		if (!Number.isSafeInteger(principal.projectId) || principal.projectId <= 0) {
			throw new Error('A production principal needs a project id.');
		}
	} else if (!principal.invitationId || !principal.requestId) {
		throw new Error('A vendor principal needs its invitation and request.');
	}
}

/** The filter `action` on `table` must carry for `principal`. Throws when the action is not allowed. */
export function scope(principal: Principal, table: Table, action: Action): Scope {
	check(principal);
	if (!allowed(principal, table, action)) {
		throw new Error(`A ${principal.kind} may not ${action} ${table}.`);
	}
	if (principal.kind === 'production') {
		const eq = { site_host: principal.siteHost, project_id: principal.projectId };
		// A vendor's draft is its own until it submits.
		if (table === 'bids' && action === 'read') return { eq, in: { status: ['submitted', 'withdrawn'] } };
		return { eq };
	}
	switch (table) {
		case 'bid_requests':
			return { eq: { id: principal.requestId }, in: { status: ['issued', 'awarded', 'closed'] } };
		// A vendor invited to some packages reads their rows and themselves alone. An empty list reads nothing.
		case 'request_items':
			return principal.packages ? { eq: { request_id: principal.requestId }, in: { package_key: [...principal.packages] } } : { eq: { request_id: principal.requestId } };
		case 'request_packages':
			return principal.packages ? { eq: { request_id: principal.requestId }, in: { key: [...principal.packages] } } : { eq: { request_id: principal.requestId } };
		case 'invitations':
			return { eq: { id: principal.invitationId } };
		default:
			return { eq: { invitation_id: principal.invitationId } };
	}
}

/**
 * The tables the lists read across projects: the requests and their counts, the bids and the
 * requests each is in, and an issued request's rows for its totals (a draft's are on its bids).
 */
const SITE_READS: readonly Table[] = ['bid_requests', 'invitations', 'bids', 'production_bids', 'request_packages', 'request_items'];

/**
 * The filter a read across the site carries: its site host, and the project ids it was verified
 * for. An empty list matches no row. Throws for any table the list does not need.
 */
export function siteScope(principal: SitePrincipal, table: Table): Scope {
	if (principal.kind !== 'production-site' || !principal.siteHost) throw new Error('A site principal needs a site host.');
	if (!principal.projectIds.every((id) => Number.isSafeInteger(id) && id > 0)) throw new Error('A site principal needs project ids.');
	if (!SITE_READS.includes(table)) throw new Error(`Production across a site may not read ${table}.`);
	const projects = [...principal.projectIds];
	const eq = { site_host: principal.siteHost };
	// A vendor's draft is its own until it submits.
	if (table === 'bids') return { eq, in: { project_id: projects, status: ['submitted', 'withdrawn'] } };
	return { eq, in: { project_id: projects } };
}

/** The row to insert with the scope's columns forced onto it. */
export function stamp<T extends object>(row: T, given: Scope): T & Scope['eq'] {
	return { ...row, ...given.eq };
}
