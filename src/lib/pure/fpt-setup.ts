/**
 * Whether a Flow PT site is ready for sg-bids, read from its schema and the Vendor role's rules, and
 * what `ensureFields` would create. The reads and the creates are in `src/lib/io/fpt-setup.ts`.
 * Facts from `../sg-groundtruth/corpus`:
 *
 * - A custom entity is enabled when it is in `GET /schema`, and found by its display name, trimmed.
 *   Connection types share the prefix: only `CustomEntityNN` counts (008).
 * - A field create takes the display name, a description, `valid_types` for an entity field and a
 *   `default_value` for a checkbox (019, 116). An entity's `valid_types` must be spelled as
 *   `GET /schema` spells them: a wrong case is a 500 that retires the field (121).
 * - The name comes back only in `links.self`, last segment (019, 118). A name already used by a
 *   retired field is 400 code 105 with `source.field_name` (119); only the Trash page frees it (120).
 * - Rules are readable over REST and never writable. An Admin person reads every group, a person
 *   only their own: 403 for another, 404 for the script (162, recipe 029).
 * - `read: allowed` on a type is every row of it to every vendor in the project (163). A see rule
 *   still leaks through a dotted filter, a `_summarize` grouped on a link, and the event log (165).
 *   So the safe state for Bid and Bid Line is no read at all.
 * - A Group in a Shot's vendor groups field shows the Shot to its people only when the Shot's see
 *   rule names that field (166, recipe 029). A person reading their own group reads their own row
 *   where an Admin reads the `logged_in_user_token` (162).
 * - The statuses a project offers are `valid_values` less `hidden_values`, read with `project_id`,
 *   labelled by `display_values` (recipe 010). No status is created here.
 */

import { ENTITY_NAMES, FIELDS, linkTypes, type EntityKey, type FieldSpec } from './fpt-fields';

export interface EntityTypeName {
	readonly name: string;
	readonly displayName: string;
}

/** What the setup check needs of one field's schema. */
export interface SchemaField {
	readonly dataType: string;
	readonly validTypes?: readonly string[];
}

export type SchemaFields = Readonly<Record<string, SchemaField>>;

/** A permission group read: the response's `data`, or why it could not be read. */
export type RightsRead = { readonly ok: true; readonly data: unknown } | { readonly ok: false; readonly status: number; readonly reason: string };

export type AppStatus = 'draft' | 'submitted' | 'awarded' | 'not_awarded';

export const APP_STATUSES: readonly AppStatus[] = ['draft', 'submitted', 'awarded', 'not_awarded'];

export interface StatusOffer {
	readonly code: string;
	readonly label: string;
}

export interface SetupSettings {
	/** The multi_entity field to Group that an award adds the vendor to, per type. Detected when unset. */
	readonly vendorField?: Partial<Record<ItemType, string>>;
	/** A site status code per app status. Matched by label, then code, when unset. */
	readonly statuses?: Partial<Record<AppStatus, string>>;
}

export type ItemType = 'Shot' | 'Asset';

export const ITEM_TYPES: readonly ItemType[] = ['Shot', 'Asset'];

export interface SetupInput {
	readonly entityTypes: readonly EntityTypeName[];
	/** By entity type: the two slots, Shot and Asset. A type not read is absent. */
	readonly fields: Readonly<Record<string, SchemaFields>>;
	/** The statuses the project offers on Bid's `sg_status_list`. Absent when Bid is missing. */
	readonly bidStatuses?: readonly StatusOffer[];
	/** The Vendor permission group's code. */
	readonly vendorGroup: string;
	/** Its display name, for the report's words. The code when absent. */
	readonly vendorGroupName?: string;
	/** The group's rights by entity type: the two slots, Shot, Asset and EventLogEntry. */
	readonly rights: Readonly<Record<string, RightsRead>>;
	/** The signed-in person's HumanUser id, which a person reading their own group sees in a rule. */
	readonly me?: number;
	readonly settings?: SetupSettings;
}

