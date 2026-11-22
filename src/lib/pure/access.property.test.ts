import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scope, siteScope, stamp, TABLES, type Action, type Scope, type Table, type VendorPrincipal } from './access';
import { uuid, worldArb, type World } from './arbitraries';
import { targetKey } from './model';
import { bidToRows, headerToColumns, itemsToRows, packagesToRows, requestFromRows, type RequestRow } from './rows';
import { vendorKeys } from './vendor-keys';
import { vendorBidView, vendorRequestView } from './vendor-view';

type Row = Record<string, unknown>;

/** What the database answers a query that carries the scope: every `eq`, every `in`. */
function where(rows: readonly Row[], given: Scope): Row[] {
	return rows.filter(
		(row) => Object.entries(given.eq).every(([column, value]) => row[column] === value) && Object.entries(given.in ?? {}).every(([column, values]) => values.includes(row[column] as string | number))
	);
}

const HOST = 'studio.shotgrid.autodesk.com';
const PROJECT = 1180;
const OTHER_REQUEST = uuid(1, 1);

/** The request's tables as stored, beside another request's rows on the same site. */
function tables(world: World) {
	const { request, bids } = world;
	const tenant = { site_host: HOST, project_id: PROJECT };
	const ownItems = itemsToRows(request.shots, request.assets).map((r, i) => ({ ...r, ...tenant, id: uuid(6, i), request_id: request.id }));
	const otherItems = itemsToRows(request.shots, request.assets).map((r, i) => ({ ...r, ...tenant, id: uuid(7, i), request_id: OTHER_REQUEST }));
	const packages = packagesToRows(request.packages ?? []).map((p, i) => ({ ...p, ...tenant, id: uuid(8, i), request_id: request.id, position: i }));
	const bidRows = bids.map((b) => ({ ...bidToRows(b, request.header.baseCurrency).bid, ...tenant, id: b.id, invitation_id: b.vendorId, request_id: request.id, version: 1, status: b.status }));
	const lineRows = bids.flatMap((b) => bidToRows(b, request.header.baseCurrency).lines.map((l, i) => ({ ...l, ...tenant, id: `${b.id}-${i}`, bid_id: b.id, invitation_id: b.vendorId, request_id: request.id })));
	const requestRow: RequestRow = { ...headerToColumns(request.header), ...tenant, id: request.id, code: 'R1', status: 'issued', issued_at: null, closed_at: null, created_at: '', updated_at: '' };
	return { items: [...ownItems, ...otherItems], packages, bids: bidRows, lines: lineRows, requests: [requestRow, { ...requestRow, id: OTHER_REQUEST }] as unknown as Row[] };
}

const invitedArb = worldArb().chain((world) => fc.nat({ max: world.request.vendors.length - 1 }).map((j) => ({ world, vendor: world.request.vendors[j] })));

