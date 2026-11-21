/**
 * Whether the chosen scenario may be published to Flow PT, and what must happen first. Pure, no I/O.
 * The site facts come from the setup report (`fpt-setup.ts`, recipe 029); the writes from
 * `fpt-award.ts`.
 *
 * What blocks: no chosen scenario; Bid or Bid Line not enabled; a field missing or of the wrong
 * type; no vendor groups field on a type the scenario awards; a bid in another currency with no
 * rate; a vendor with no Group and no choice made; awarded rows with no Flow PT row and no choice
 * made for their kind (create them, or publish their Bid Lines without an item). Each problem says
 * where on the page, or which page, fixes it.
 *
 * What asks first: the Vendor role can read Bid or Bid Line, or its rights could not be read. A
 * vendor with a Flow PT login then reads every bid in the project (163), and a see rule leaks (165).
 * Publishing stays possible only after "publish anyway", and that choice is recorded.
 */

import type { FptSite, MissingChoice, MissingOptions } from './fpt-award';
import { ENTITY_NAMES } from './fpt-fields';
import type { Access, SetupReport } from './fpt-setup';
import { targetKey, type AwardScenario, type BidRequest, type EntityRef, type Id, type VendorBid } from './model';

export interface GateInput {
	readonly projectId: number;
	/** Null while the site is being read. */
	readonly report: SetupReport | null;
	readonly request: BidRequest;
	/** The bids the comparison shows, production's rate on each. */
	readonly bids: readonly VendorBid[];
	/** The chosen scenario. */
	readonly scenario: AwardScenario | null;
	/** Write every line of every bid, and a Bid for every vendor. */
	readonly allLines: boolean;
	/** Choices made here, per vendor id: a Group id, or null to publish without one. */
	readonly groups: Readonly<Record<Id, number | null>>;
	readonly exposureAccepted: boolean;
	/** What to do with awarded rows that have no Flow PT row, per kind. */
	readonly missing?: MissingOptions;
}

/** One reason publishing is blocked, and where on the page, or which page, fixes it. */
export interface GateProblem {
	readonly message: string;
	/** The id of the part of the publish page that fixes it. */
	readonly target: string;
	/** Another page that fixes it. */
	readonly href?: string;
}

/** Awarded rows with no Flow PT row, by kind, and the choice made for them. */
export interface MissingRows {
	readonly labels: readonly string[];
	readonly choice: MissingChoice | null;
}

export type GroupSource = 'invitation' | 'picked' | 'none' | 'undecided';

export interface GateVendor {
	readonly vendorId: Id;
	readonly name: string;
	/** The invitation's Group. */
	readonly invited: EntityRef | null;
	readonly source: GroupSource;
	/** The Group the award writes, null for none or undecided. */
	readonly group: number | null;
	/** It wins at least one row. */
	readonly awarded: boolean;
}

export type Exposure =
	| { readonly state: 'safe' }
	| { readonly state: 'exposed' | 'unknown'; readonly lines: readonly string[]; readonly adminSteps: readonly string[] };

export interface Gate {
	/** The bids the award writes a Bid for. */
	readonly bids: readonly VendorBid[];
	readonly site: FptSite | null;
	readonly vendors: readonly GateVendor[];
	/** Each reason publishing is blocked, in plain words. */
	readonly blockers: readonly string[];
	/** The same, each with where it is fixed. */
	readonly problems: readonly GateProblem[];
	readonly missing: { readonly shot: MissingRows; readonly asset: MissingRows };
	/** Fields missing on Bid and Bid Line that the app can create. */
	readonly missingFields: number;
	readonly exposure: Exposure | null;
	readonly needsConfirm: boolean;
	/** The Group per vendor to pass to the plan. */
	readonly groups: Readonly<Record<Id, number | null>>;
	readonly ready: boolean;
}

/** The bids the award writes: those with a row in the scenario, or every bid with `allLines`. */
export function bidsToPublish(bids: readonly VendorBid[], scenario: AwardScenario | null, allLines: boolean): VendorBid[] {
	if (allLines) return bids.filter((b) => b.status === 'submitted');
	const picked = new Set((scenario?.picks ?? []).flatMap((p) => p.shares.map((s) => s.bidId)));
	return bids.filter((b) => picked.has(b.id));
}

/** The site's names for the plan, once both entities are found. */
export function siteOf(report: SetupReport, projectId: number): FptSite | null {
	const { bid, line } = report.entities;
	if (bid.state !== 'found' || line.state !== 'found') return null;
	const vendorField: Partial<Record<'Shot' | 'Asset', string>> = {};
	if (report.vendorField.Shot.field) vendorField.Shot = report.vendorField.Shot.field;
	if (report.vendorField.Asset.field) vendorField.Asset = report.vendorField.Asset.field;
	return { projectId, bidType: bid.type, lineType: line.type, vendorField, statuses: report.statuses.codes };
}

