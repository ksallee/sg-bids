/**
 * Whether the chosen scenario may be published to Flow PT, and what must happen first. Pure, no I/O.
 * The site facts come from the setup report (`fpt-setup.ts`, recipe 029); the writes from
 * `fpt-award.ts`.
 *
 * What blocks: no chosen scenario; Bid or Bid Line not enabled; a field missing or of the wrong
 * type; no vendor groups field on a type the scenario awards; a bid in another currency with no
 * rate; a vendor with no Group and no choice made; an item with no Flow PT row.
 *
 * What asks first: the Vendor role can read Bid or Bid Line, or its rights could not be read. A
 * vendor with a Flow PT login then reads every bid in the project (163), and a see rule leaks (165).
 * Publishing stays possible only after "publish anyway", and that choice is recorded.
 */

import type { FptSite } from './fpt-award';
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
	const blockers: string[] = [];
	const base = request.header.baseCurrency;
	const bids = bidsToPublish(input.bids, scenario, input.allLines);
	const awardedBids = new Set((scenario?.picks ?? []).flatMap((p) => p.shares.map((s) => s.bidId)));

	if (!scenario) blockers.push('No scenario is chosen. Mark one as chosen on the compare page.');
	else if (scenario.picks.length === 0) blockers.push('The chosen scenario awards nothing.');

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
		if (source === 'undecided') blockers.push(`${name} has no Flow PT Group. Pick one, or publish its Bid without sharing any Shot or Asset with it.`);
		vendors.push({ vendorId: bid.vendorId, name, invited, source, group, awarded });
	}

	// Rates: every bid written needs its figures in the base currency.
	for (const bid of bids) {
		if (bid.currency !== base && !bid.rate) {
			blockers.push(`${byId.get(bid.vendorId)?.name ?? 'A vendor'} bids in ${bid.currency} and has no rate to ${base}. Set it on the compare page.`);
		}
	}

	// Every awarded item needs its Flow PT row.
	const refs = new Map<string, EntityRef | undefined>();
	for (const s of request.shots) refs.set(targetKey({ kind: 'shot', id: s.id }), s.fpt);
	for (const a of request.assets) refs.set(targetKey({ kind: 'asset', id: a.id }), a.fpt);
	const kinds = new Set<'shot' | 'asset'>();
	for (const pick of scenario?.picks ?? []) {
		kinds.add(pick.target.kind);
		if (!refs.get(targetKey(pick.target))) blockers.push(`The ${pick.target.kind} ${pick.target.id} has no Flow PT row. It cannot be awarded in Flow PT.`);
	}

	let site: FptSite | null = null;
	let missingFields = 0;
	let exposure: Exposure | null = null;
	if (!report) blockers.push('The Flow PT site is still being read.');
	else {
		site = siteOf(report, input.projectId);
		for (const key of ['bid', 'line'] as const) {
			const state = report.entities[key];
			if (state.state === 'missing') blockers.push(`${ENTITY_NAMES[key]} is not enabled on the site. An admin enables a custom entity displayed '${ENTITY_NAMES[key]}', with no Tasks and no Versions.`);
			if (state.state === 'ambiguous') blockers.push(`Two custom entities are displayed '${ENTITY_NAMES[key]}': ${state.types.join(', ')}. An admin renames one.`);
		}
		const missing = report.fields.filter((f) => f.state === 'missing' && !f.spec.stock);
		missingFields = missing.length;
		if (missingFields > 0) blockers.push(`${missingFields === 1 ? 'One field is' : `${missingFields} fields are`} missing on Bid and Bid Line. Create them here.`);
		for (const f of report.fields) {
			const where = `${ENTITY_NAMES[f.entity]}.${f.spec.name}`;
			if (f.state === 'missing' && f.spec.stock) blockers.push(`${where} is missing. It is a stock field: the entity is not set up right.`);
			if (f.state === 'wrong_type') blockers.push(`${where} is a ${f.actual?.dataType} field. sg-bids needs ${f.spec.dataType}. An admin fixes it in the web interface.`);
			if (f.state === 'wrong_targets') blockers.push(`${where} links to ${(f.actual?.validTypes ?? []).join(', ')}. An admin fixes it in the web interface.`);
		}
		if (kinds.has('shot') && !report.vendorField.Shot.field) blockers.push(`Shot: ${report.vendorField.Shot.problem ?? 'no vendor groups field.'} The award cannot share a Shot.`);
		if (kinds.has('asset') && !report.vendorField.Asset.field) blockers.push(`Asset: ${report.vendorField.Asset.problem ?? 'no vendor groups field.'} The award cannot share an Asset.`);
		exposure = exposureOf(report, base);
	}

	const needsConfirm = exposure !== null && exposure.state !== 'safe';
	const ready = blockers.length === 0 && site !== null && (!needsConfirm || input.exposureAccepted);
	return { bids, site, vendors, blockers, missingFields, exposure, needsConfirm, groups, ready };
}