describe('a vendor’s view, for any request and invitation', () => {
	it('holds no row, bid, figure or id outside the invitation’s bids', () => {
		fc.assert(
			fc.property(invitedArb, ({ world, vendor }) => {
				const t = tables(world);
				const principal: VendorPrincipal = { kind: 'vendor', invitationId: vendor.id, requestId: world.request.id, packages: vendor.packages ?? null };
				const invited = (pkg: unknown) => !vendor.packages || vendor.packages.includes(pkg as string);

				const items = where(t.items, scope(principal, 'request_items', 'read'));
				for (const row of items) {
					expect(row.request_id).toBe(world.request.id);
					expect(invited(row.package_key)).toBe(true);
				}
				const packages = where(t.packages, scope(principal, 'request_packages', 'read'));
				for (const row of packages) expect(invited(row.key)).toBe(true);
				const [requestRow] = where(t.requests, scope(principal, 'bid_requests', 'read')) as unknown as RequestRow[];
				expect(requestRow.id).toBe(world.request.id);
				for (const table of ['bids', 'lines'] as const) {
					for (const row of where(t[table], scope(principal, table === 'bids' ? 'bids' : 'bid_lines', 'read'))) expect(row.invitation_id).toBe(vendor.id);
				}

				// The view the link answers, from what the store read.
				const keys = vendorKeys(items.map((r) => ({ kind: r.kind as 'shot' | 'asset', key: r.key as string, id: r.id as string })));
				const request = requestFromRows(requestRow, items as never, [], packages as never);
				const view = vendorRequestView({ invitation: vendor, request, code: 'R1', status: 'issued', issuedAt: null, expiresAt: '2027-01-01', keys });
				const rowIds = new Set(items.map((r) => r.id));
				for (const row of [...view.shots, ...view.assets]) {
					expect(invited(row.package)).toBe(true);
					expect(rowIds.has(row.id)).toBe(true);
					expect(row).not.toHaveProperty('fpt');
					expect(row).not.toHaveProperty('source');
				}
				for (const p of view.packages) expect(invited(p.id)).toBe(true);
				const text = JSON.stringify(view);
				for (const stored of [...world.request.shots, ...world.request.assets]) expect(text).not.toContain(`"${stored.id}"`);
				for (const other of world.request.vendors.filter((v) => v.id !== vendor.id)) {
					expect(text).not.toContain(other.id);
					expect(text).not.toContain(other.name);
				}
				expect(text).not.toContain(world.request.id);

				// Its own bids, read back with its keys: every line names a row it may see.
				const own = world.bids.filter((b) => b.vendorId === vendor.id);
				const bidView = vendorBidView(own.map((bid) => ({ bid, version: 1, submittedAt: null, withdrawnAt: null })), keys);
				for (const line of bidView.bid?.lines ?? []) expect(rowIds.has(line.target.id)).toBe(true);
				const visible = new Set(items.map((r) => `${r.kind}:${r.key}`));
				for (const b of own) expect(b.lines.every((l) => visible.has(targetKey(l.target)))).toBe(true);
			})
		);
	});
});

describe('production’s filter, for any site, project, table and action', () => {
	const hosts = ['studio.shotgrid.autodesk.com', 'rival.shotgrid.autodesk.com', 'studio.shotgrid.autodesk.co'];
	const projects = [1180, 1181, 22];
	const mixed: Row[] = hosts.flatMap((site_host) => projects.map((project_id) => ({ site_host, project_id, status: 'submitted' })));
	const arb = fc.record({
		host: fc.constantFrom(...hosts),
		project: fc.constantFrom(...projects),
		table: fc.constantFrom<Table>(...TABLES),
		action: fc.constantFrom<Action>('read', 'insert', 'update', 'delete')
	});

	it('never crosses its site host or project', () => {
		fc.assert(
			fc.property(arb, ({ host, project, table, action }) => {
				let given: Scope;
				try {
					given = scope({ kind: 'production', siteHost: host, projectId: project }, table, action);
				} catch {
					return; // Not allowed: refused outright.
				}
				expect(given.eq).toMatchObject({ site_host: host, project_id: project });
				const seen = where(mixed, given);
				expect(seen).toEqual([{ site_host: host, project_id: project, status: 'submitted' }]);
				expect(stamp({ site_host: 'forged.test', project_id: 9, name: 'x' }, given)).toMatchObject({ site_host: host, project_id: project });
			})
		);
	});

	it('across a site, reads only its own host and the projects it was verified for', () => {
		const siteArb = fc.record({ host: fc.constantFrom(...hosts), ids: fc.subarray(projects), table: fc.constantFrom<Table>(...TABLES) });
		fc.assert(
			fc.property(siteArb, ({ host, ids, table }) => {
				let given: Scope;
				try {
					given = siteScope({ kind: 'production-site', siteHost: host, projectIds: ids }, table);
				} catch {
					return;
				}
				for (const row of where(mixed, given)) {
					expect(row.site_host).toBe(host);
					expect(ids).toContain(row.project_id);
				}
			})
		);
	});
});