function readable(a: Access): boolean {
	return a.state === 'allowed' || a.state === 'conditional';
}

/** What a vendor with a Flow PT login could read, and what an admin sets. */
export function exposureOf(report: SetupReport, baseCurrency: string): Exposure {
	const { bid, line, group } = report.access;
	if (bid.state === 'not_allowed' && line.state === 'not_allowed') return { state: 'safe' };
	const role = group.charAt(0).toUpperCase() + group.slice(1);
	const adminSteps = (['Bid', 'Bid Line'] as const)
		.filter((name) => (name === 'Bid' ? bid : line).state !== 'not_allowed')
		.map((name) => `In the ${role} permission role, set See entities to Not allowed for ${name}.`);
	if (readable(bid) || readable(line)) {
		const what: string[] = [];
		if (readable(bid)) what.push(`every Bid in this project: each vendor's name and Group, its total in its own currency and in ${baseCurrency}, the rate, and whether it won`);
		if (readable(line)) what.push(`every Bid Line: the price of each Shot and Asset from each vendor, each share, and who won it`);
		const lines = [`A vendor with a Flow PT login can read ${what.join('; and ')}.`];
		if (bid.state === 'conditional' || line.state === 'conditional') {
			lines.push('A condition on the rule does not stop it. A filter through a link, a summary grouped on a link and the event log still show the rows.');
		}
		lines.push('The vendors you invited through the app see none of this unless they also have a Flow PT login.');
		return { state: 'exposed', lines, adminSteps };
	}
	const why = [bid, line].find((a) => a.state === 'unreadable' || a.state === 'unknown');
	const reason = why?.state === 'unreadable' ? why.reason : why?.state === 'unknown' ? `The rule reads '${why.access}'.` : '';
	return {
		state: 'unknown',
		lines: [
			`The app could not read what the ${role} role may see of Bid and Bid Line. ${reason}`.trim(),
			'If the role can read them, a vendor with a Flow PT login reads every bid in this project: names, totals, every price, and who won.',
			'Sign in as an Admin to check, or publish anyway.'
		],
		adminSteps
	};
}

