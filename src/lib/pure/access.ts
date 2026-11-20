/**
 * Who may touch which table, and the exact filter they must use.
 *
 * The server builds a principal from what it verified itself, never from what the client says:
 *
 * - production: the Flow PT site host and project id of a session the site accepted;
 * - vendor: the invitation (and its request) found by the hash of the link token.
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
}

export type Principal = ProductionPrincipal | VendorPrincipal;

/**
 * Production across a site: the projects the person's own bearer listed on that site, verified by
 * the server (`production.ts`). It only reads, and only for the requests list. It is no
 * `Principal`: `scope` refuses it, `siteScope` gives its filter.
 */
export interface SitePrincipal {
	readonly kind: 'production-site';
	readonly siteHost: string;
	readonly projectIds: readonly number[];
}

export const TABLES = [
	'bid_requests',
	'request_items',
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
	// Delete is whole, through `sg_delete_request`: the request and everything under it.
	bid_requests: ['read', 'insert', 'update', 'delete'],
	request_items: ['read', 'insert', 'update', 'delete'],
	invitations: ['read', 'insert', 'update'],
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
	request_items: ['read'],
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
		case 'request_items':
			return { eq: { request_id: principal.requestId } };
		case 'invitations':
			return { eq: { id: principal.invitationId } };
		default:
			return { eq: { invitation_id: principal.invitationId } };
	}
}

/** The tables the requests list reads across projects: the requests and their counts. */
const SITE_READS: readonly Table[] = ['bid_requests', 'invitations', 'bids'];

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
