/**
 * The reads behind the setup check, and the creates behind `ensureFields`. The decisions are in
 * `src/lib/pure/fpt-setup.ts`. A schema read with `project_id` gives the statuses the project
 * offers (recipe 010). The rules are read with the person's own bearer: an Admin reads every group,
 * anyone else gets 403 for the Vendor group, which the report says (162). Fields are created one
 * request at a time: a schema write has no batch. Nothing here renames, deletes or touches a rule.
 */
import {
	createOutcome,
	fieldsToCreate,
	findEntities,
	offeredStatuses,
	setupReport,
	type CreateOutcome,
	type CreatePlan,
	type FieldCreate,
	type RightsRead,
	type SchemaFields,
	type SetupInput,
	type SetupReport,
	type SetupSettings
} from '../pure/fpt-setup';
import { errorTitle, type FptApi } from './fpt-api';

export interface ReadOptions {
	/** The signed-in person's HumanUser id. */
	readonly me?: number;
	/** The Vendor permission group's code. Found by display name `Vendor` when unset. */
	readonly vendorGroup?: string;
	readonly settings?: SetupSettings;
}

interface RawField {
	data_type?: { value?: unknown };
	properties?: Record<string, { value?: unknown } | undefined>;
}

function schemaFields(data: Record<string, RawField>): SchemaFields {
	const out: Record<string, { dataType: string; validTypes?: string[] }> = {};
	for (const [name, f] of Object.entries(data)) {
		const types = f.properties?.valid_types?.value;
		out[name] = Array.isArray(types) ? { dataType: String(f.data_type?.value), validTypes: types.map(String) } : { dataType: String(f.data_type?.value) };
	}
	return out;
}

/** The group by code when named, else the one displayed `Vendor`. A person below Admin lists only their own (162). */
async function vendorGroup(api: FptApi, named: string | undefined): Promise<{ code: string; name?: string }> {
	const answer = await api.raw('GET', '/schema/permission_groups?entity_type=HumanUser');
	const groups = (answer.body as { data?: { code?: unknown; display_name?: unknown }[] } | null)?.data ?? [];
	const hit = groups.find((g) => (named ? g.code === named : typeof g.display_name === 'string' && g.display_name.trim() === 'Vendor'));
	const name = typeof hit?.display_name === 'string' ? hit.display_name.trim() : undefined;
	return { code: named ?? (typeof hit?.code === 'string' ? hit.code : 'vendor'), name };
}

async function rights(api: FptApi, group: string, type: string): Promise<RightsRead> {
	const answer = await api.raw('GET', `/schema/permission_groups/${encodeURIComponent(group)}/entity_types/${encodeURIComponent(type)}`);
	if (answer.status === 200) return { ok: true, data: (answer.body as { data?: unknown } | null)?.data ?? null };
	return { ok: false, status: answer.status, reason: `${errorTitle(answer).replace(/\.?$/, '.')}` };
}

export interface SetupRead {
	readonly input: SetupInput;
	readonly report: SetupReport;
}

/** Read the site for one project and build the report. */
export async function readSetup(api: FptApi, projectId: number, options: ReadOptions = {}): Promise<SetupRead> {
	const entityTypes = await api.client.entityTypes();
	const entities = findEntities(entityTypes);
	const bidType = entities.bid.state === 'found' ? entities.bid.type : null;
	const lineType = entities.line.state === 'found' ? entities.line.type : null;
	const types = [bidType, lineType, 'Shot', 'Asset'].filter((t): t is string => t !== null);

	const fields: Record<string, SchemaFields> = {};
	let bidStatuses: SetupInput['bidStatuses'];
	for (const type of types) {
		const answer = await api.raw('GET', `/schema/${type}/fields?project_id=${projectId}`);
		if (answer.status !== 200) throw new Error(`Reading the ${type} schema: ${errorTitle(answer)}`);
		const data = (answer.body as { data: Record<string, RawField> }).data;
		fields[type] = schemaFields(data);
		if (type === bidType) {
			const p = data.sg_status_list?.properties ?? {};
			bidStatuses = offeredStatuses({
				validValues: p.valid_values?.value as string[] | undefined,
				hiddenValues: p.hidden_values?.value as string[] | undefined,
				displayValues: p.display_values?.value as Record<string, string> | undefined
			});
		}
	}

	const group = await vendorGroup(api, options.vendorGroup);
	const read: Record<string, RightsRead> = {};
	for (const type of [...types, 'EventLogEntry']) read[type] = await rights(api, group.code, type);

	const input: SetupInput = {
		entityTypes,
		fields,
		bidStatuses,
		vendorGroup: group.code,
		vendorGroupName: group.name,
		rights: read,
		me: options.me,
		settings: options.settings
	};
	return { input, report: setupReport(input) };
}

export interface EnsureResult {
	readonly plan: CreatePlan;
	readonly outcomes: readonly { readonly create: FieldCreate; readonly outcome: CreateOutcome }[];
}

/** Create every missing field, one request each. Stops nothing on a refusal: each answer is kept. */
export async function ensureFields(api: FptApi, read: SetupRead): Promise<EnsureResult> {
	const plan = fieldsToCreate(read.report, read.input.entityTypes);
	const outcomes: { create: FieldCreate; outcome: CreateOutcome }[] = [];
	for (const create of plan.creates) {
		const answer = await api.raw('POST', `/schema/${create.entityType}/fields`, create.body);
		outcomes.push({ create, outcome: createOutcome(answer.status, answer.body, create.name) });
	}
	return { plan, outcomes };
}