export function gate(input: GateInput): Gate {
	const { report, request, scenario } = input;
	const problems: GateProblem[] = [];
	const block = (message: string, target: string, href?: string) => problems.push(href ? { message, target, href } : { message, target });
	const compare = `/requests/${request.id}/compare`;
	const base = request.header.baseCurrency;
	const bids = bidsToPublish(input.bids, scenario, input.allLines);
	const awardedBids = new Set((scenario?.picks ?? []).flatMap((p) => p.shares.map((s) => s.bidId)));

	if (!scenario) block('No scenario is chosen. Mark one as chosen on the compare page.', 'gate-scenario', compare);
	else if (scenario.picks.length === 0) block('The chosen scenario awards nothing.', 'gate-scenario', compare);

	// The vendors, one each, and their Group.
	const byId = new Map(request.vendors.map((v) => [v.id, v]));
	const vendors: GateVendor[] = [];
	const groups: Record<Id, number | null> = {};
	for (const bid of bids) {
		if (vendors.some((v) => v.vendorId === bid.vendorId)) continue;
		const v = byId.get(bid.vendorId);
		const name = v?.name ?? 'A vendor';
		const invited = v?.fpt && v.fpt.type === 'Group' ? v.fpt : null;
		const awarded = bids.some((b) => b.vendorId === bid.vendorId && awardedBids.has(b.id));
		let source: GroupSource;
		let group: number | null = null;
		if (bid.vendorId in input.groups) {
			group = input.groups[bid.vendorId];
			source = group === null ? 'none' : 'picked';
		} else if (invited) {
			group = invited.id;
			source = 'invitation';
		} else source = 'undecided';
		if (source !== 'undecided') groups[bid.vendorId] = group;
		if (source === 'undecided') block(`${name} has no Flow PT Group. Pick one, or publish its Bid without sharing any Shot or Asset with it.`, `gate-vendor-${bid.vendorId}`);
		vendors.push({ vendorId: bid.vendorId, name, invited, source, group, awarded });
	}

	// Rates: every bid written needs its figures in the base currency.
	for (const bid of bids) {
		if (bid.currency !== base && !bid.rate) {
			block(`${byId.get(bid.vendorId)?.name ?? 'A vendor'} bids in ${bid.currency} and has no rate to ${base}. Set it on the compare page.`, 'gate-rates', compare);
		}
	}

	// An awarded row with no Flow PT row: created, published without one, or matched first. One choice per kind.
	const rows = new Map<string, { label: string; fpt?: EntityRef }>();
	for (const s of request.shots) rows.set(targetKey({ kind: 'shot', id: s.id }), { label: s.code, fpt: s.fpt });
	for (const a of request.assets) rows.set(targetKey({ kind: 'asset', id: a.id }), { label: a.name, fpt: a.fpt });
	const awardedTargets = [
		...(scenario?.picks ?? []).map((p) => p.target),
		...(input.allLines ? bids.flatMap((b) => b.lines.map((l) => l.target)) : [])
	];
	const choices = input.missing ?? {};
	const labels = { shot: [] as string[], asset: [] as string[] };
	const seen = new Set<string>();
	const kinds = new Set<'shot' | 'asset'>();
	for (const target of awardedTargets) {
		const key = targetKey(target);
		if (seen.has(key)) continue;
		seen.add(key);
		const row = rows.get(key);
		if (row && !row.fpt) labels[target.kind].push(row.label);
		if (row?.fpt || choices[target.kind] === 'create') kinds.add(target.kind);
	}
	const missingRows = {
		shot: { labels: labels.shot, choice: choices.shot ?? null },
		asset: { labels: labels.asset, choice: choices.asset ?? null }
	};
	for (const kind of ['shot', 'asset'] as const) {
		const list = labels[kind];
		if (list.length === 0 || choices[kind]) continue;
		const type = kind === 'shot' ? 'Shot' : 'Asset';
		const names = list.length <= 6 ? named(list) : `${list.slice(0, 6).join(', ')} and ${list.length - 6} more`;
		block(
			list.length === 1
				? `1 ${kind} has no Flow PT ${type}: ${names}. Create it, publish without it, or match it first.`
				: `${list.length} ${kind}s have no Flow PT ${type}: ${names}. Create them, publish without them, or match them first.`,
			'gate-missing'
		);
	}

	let site: FptSite | null = null;
	let missingFields = 0;
	let exposure: Exposure | null = null;
	if (!report) block('The Flow PT site is still being read.', 'gate-site');
	else {
		site = siteOf(report, input.projectId);
		for (const key of ['bid', 'line'] as const) {
			const state = report.entities[key];
			if (state.state === 'missing') block(`${ENTITY_NAMES[key]} is not enabled on the site. An admin enables a custom entity displayed '${ENTITY_NAMES[key]}', with no Tasks and no Versions.`, 'gate-site');
			if (state.state === 'ambiguous') block(`Two custom entities are displayed '${ENTITY_NAMES[key]}': ${state.types.join(', ')}. An admin renames one.`, 'gate-site');
		}
		const missing = report.fields.filter((f) => f.state === 'missing' && !f.spec.stock);
		missingFields = missing.length;
		if (missingFields > 0) {
			const on = (['bid', 'line'] as const)
				.map((key) => ({ key, names: missing.filter((f) => f.entity === key).map((f) => f.spec.display) }))
				.filter((p) => p.names.length > 0)
				.map((p) => `${ENTITY_NAMES[p.key]}: ${named(p.names)}`);
			block(`${missingFields === 1 ? 'One field is' : `${missingFields} fields are`} missing on ${on.join('; and on ')}. Create them here.`, 'gate-site');
		}
		for (const f of report.fields) {
			const where = `${ENTITY_NAMES[f.entity]}.${f.spec.name}`;
			if (f.state === 'missing' && f.spec.stock) block(`${where} is missing. It is a stock field: the entity is not set up right.`, 'gate-site');
			if (f.state === 'wrong_type') block(`${where} is a ${f.actual?.dataType} field. sg-bids needs ${f.spec.dataType}. An admin fixes it in the web interface.`, 'gate-site');
			if (f.state === 'wrong_targets') block(`${where} links to ${(f.actual?.validTypes ?? []).join(', ')}. An admin fixes it in the web interface.`, 'gate-site');
		}
		if (kinds.has('shot') && !report.vendorField.Shot.field) block(`Shot: ${report.vendorField.Shot.problem ?? 'no vendor groups field.'} The award cannot share a Shot.`, 'gate-site');
		if (kinds.has('asset') && !report.vendorField.Asset.field) block(`Asset: ${report.vendorField.Asset.problem ?? 'no vendor groups field.'} The award cannot share an Asset.`, 'gate-site');
		exposure = exposureOf(report, base);
	}

	const needsConfirm = exposure !== null && exposure.state !== 'safe';
	const ready = problems.length === 0 && site !== null && (!needsConfirm || input.exposureAccepted);
	const blockers = problems.map((p) => p.message);
	return { bids, site, vendors, blockers, problems, missing: missingRows, missingFields, exposure, needsConfirm, groups, ready };
}

/** `a, b and c`. */
function named(parts: readonly string[]): string {
	return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
