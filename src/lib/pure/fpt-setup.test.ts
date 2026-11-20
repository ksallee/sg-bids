import { describe, expect, it } from 'vitest';
import { BID_FIELDS, LINE_FIELDS, linkTypes } from './fpt-fields';
import {
	LEAK_PATHS,
	createOutcome,
	detectVendorField,
	fieldsToCreate,
	findEntities,
	mapStatuses,
	offeredStatuses,
	readAccess,
	seenThrough,
	setupReport,
	type RightsRead,
	type SchemaFields,
	type SetupInput
} from './fpt-setup';

const TOKEN = { type: 'HumanUser', id: 0, valid: 'logged_in_user_token', name: 'Me' };

// Shaped like GET /schema/permission_groups/vendor/entity_types/<Type> (162).
const rights = (read: unknown): RightsRead => ({
	ok: true,
	data: { actions: { read, create: { access: 'denied' }, update: { access: 'denied', field_exceptions: { allow: ['sg_status_list'], deny: [] } } } }
});
const ALLOWED = rights({ access: 'allowed' });
const DENIED = rights({ access: 'denied' });
const SHOT_RULE = rights({
	access: 'conditional',
	condition: {
		logical_operator: 'or',
		conditions: [
			{ path: 'tasks.Task.task_assignees', relation: 'is', values: [TOKEN] },
			{ path: 'sg_vendor_groups.Group.users', relation: 'is', values: [TOKEN] },
			{ path: 'sg_vendor_groups.Group.sg_people', relation: 'is', values: [TOKEN] }
		]
	}
});

const TYPES = [
	{ name: 'Shot', displayName: 'Shot' },
	{ name: 'Asset', displayName: 'Asset' },
	{ name: 'Group', displayName: 'Group' },
	{ name: 'CustomEntity14', displayName: 'Bid' },
	{ name: 'CustomEntity15', displayName: 'Bid Line ' },
	{ name: 'CustomEntity14_sg_x_Connection', displayName: 'Bid' }
];

function complete(fields: typeof BID_FIELDS, bidType: string): Record<string, { dataType: string; validTypes?: string[] }> {
	return Object.fromEntries(fields.map((f) => [f.name, f.validTypes ? { dataType: f.dataType, validTypes: linkTypes(f.validTypes, bidType) } : { dataType: f.dataType }]));
}

const ITEM: SchemaFields = {
	code: { dataType: 'text' },
	addressings_cc: { dataType: 'multi_entity', validTypes: ['Group', 'HumanUser'] },
	sg_vendor_groups: { dataType: 'multi_entity', validTypes: ['Group'] }
};

function input(extra: Partial<SetupInput> = {}): SetupInput {
	return {
		entityTypes: TYPES,
		fields: { CustomEntity14: complete(BID_FIELDS, 'CustomEntity14'), CustomEntity15: complete(LINE_FIELDS, 'CustomEntity14'), Shot: ITEM, Asset: ITEM },
		bidStatuses: [
			{ code: 'wtg', label: 'Waiting to Start' },
			{ code: 'rev', label: 'Pending Review' },
			{ code: 'awd', label: 'Awarded' },
			{ code: 'omt', label: 'Omitted' }
		],
		vendorGroup: 'vendor',
		rights: { CustomEntity14: DENIED, CustomEntity15: DENIED, EventLogEntry: ALLOWED, Shot: SHOT_RULE, Asset: SHOT_RULE },
		...extra
	};
}

describe('findEntities', () => {
	it('finds each slot by its display name, trimmed, and skips connection types (008)', () => {
		expect(findEntities(TYPES)).toEqual({ bid: { state: 'found', type: 'CustomEntity14' }, line: { state: 'found', type: 'CustomEntity15' } });
	});

	it('says missing and ambiguous', () => {
		expect(findEntities([{ name: 'CustomEntity01', displayName: 'Bid' }]).line).toEqual({ state: 'missing' });
		const two = findEntities([
			{ name: 'CustomEntity01', displayName: 'Bid' },
			{ name: 'CustomEntity02', displayName: 'Bid' }
		]);
		expect(two.bid).toEqual({ state: 'ambiguous', types: ['CustomEntity01', 'CustomEntity02'] });
	});
});