export type EntityState =
	| { readonly state: 'found'; readonly type: string }
	| { readonly state: 'missing' }
	| { readonly state: 'ambiguous'; readonly types: readonly string[] };

export type FieldState = 'present' | 'missing' | 'wrong_type' | 'wrong_targets' | 'no_entity';

export interface FieldCheck {
	readonly entity: EntityKey;
	readonly spec: FieldSpec;
	readonly state: FieldState;
	/** What the site has under that name, when it differs. */
	readonly actual?: SchemaField;
}

export interface VendorFieldCheck {
	/** The field the award writes, or null. */
	readonly field: string | null;
	/** Every multi_entity field to Group alone on the type. */
	readonly candidates: readonly string[];
	readonly problem: string | null;
}

export type Access =
	| { readonly state: 'not_allowed' }
	| { readonly state: 'allowed' }
	| { readonly state: 'conditional'; readonly paths: readonly string[] }
	| { readonly state: 'unreadable'; readonly reason: string }
	| { readonly state: 'unknown'; readonly access: string };

export interface VendorAccess {
	readonly group: string;
	readonly bid: Access;
	readonly line: Access;
	readonly eventLog: Access;
	/** Per type: the see rule shows an awarded item through the vendor field. Null when unknown. */
	readonly awardReaches: Readonly<Record<ItemType, boolean | null>>;
}

export interface StatusMap {
	readonly codes: Readonly<Partial<Record<AppStatus, string>>>;
	/** App statuses with no site status. The Bid's status is not written for them. */
	readonly unmapped: readonly AppStatus[];
	readonly problems: readonly string[];
}

export interface SetupReport {
	readonly entities: Readonly<Record<EntityKey, EntityState>>;
	readonly fields: readonly FieldCheck[];
	readonly vendorField: Readonly<Record<ItemType, VendorFieldCheck>>;
	readonly statuses: StatusMap;
	readonly access: VendorAccess;
	/** Both entities found, every field present with its type, a vendor field on Shot. */
	readonly ready: boolean;
	/** The Vendor role reads neither Bid nor Bid Line. */
	readonly safe: boolean;
	/** In plain words, what is wrong or at risk. */
	readonly risks: readonly string[];
	/** What an admin sets in the web interface. Rules cannot be written over REST. */
	readonly adminSteps: readonly string[];
}

/** The three ways a vendor reaches a row a see rule hides (165), in plain words. */
export const LEAK_PATHS: readonly string[] = [
	'A filter through a link. A vendor who can read a Bid Line can filter on the fields of a Bid it cannot see, and learn them one yes or no at a time.',
	'A total grouped on a link. A summary of Bid Lines grouped on their Bid or their Shot shows each hidden row and the total of its lines.',
	'The event log. Every value written to a Bid or a Bid Line shows in the event log, even for a row the vendor cannot see, while the Vendor role reads Event Log Entries.'
];

const SLOT = /^CustomEntity\d+$/;

/** The site type displayed as each of Bid and Bid Line. */
export function findEntities(types: readonly EntityTypeName[]): Record<EntityKey, EntityState> {
	const find = (display: string): EntityState => {
		const hits = types.filter((t) => SLOT.test(t.name) && t.displayName.trim() === display).map((t) => t.name);
		if (hits.length === 0) return { state: 'missing' };
		if (hits.length > 1) return { state: 'ambiguous', types: hits };
		return { state: 'found', type: hits[0] };
	};
	return { bid: find(ENTITY_NAMES.bid), line: find(ENTITY_NAMES.line) };
}

