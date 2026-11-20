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
export type Action = 'read' | 'insert' | 'update' | 'delete';

export interface Scope {
	/** Every query carries `column = value` for each entry. */
	readonly eq: Readonly<Record<string, string | number>>;
	/** And `column in (values)` for each entry. */
	readonly in?: Readonly<Record<string, readonly string[]>>;
}

type Grants = Readonly<Partial<Record<Table, readonly Action[]>>>;

const PRODUCTION: Grants = {
	bid_requests: ['read', 'insert', 'update'],
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
	bids: ['read', 'insert', 'update'],
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

/** The row to insert with the scope's columns forced onto it. */
export function stamp<T extends object>(row: T, given: Scope): T & Scope['eq'] {
	return { ...row, ...given.eq };
}