describe('detectVendorField', () => {
	it('takes the one multi_entity field to Group alone, never one that also takes people', () => {
		expect(detectVendorField(ITEM, undefined)).toEqual({ field: 'sg_vendor_groups', candidates: ['sg_vendor_groups'], problem: null });
	});

	it('takes the setting when it is a candidate', () => {
		const fields = { ...ITEM, sg_vendors: { dataType: 'multi_entity', validTypes: ['Group'] } };
		expect(detectVendorField(fields, 'sg_vendors').field).toBe('sg_vendors');
		expect(detectVendorField(fields, 'code').problem).toBe('code is not a multi-entity field to Group.');
	});

	it('prefers sg_vendor_groups among several, and asks when it is not there', () => {
		const several: Record<string, { dataType: string; validTypes?: string[] }> = { ...ITEM, sg_vendors: { dataType: 'multi_entity', validTypes: ['Group'] } };
		expect(detectVendorField(several, undefined).field).toBe('sg_vendor_groups');
		const { sg_vendor_groups: _, ...rest } = several;
		const other = { ...rest, sg_other: { dataType: 'multi_entity', validTypes: ['Group'] } };
		expect(detectVendorField(other, undefined)).toMatchObject({ field: null, candidates: ['sg_other', 'sg_vendors'] });
		expect(detectVendorField({ code: { dataType: 'text' } }, undefined).problem).toBe('No multi-entity field to Group.');
	});
});

describe('statuses', () => {
	it('offers valid values less hidden ones, labelled (recipe 010)', () => {
		expect(offeredStatuses({ validValues: ['wtg', 'ip', 'fin'], hiddenValues: ['ip', 'zz'], displayValues: { wtg: 'Waiting to Start' } })).toEqual([
			{ code: 'wtg', label: 'Waiting to Start' },
			{ code: 'fin', label: 'fin' }
		]);
	});

	it('maps by label first, then by code, one site status per app status', () => {
		const map = mapStatuses([
			{ code: 'wtg', label: 'Waiting to Start' },
			{ code: 'ip', label: 'In Progress' },
			{ code: 'fin', label: 'Final' }
		]);
		expect(map.codes).toEqual({ draft: 'wtg', submitted: 'ip', awarded: 'fin' });
		expect(map.unmapped).toEqual(['not_awarded']);
	});

	it('takes a setting the project offers and reports one it does not', () => {
		const map = mapStatuses(
			[
				{ code: 'wtg', label: 'Waiting to Start' },
				{ code: 'na', label: 'N/A' }
			],
			{ not_awarded: 'na', awarded: 'zz' }
		);
		expect(map.codes).toEqual({ draft: 'wtg', not_awarded: 'na' });
		expect(map.problems).toEqual(["The setting names 'zz' for awarded; the project does not offer it."]);
	});
});

describe('readAccess and seenThrough', () => {
	it('reads denied as not allowed, allowed, and a conditional with its paths', () => {
		expect(readAccess(DENIED)).toEqual({ state: 'not_allowed' });
		expect(readAccess(ALLOWED)).toEqual({ state: 'allowed' });
		expect(readAccess(SHOT_RULE)).toEqual({
			state: 'conditional',
			paths: ['tasks.Task.task_assignees', 'sg_vendor_groups.Group.users', 'sg_vendor_groups.Group.sg_people']
		});
		expect(readAccess({ ok: false, status: 403, reason: 'Forbidden.' })).toEqual({ state: 'unreadable', reason: 'Forbidden.' });
	});

	it('finds the vendor field in the Shot rule, with the token or the person themselves (162)', () => {
		expect(seenThrough(SHOT_RULE, 'sg_vendor_groups')).toBe(true);
		expect(seenThrough(SHOT_RULE, 'sg_other')).toBe(false);
		const own = rights({ access: 'conditional', condition: { logical_operator: 'or', conditions: [{ path: 'sg_vendor_groups.Group.users', relation: 'is', values: [{ type: 'HumanUser', id: 42, valid: 'valid' }] }] } });
		expect(seenThrough(own, 'sg_vendor_groups')).toBe(false);
		expect(seenThrough(own, 'sg_vendor_groups', 42)).toBe(true);
		expect(seenThrough(undefined, 'sg_vendor_groups')).toBeNull();
	});
});

