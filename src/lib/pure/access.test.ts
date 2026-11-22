import { describe, expect, it } from 'vitest';
import { allowed, scope, siteScope, stamp, TABLES, type Principal, type SitePrincipal, type Table } from './access';

const production: Principal = { kind: 'production', siteHost: 'studio.example.com', projectId: 70 };
const vendor: Principal = { kind: 'vendor', invitationId: 'inv-a', requestId: 'req-1' };
const tenant = { site_host: 'studio.example.com', project_id: 70 };

describe('production', () => {
	it('reads every table through its tenant, and nothing else', () => {
		for (const table of TABLES) {
			expect(scope(production, table, 'read').eq).toEqual(tenant);
		}
	});

	it('sees submitted and withdrawn bids, never a vendor draft', () => {
		expect(scope(production, 'bids', 'read').in).toEqual({ status: ['submitted', 'withdrawn'] });
	});

	it('writes requests, items, invitations, scenarios and awards in its tenant', () => {
		expect(scope(production, 'bid_requests', 'insert').eq).toEqual(tenant);
		expect(scope(production, 'bid_requests', 'update').eq).toEqual(tenant);
		expect(scope(production, 'request_items', 'insert').eq).toEqual(tenant);
		// A breakdown row gets its Flow PT row: the freeze in the database says when.
		expect(scope(production, 'request_items', 'update').eq).toEqual(tenant);
		expect(scope(production, 'invitations', 'insert').eq).toEqual(tenant);
		expect(scope(production, 'invitations', 'update').eq).toEqual(tenant);
		expect(scope(production, 'award_scenarios', 'update').eq).toEqual(tenant);
		expect(scope(production, 'award_scenario_items', 'delete').eq).toEqual(tenant);
		expect(scope(production, 'awards', 'insert').eq).toEqual(tenant);
		expect(scope(production, 'bid_rates', 'update').eq).toEqual(tenant);
	});

	it('never writes a bid or a bid line', () => {
		for (const action of ['insert', 'update', 'delete'] as const) {
			expect(allowed(production, 'bids', action)).toBe(false);
			expect(allowed(production, 'bid_lines', action)).toBe(false);
			expect(() => scope(production, 'bids', action)).toThrow();
		}
	});

	it('deletes a request only in its tenant, and an invitation only in its tenant', () => {
		expect(scope(production, 'bid_requests', 'delete').eq).toEqual(tenant);
		expect(scope(production, 'invitations', 'delete').eq).toEqual(tenant);
	});

	it('reads and writes its own bids and their rows, in its tenant', () => {
		for (const table of ['production_bids', 'production_bid_items'] as const) {
			for (const action of ['read', 'insert', 'update', 'delete'] as const) expect(scope(production, table, action).eq).toEqual(tenant);
		}
	});

	it('refuses a principal with no tenant', () => {
		expect(() => scope({ kind: 'production', siteHost: '', projectId: 70 }, 'bid_requests', 'read')).toThrow();
		expect(() => scope({ kind: 'production', siteHost: 'a.example.com', projectId: 0 }, 'bid_requests', 'read')).toThrow();
		expect(() => scope({ kind: 'production', siteHost: 'a.example.com', projectId: 1.5 }, 'bid_requests', 'read')).toThrow();
	});
});