function sameList(a: readonly string[] | undefined, b: readonly string[]): boolean {
	return a !== undefined && a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Each declared field of one entity against the site's schema of it. */
export function checkFields(entity: EntityKey, fields: SchemaFields | undefined, bidType: string | null): FieldCheck[] {
	return FIELDS[entity].map((spec): FieldCheck => {
		if (!fields) return { entity, spec, state: 'no_entity' };
		const actual = fields[spec.name];
		if (!actual) return { entity, spec, state: 'missing' };
		if (actual.dataType !== spec.dataType) return { entity, spec, state: 'wrong_type', actual };
		if (spec.validTypes) {
			const want = linkTypes(spec.validTypes, bidType ?? '');
			const have = actual.validTypes ?? [];
			// The order is kept by the site (121) but does not change what a link may hold.
			if (want.length !== have.length || !want.every((t) => have.includes(t))) return { entity, spec, state: 'wrong_targets', actual };
		}
		return { entity, spec, state: 'present' };
	});
}

/** The multi_entity field to Group on a type: the setting, else the one candidate, else `sg_vendor_groups`. */
export function detectVendorField(fields: SchemaFields | undefined, setting: string | undefined): VendorFieldCheck {
	if (!fields) return { field: null, candidates: [], problem: 'The schema was not read.' };
	const candidates = Object.entries(fields)
		.filter(([, f]) => f.dataType === 'multi_entity' && sameList(f.validTypes, ['Group']))
		.map(([name]) => name)
		.sort();
	if (setting) {
		return candidates.includes(setting)
			? { field: setting, candidates, problem: null }
			: { field: null, candidates, problem: `${setting} is not a multi-entity field to Group.` };
	}
	if (candidates.length === 1) return { field: candidates[0], candidates, problem: null };
	if (candidates.includes('sg_vendor_groups')) return { field: 'sg_vendor_groups', candidates, problem: null };
	if (candidates.length === 0) return { field: null, candidates, problem: 'No multi-entity field to Group.' };
	return { field: null, candidates, problem: `Several multi-entity fields to Group: ${candidates.join(', ')}. Name one in the settings.` };
}

/** The codes a project offers on a status field, labelled (recipe 010). */
export function offeredStatuses(field: {
	readonly validValues?: readonly string[];
	readonly hiddenValues?: readonly string[];
	readonly displayValues?: Readonly<Record<string, string>>;
}): StatusOffer[] {
	const hidden = new Set(field.hiddenValues ?? []);
	return (field.validValues ?? []).filter((c) => !hidden.has(c)).map((code) => ({ code, label: field.displayValues?.[code] ?? code }));
}

/** Labels first, then codes, in order. A site status serves one app status at most. */
const CANDIDATES: Readonly<Record<AppStatus, { readonly labels: readonly string[]; readonly codes: readonly string[] }>> = {
	draft: { labels: ['Draft', 'Waiting to Start', 'Not Started', 'Ready to Start'], codes: ['wtg', 'rdy'] },
	submitted: { labels: ['Submitted', 'Pending Review', 'Pending', 'In Progress'], codes: ['rev', 'pndng', 'ip'] },
	awarded: { labels: ['Awarded', 'Approved', 'Final'], codes: ['awd', 'apr', 'fin'] },
	not_awarded: { labels: ['Not Awarded', 'Omitted', 'Omit', 'Closed', 'Lost'], codes: ['omt', 'clsd'] }
};

/** Each app status onto a status the project offers. Never creates one. */
export function mapStatuses(offered: readonly StatusOffer[], settings: Partial<Record<AppStatus, string>> = {}): StatusMap {
	const codes: Partial<Record<AppStatus, string>> = {};
	const used = new Set<string>();
	const problems: string[] = [];
	const offeredCodes = new Set(offered.map((o) => o.code));
	for (const status of APP_STATUSES) {
		const set = settings[status];
		if (set === undefined) continue;
		if (offeredCodes.has(set)) {
			codes[status] = set;
			used.add(set);
		} else problems.push(`The setting names '${set}' for ${status.replace('_', ' ')}; the project does not offer it.`);
	}
	for (const status of APP_STATUSES) {
		if (codes[status] !== undefined || settings[status] !== undefined) continue;
		const { labels, codes: candidates } = CANDIDATES[status];
		const free = offered.filter((o) => !used.has(o.code));
		const byLabel = labels.map((l) => free.find((o) => o.label.trim().toLowerCase() === l.toLowerCase())).find(Boolean);
		const byCode = candidates.map((c) => free.find((o) => o.code === c)).find(Boolean);
		const hit = byLabel ?? byCode;
		if (hit) {
			codes[status] = hit.code;
			used.add(hit.code);
		}
	}
	return { codes, unmapped: APP_STATUSES.filter((s) => codes[s] === undefined), problems };
}

interface Leaf {
	readonly path?: unknown;
	readonly relation?: unknown;
	readonly values?: unknown;
}

function leaves(condition: unknown): Leaf[] {
	if (!condition || typeof condition !== 'object') return [];
	const conditions = (condition as { conditions?: unknown }).conditions;
	if (Array.isArray(conditions)) return conditions.flatMap(leaves);
	return [condition as Leaf];
}

function readAction(read: RightsRead | undefined): { access?: string; condition?: unknown } | null {
	if (!read?.ok) return null;
	const actions = (read.data as { actions?: { read?: { access?: unknown; condition?: unknown } } } | null)?.actions;
	const access = actions?.read?.access;
	return { access: typeof access === 'string' ? access : undefined, condition: actions?.read?.condition };
}

/** What a group's read on a type allows. `denied` is how the site writes a refused action (162). */
export function readAccess(read: RightsRead | undefined): Access {
	if (!read) return { state: 'unreadable', reason: 'Not read.' };
	if (!read.ok) return { state: 'unreadable', reason: read.reason };
	const action = readAction(read);
	switch (action?.access) {
		case 'denied':
			return { state: 'not_allowed' };
		case 'allowed':
			return { state: 'allowed' };
		case 'conditional':
			return {
				state: 'conditional',
				paths: leaves(action.condition)
					.map((l) => l.path)
					.filter((p): p is string => typeof p === 'string')
			};
		default:
			return { state: 'unknown', access: String(action?.access) };
	}
}

function isMe(value: unknown, me: number | undefined): boolean {
	const v = value as { valid?: unknown; type?: unknown; id?: unknown } | null;
	if (!v || typeof v !== 'object') return false;
	return v.valid === 'logged_in_user_token' || (me !== undefined && v.type === 'HumanUser' && v.id === me);
}

/** Whether the group sees a row through `<field>.Group.users` or `.sg_people` holding the person (recipe 029). */
export function seenThrough(read: RightsRead | undefined, field: string | null, me?: number): boolean | null {
	const action = readAction(read);
	if (!action || !field) return null;
	if (action.access === 'allowed') return true;
	if (action.access !== 'conditional') return false;
	const paths = new Set([`${field}.Group.users`, `${field}.Group.sg_people`]);
	return leaves(action.condition).some(
		(l) => typeof l.path === 'string' && paths.has(l.path) && l.relation === 'is' && Array.isArray(l.values) && l.values.some((v) => isMe(v, me))
	);
}

function words(access: Access, label: string, group: string): string[] {
	switch (access.state) {
		case 'not_allowed':
			return [];
		case 'allowed':
			return [`The ${group} role reads every ${label} in its projects: every vendor sees every other vendor's prices.`];
		case 'conditional':
			return [`The ${group} role reads ${label} under a condition. A see rule still leaks: see the three paths.`];
		case 'unreadable':
			return [`The ${group} role's rights on ${label} could not be read: ${access.reason} Sign in as an Admin to check.`];
		case 'unknown':
			return [`The ${group} role's read on ${label} is '${access.access}', which this check does not know.`];
	}
}

export function setupReport(input: SetupInput): SetupReport {
	const entities = findEntities(input.entityTypes);
	const typeOf = (key: EntityKey) => (entities[key].state === 'found' ? (entities[key] as { type: string }).type : null);
	const bidType = typeOf('bid');
	const lineType = typeOf('line');
	const fields = [
		...checkFields('bid', bidType ? input.fields[bidType] : undefined, bidType),
		...checkFields('line', lineType ? input.fields[lineType] : undefined, bidType)
	];
	const vendorField = {
		Shot: detectVendorField(input.fields.Shot, input.settings?.vendorField?.Shot),
		Asset: detectVendorField(input.fields.Asset, input.settings?.vendorField?.Asset)
	};
	const statuses = mapStatuses(input.bidStatuses ?? [], input.settings?.statuses);
	const group = input.vendorGroupName ?? input.vendorGroup;
	const access: VendorAccess = {
		group: input.vendorGroup,
		bid: bidType ? readAccess(input.rights[bidType]) : { state: 'unreadable', reason: 'Bid is not enabled.' },
		line: lineType ? readAccess(input.rights[lineType]) : { state: 'unreadable', reason: 'Bid Line is not enabled.' },
		eventLog: readAccess(input.rights.EventLogEntry),
		awardReaches: {
			Shot: seenThrough(input.rights.Shot, vendorField.Shot.field, input.me),
			Asset: seenThrough(input.rights.Asset, vendorField.Asset.field, input.me)
		}
	};

	const risks: string[] = [];
	const steps: string[] = [];
	for (const key of ['bid', 'line'] as const) {
		const state = entities[key];
		const display = ENTITY_NAMES[key];
		if (state.state === 'missing') steps.push(`Enable a custom entity displayed '${display}' in the site preferences.`);
		if (state.state === 'ambiguous') steps.push(`Two custom entities are displayed '${display}': ${state.types.join(', ')}. Rename one.`);
	}
	for (const f of fields) {
		const where = `${ENTITY_NAMES[f.entity]}.${f.spec.name}`;
		if (f.state === 'wrong_type') risks.push(`${where} is a ${f.actual?.dataType} field; sg-bids needs ${f.spec.dataType}. It is never renamed or deleted.`);
		if (f.state === 'wrong_targets') risks.push(`${where} links to ${(f.actual?.validTypes ?? []).join(', ')}; sg-bids needs ${linkTypes(f.spec.validTypes ?? [], bidType ?? 'Bid').join(', ')}.`);
	}
	for (const type of ITEM_TYPES) {
		const v = vendorField[type];
		if (v.problem) risks.push(`${type}: ${v.problem} An award cannot give a vendor its ${type}s.`);
		if (v.field && access.awardReaches[type] === false) {
			risks.push(`The ${group} role does not see a ${type} through ${v.field}. An award would not reach the vendor.`);
			steps.push(`In the ${group} role's permissions, let it see a ${type} where ${v.field} holds a Group the person is in.`);
		}
	}
	for (const s of statuses.unmapped) {
		risks.push(`The project offers no status for '${s.replace('_', ' ')}' on Bid. The Bid's status is left as it is for it.`);
	}
	risks.push(...statuses.problems);

	const exposed = [access.bid, access.line].some((a) => a.state === 'allowed' || a.state === 'conditional');
	risks.push(...words(access.bid, 'Bid', group), ...words(access.line, 'Bid Line', group));
	if (exposed) risks.push(...LEAK_PATHS);
	for (const [key, a] of [
		['Bid', access.bid],
		['Bid Line', access.line]
	] as const) {
		if (a.state !== 'not_allowed') steps.push(`In the ${group} role's permissions, set See entities to Not allowed for ${key}.`);
	}
	if (access.eventLog.state !== 'not_allowed' && exposed) {
		steps.push(`Consider setting See entities to Not allowed for Event Log Entry on the ${group} role. While it reads the event log, values written to Bids reach it.`);
	}

	const safe = access.bid.state === 'not_allowed' && access.line.state === 'not_allowed';
	const ready = bidType !== null && lineType !== null && fields.every((f) => f.state === 'present') && vendorField.Shot.field !== null;
	return { entities, fields, vendorField, statuses, access, ready, safe, risks, adminSteps: steps };
}

/** One field create, as `POST /schema/<entityType>/fields` takes it. */
export interface FieldCreate {
	readonly entity: EntityKey;
	readonly entityType: string;
	/** The name the site should derive. Compared with `links.self` after. */
	readonly name: string;
	readonly body: {
		readonly data_type: string;
		readonly properties: readonly { readonly property_name: string; readonly value: unknown }[];
	};
}

export interface CreatePlan {
	readonly creates: readonly FieldCreate[];
	/** Fields that cannot be created, and why. Nothing is renamed or deleted. */
	readonly skipped: readonly { readonly entity: EntityKey; readonly name: string; readonly reason: string }[];
}

/** The creates for every missing field. A field present with another type is left alone. */
export function fieldsToCreate(report: SetupReport, entityTypes: readonly EntityTypeName[]): CreatePlan {
	const known = new Set(entityTypes.map((t) => t.name));
	const bidType = report.entities.bid.state === 'found' ? report.entities.bid.type : null;
	const creates: FieldCreate[] = [];
	const skipped: { entity: EntityKey; name: string; reason: string }[] = [];
	for (const check of report.fields) {
		const state = report.entities[check.entity];
		if (check.state === 'present') continue;
		if (state.state !== 'found') {
			skipped.push({ entity: check.entity, name: check.spec.name, reason: `${ENTITY_NAMES[check.entity]} is not enabled.` });
			continue;
		}
		if (check.state !== 'missing') {
			skipped.push({ entity: check.entity, name: check.spec.name, reason: `It exists as ${check.actual?.dataType}. Fix it in the web interface.` });
			continue;
		}
		if (check.spec.stock) {
			skipped.push({ entity: check.entity, name: check.spec.name, reason: 'A stock field is missing. It cannot be created.' });
			continue;
		}
		const properties: { property_name: string; value: unknown }[] = [
			{ property_name: 'name', value: check.spec.display },
			{ property_name: 'description', value: check.spec.description }
		];
		if (check.spec.validTypes) {
			if (check.spec.validTypes.includes('bid') && !bidType) {
				skipped.push({ entity: check.entity, name: check.spec.name, reason: 'Bid is not enabled.' });
				continue;
			}
			const types = linkTypes(check.spec.validTypes, bidType ?? '');
			const unknown = types.filter((t) => !known.has(t));
			if (unknown.length > 0) {
				skipped.push({ entity: check.entity, name: check.spec.name, reason: `The site has no type ${unknown.join(', ')}.` });
				continue;
			}
			properties.push({ property_name: 'valid_types', value: types });
		}
		if (check.spec.dataType === 'checkbox') properties.push({ property_name: 'default_value', value: false });
		creates.push({ entity: check.entity, entityType: state.type, name: check.spec.name, body: { data_type: check.spec.dataType, properties } });
	}
	return { creates, skipped };
}

export type CreateOutcome =
	| { readonly state: 'created'; readonly name: string }
	| { readonly state: 'renamed'; readonly name: string; readonly expected: string }
	| { readonly state: 'retired'; readonly name: string }
	| { readonly state: 'failed'; readonly status: number; readonly title: string };

/** What a field create answered. A 201 under another name is reported, never hidden (117). */
export function createOutcome(status: number, body: unknown, expected: string): CreateOutcome {
	if (status === 201 || status === 200) {
		const self = (body as { links?: { self?: unknown } } | null)?.links?.self;
		const name = typeof self === 'string' ? (self.split('/').pop() ?? '') : '';
		return name === expected ? { state: 'created', name } : { state: 'renamed', name, expected };
	}
	const error = (body as { errors?: { code?: unknown; title?: unknown; source?: { field_name?: unknown } | null }[] } | null)?.errors?.[0];
	const title = typeof error?.title === 'string' ? error.title : `HTTP ${status}`;
	if (status === 400 && error?.code === 105 && error.source?.field_name !== undefined) {
		const named = /same field_name: ([A-Za-z0-9_]+)/.exec(title)?.[1];
		return { state: 'retired', name: named ?? expected };
	}
	return { state: 'failed', status, title };
}