describe('setupReport', () => {
	it('is ready and safe when everything is there and vendors read neither type', () => {
		const report = setupReport(input());
		expect(report.ready).toBe(true);
		expect(report.safe).toBe(true);
		expect(report.fields.every((f) => f.state === 'present')).toBe(true);
		expect(report.vendorField.Shot.field).toBe('sg_vendor_groups');
		expect(report.access.awardReaches).toEqual({ Shot: true, Asset: true });
		expect(report.statuses.codes).toEqual({ draft: 'wtg', submitted: 'rev', awarded: 'awd', not_awarded: 'omt' });
		expect(report.risks).toEqual([]);
		expect(report.adminSteps).toEqual([]);
	});

	it('reports read allowed as a risk, names the three leak paths, and says what to set', () => {
		const report = setupReport(
			input({ vendorGroupName: 'Vendor', rights: { CustomEntity14: ALLOWED, CustomEntity15: SHOT_RULE, EventLogEntry: ALLOWED, Shot: SHOT_RULE, Asset: SHOT_RULE } })
		);
		expect(report.safe).toBe(false);
		expect(report.access.group).toBe('vendor');
		expect(report.access.bid).toEqual({ state: 'allowed' });
		expect(report.access.line.state).toBe('conditional');
		expect(report.risks).toContain("The Vendor role reads every Bid in its projects: every vendor sees every other vendor's prices.");
		for (const path of LEAK_PATHS) expect(report.risks).toContain(path);
		expect(report.adminSteps).toEqual([
			"In the Vendor role's permissions, set See entities to Not allowed for Bid.",
			"In the Vendor role's permissions, set See entities to Not allowed for Bid Line.",
			'Consider setting See entities to Not allowed for Event Log Entry on the Vendor role. While it reads the event log, values written to Bids reach it.'
		]);
	});

	it('cannot call a site safe when the rules are unreadable', () => {
		const forbidden: RightsRead = { ok: false, status: 403, reason: 'Insufficient permissions to read this permission group configuration.' };
		const report = setupReport(input({ rights: { CustomEntity14: forbidden, CustomEntity15: forbidden } }));
		expect(report.safe).toBe(false);
		expect(report.access.awardReaches).toEqual({ Shot: null, Asset: null });
		expect(report.risks[0]).toMatch(/could not be read.*Sign in as an Admin/);
	});

	it('lists each missing and wrong field, and a missing entity', () => {
		const bid = complete(BID_FIELDS, 'CustomEntity14');
		delete bid.sg_total;
		bid.sg_round = { dataType: 'text' };
		const report = setupReport(
			input({
				entityTypes: TYPES.filter((t) => t.name !== 'CustomEntity15'),
				fields: { CustomEntity14: bid, Shot: ITEM, Asset: ITEM }
			})
		);
		expect(report.ready).toBe(false);
		expect(report.entities.line).toEqual({ state: 'missing' });
		expect(report.fields.find((f) => f.spec.name === 'sg_total')?.state).toBe('missing');
		expect(report.fields.find((f) => f.spec.name === 'sg_round')).toMatchObject({ state: 'wrong_type', actual: { dataType: 'text' } });
		expect(report.fields.filter((f) => f.entity === 'line').every((f) => f.state === 'no_entity')).toBe(true);
		expect(report.adminSteps[0]).toBe("Enable a custom entity displayed 'Bid Line' in the site preferences.");
		expect(report.risks).toContain('Bid.sg_round is a text field; sg-bids needs number. It is never renamed or deleted.');
	});

	it('flags an entity link to the wrong type', () => {
		const line = complete(LINE_FIELDS, 'CustomEntity14');
		line.sg_item = { dataType: 'entity', validTypes: ['Shot'] };
		const report = setupReport(input({ fields: { ...input().fields, CustomEntity15: line } }));
		expect(report.fields.find((f) => f.spec.name === 'sg_item')?.state).toBe('wrong_targets');
	});

	it('says when an award would not reach the vendor through the field', () => {
		const rule = rights({ access: 'conditional', condition: { logical_operator: 'or', conditions: [{ path: 'tasks.Task.task_assignees', relation: 'is', values: [TOKEN] }] } });
		const report = setupReport(input({ rights: { ...input().rights, Shot: rule } }));
		expect(report.access.awardReaches.Shot).toBe(false);
		expect(report.risks).toContain('The vendor role does not see a Shot through sg_vendor_groups. An award would not reach the vendor.');
	});

	it('reports an app status the project does not offer', () => {
		const report = setupReport(input({ bidStatuses: [{ code: 'wtg', label: 'Waiting to Start' }] }));
		expect(report.statuses.unmapped).toEqual(['submitted', 'awarded', 'not_awarded']);
		expect(report.risks).toContain("The project offers no status for 'not awarded' on Bid. The Bid's status is left as it is for it.");
	});
});