describe('vendor', () => {
	it('reads its own invitation by id, and may only stamp it opened', () => {
		expect(scope(vendor, 'invitations', 'read').eq).toEqual({ id: 'inv-a' });
		expect(scope(vendor, 'invitations', 'update').eq).toEqual({ id: 'inv-a' });
		expect(allowed(vendor, 'invitations', 'insert')).toBe(false);
		expect(allowed(vendor, 'invitations', 'delete')).toBe(false);
	});

	it('reads the request it was invited to, once issued, and its items', () => {
		expect(scope(vendor, 'bid_requests', 'read')).toEqual({ eq: { id: 'req-1' }, in: { status: ['issued', 'awarded', 'closed'] } });
		expect(scope(vendor, 'request_items', 'read').eq).toEqual({ request_id: 'req-1' });
		expect(allowed(vendor, 'bid_requests', 'update')).toBe(false);
		expect(allowed(vendor, 'request_items', 'insert')).toBe(false);
	});

	it('reads and writes only bids and lines under its own invitation', () => {
		for (const table of ['bids', 'bid_lines'] as const) {
			for (const action of ['read', 'insert', 'update'] as const) {
				expect(scope(vendor, table, action).eq).toEqual({ invitation_id: 'inv-a' });
			}
		}
		// A discarded draft, under its own invitation. The database refuses a submitted bid.
		expect(scope(vendor, 'bids', 'delete').eq).toEqual({ invitation_id: 'inv-a' });
	});

	it('never reaches scenarios, awards or rates', () => {
		const hidden: Table[] = ['production_bids', 'production_bid_items', 'award_scenarios', 'award_scenario_items', 'awards', 'award_publications', 'bid_rates'];
		for (const table of hidden) {
			for (const action of ['read', 'insert', 'update', 'delete'] as const) {
				expect(allowed(vendor, table, action)).toBe(false);
			}
		}
	});

	it('never filters by tenant, so it can never widen to the whole project', () => {
		for (const table of TABLES) {
			if (!allowed(vendor, table, 'read')) continue;
			const { eq } = scope(vendor, table, 'read');
			expect(Object.keys(eq)).not.toContain('site_host');
			expect(Object.keys(eq)).not.toContain('project_id');
		}
	});

	it('reads the rows and packages of its packages alone, when invited to some', () => {
		const some = { ...vendor, packages: ['p1', 'p3'] };
		expect(scope(some, 'request_items', 'read')).toEqual({ eq: { request_id: 'req-1' }, in: { package_key: ['p1', 'p3'] } });
		expect(scope(some, 'request_packages', 'read')).toEqual({ eq: { request_id: 'req-1' }, in: { key: ['p1', 'p3'] } });
		expect(scope({ ...vendor, packages: [] }, 'request_items', 'read').in).toEqual({ package_key: [] });
		expect(scope(vendor, 'request_packages', 'read')).toEqual({ eq: { request_id: 'req-1' } });
		expect(allowed(some, 'request_packages', 'insert')).toBe(false);
	});

	it('refuses a principal with no invitation', () => {
		expect(() => scope({ kind: 'vendor', invitationId: '', requestId: 'req-1' }, 'bids', 'read')).toThrow();
		expect(() => scope({ kind: 'vendor', invitationId: 'inv-a', requestId: '' }, 'bids', 'read')).toThrow();
	});
});

describe('stamp', () => {
	it('forces the scope onto a row to insert, whatever the row said', () => {
		const row = { code: 'BR-1', site_host: 'evil.example.com', project_id: 1 };
		expect(stamp(row, scope(production, 'bid_requests', 'insert'))).toEqual({ code: 'BR-1', ...tenant });
	});
});

describe('production across its readable projects', () => {
	const site: SitePrincipal = { kind: 'production-site', siteHost: 'studio.example.com', projectIds: [70, 91] };

	it('reads requests, invitations and bids of its site, in the projects it was verified for only', () => {
		expect(siteScope(site, 'bid_requests')).toEqual({ eq: { site_host: 'studio.example.com' }, in: { project_id: [70, 91] } });
		expect(siteScope(site, 'invitations')).toEqual({ eq: { site_host: 'studio.example.com' }, in: { project_id: [70, 91] } });
	});

	it('sees submitted and withdrawn bids, never a vendor draft', () => {
		expect(siteScope(site, 'bids')).toEqual({ eq: { site_host: 'studio.example.com' }, in: { project_id: [70, 91], status: ['submitted', 'withdrawn'] } });
	});

	it('reads production bids and the requests they are in, in its projects only', () => {
		expect(siteScope(site, 'production_bids')).toEqual({ eq: { site_host: 'studio.example.com' }, in: { project_id: [70, 91] } });
		expect(siteScope(site, 'request_packages')).toEqual({ eq: { site_host: 'studio.example.com' }, in: { project_id: [70, 91] } });
	});

	it('reads an issued request’s rows, for the list’s totals, in its projects only', () => {
		expect(siteScope(site, 'request_items')).toEqual({ eq: { site_host: 'studio.example.com' }, in: { project_id: [70, 91] } });
	});

	it('reads nothing else: no draft rows, no lines, no scenarios, no awards, no rates', () => {
		for (const table of ['production_bid_items', 'bid_lines', 'award_scenarios', 'award_scenario_items', 'awards', 'award_publications', 'bid_rates'] as Table[]) {
			expect(() => siteScope(site, table)).toThrow();
		}
	});

	it('refuses a principal with no site, or a project id that is not one', () => {
		expect(() => siteScope({ ...site, siteHost: '' }, 'bid_requests')).toThrow();
		expect(() => siteScope({ ...site, projectIds: [70, 0] }, 'bid_requests')).toThrow();
		expect(() => siteScope({ ...site, projectIds: [1.5] }, 'bid_requests')).toThrow();
	});

	it('copies the list, so a caller cannot widen it after the check', () => {
		const ids = [70];
		const given = siteScope({ ...site, projectIds: ids }, 'bid_requests');
		ids.push(99);
		expect(given.in?.project_id).toEqual([70]);
	});

	it('is no production principal: scope refuses it', () => {
		expect(() => scope(site as unknown as Principal, 'bid_requests', 'read')).toThrow();
	});
});