describe('fieldsToCreate', () => {
	it('creates each missing field with its display name, description, targets and checkbox default', () => {
		const bid = complete(BID_FIELDS, 'CustomEntity14');
		delete bid.sg_vendor;
		delete bid.sg_round;
		bid.sg_total = { dataType: 'float' };
		const line = complete(LINE_FIELDS, 'CustomEntity14');
		delete line.sg_bid;
		delete line.sg_awarded;
		const report = setupReport(input({ fields: { CustomEntity14: bid, CustomEntity15: line, Shot: ITEM, Asset: ITEM } }));
		const plan = fieldsToCreate(report, TYPES);
		expect(plan.creates.map((c) => [c.entityType, c.name])).toEqual([
			['CustomEntity14', 'sg_vendor'],
			['CustomEntity14', 'sg_round'],
			['CustomEntity15', 'sg_bid'],
			['CustomEntity15', 'sg_awarded']
		]);
		expect(plan.creates[0].body).toEqual({
			data_type: 'entity',
			properties: [
				{ property_name: 'name', value: 'Vendor' },
				{ property_name: 'description', value: "Written by sg-bids. The vendor's Group." },
				{ property_name: 'valid_types', value: ['Group'] }
			]
		});
		expect(plan.creates[2].body.properties[2]).toEqual({ property_name: 'valid_types', value: ['CustomEntity14'] });
		expect(plan.creates[3].body.properties[2]).toEqual({ property_name: 'default_value', value: false });
		expect(plan.skipped).toEqual([{ entity: 'bid', name: 'sg_total', reason: 'It exists as float. Fix it in the web interface.' }]);
	});

	it('never sends a link type the schema does not spell that way (121)', () => {
		const line = complete(LINE_FIELDS, 'CustomEntity14');
		delete line.sg_item;
		const report = setupReport(input({ fields: { ...input().fields, CustomEntity15: line } }));
		const plan = fieldsToCreate(
			report,
			TYPES.filter((t) => t.name !== 'Asset')
		);
		expect(plan.creates).toEqual([]);
		expect(plan.skipped).toEqual([{ entity: 'line', name: 'sg_item', reason: 'The site has no type Asset.' }]);
	});

	it('creates nothing on a missing entity', () => {
		const report = setupReport(input({ entityTypes: TYPES.filter((t) => t.name !== 'CustomEntity15'), fields: { CustomEntity14: complete(BID_FIELDS, 'CustomEntity14') } }));
		const plan = fieldsToCreate(report, TYPES);
		expect(plan.creates).toEqual([]);
		expect(plan.skipped.every((s) => s.reason === 'Bid Line is not enabled.')).toBe(true);
	});
});

describe('createOutcome', () => {
	it('reads the name from links.self (019, 118)', () => {
		expect(createOutcome(201, { data: {}, links: { self: '/api/v1/schema/custom_entity14/fields/sg_round' } }, 'sg_round')).toEqual({ state: 'created', name: 'sg_round' });
		expect(createOutcome(201, { links: { self: '/api/v1/schema/custom_entity14/fields/sg_number' } }, 'sg_round')).toEqual({
			state: 'renamed',
			name: 'sg_number',
			expected: 'sg_round'
		});
	});

	it('tells a retired name from another refusal (119)', () => {
		const retired = {
			errors: [
				{
					status: 400,
					code: 105,
					title:
						'API schema_field_create() failed, there is a retired field with the same field_name: sg_round. Delete the retired field forever from the Trash Page in Shotgun and try again.',
					source: { field_name: 'there is a retired field with the same field_name: sg_round' }
				}
			]
		};
		expect(createOutcome(400, retired, 'sg_round')).toEqual({ state: 'retired', name: 'sg_round' });
		expect(createOutcome(400, { errors: [{ code: 103, title: 'Request Parameters invalid.' }] }, 'sg_round')).toEqual({
			state: 'failed',
			status: 400,
			title: 'Request Parameters invalid.'
		});
	});
});
