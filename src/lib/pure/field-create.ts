/**
 * Creating a Shot or Asset field from the mapping, when the site has none for a concept the request
 * carries. What is sent, what the site will name it, how to read the answer, and who may. Pure, no
 * I/O: the calls are in `src/lib/io/fpt-field-create.ts`. Facts from `../sg-groundtruth/corpus`:
 *
 * - `POST /schema/<Type>/fields` takes `data_type` and `properties`: `name` (the display name),
 *   `description`, and for a list `valid_values` (019, 116). No default value is sent: a list
 *   default would fill every Shot.
 * - The API name is `sg_` plus the display name lowercased, every character outside `[a-z0-9_]` a
 *   `_`. One character outside ASCII and the field is named `sg_<data_type>` instead (117), so such
 *   a name is refused here.
 * - A second field deriving a name the site holds is created as `<name>_1`, at 201 (019). So a name
 *   the schema holds is refused, and the io reads the field again just before the create.
 * - The name comes back only in `links.self`, last segment (019, 118). A name a retired field holds
 *   is 400 code 105 with `source.field_name` (119); only the field trash frees it (120).
 * - An Artist creating a field gets 500 code 105, `doesn't have permission to create a Field`. An
 *   Admin person and the script key get 201. No call answers "may I" without trying, and no other
 *   group was measured (132). Treat any 500 from a schema write as a possible refusal.
 * - A new field is visible in every project (115). It is never retired here: a retired name stays
 *   spent until the trash is emptied (019, 040).
 * - A link field also makes a field on every type it links (142), so no link is created here.
 */

import type { FieldSchema } from 'sg-widgets-core';
import { slotsFor, type ItemKind, type Slot } from './field-map';
import { fieldName } from './fpt-fields';
import type { FptUser } from './fpt-session';

export interface CreateDraft {
	readonly display: string;
	/** For a list: one value per entry. Ignored otherwise. */
	readonly values: readonly string[];
}

export interface CreateProblem {
	readonly field: 'display' | 'values';
	readonly message: string;
}

export interface PlannedCreate {
	readonly ok: true;
	readonly kind: ItemKind;
	readonly slot: Slot;
	readonly entityType: 'Shot' | 'Asset';
	/** The API name the site will give it (117). */
	readonly name: string;
	readonly display: string;
	readonly dataType: 'text' | 'number' | 'list';
	/** For a list. */
	readonly values?: readonly string[];
	readonly body: {
		readonly data_type: string;
		readonly properties: readonly { readonly property_name: string; readonly value: unknown }[];
	};
}

export type CreatePlan = PlannedCreate | { readonly ok: false; readonly problems: readonly CreateProblem[] };

function specOf(kind: ItemKind, slot: Slot) {
	return slotsFor(kind).find((s) => s.slot === slot);
}

/** What the dialog opens with: the slot's display name and values. Null for a slot the app does not create. */
export function createDraft(kind: ItemKind, slot: Slot): CreateDraft | null {
	const create = specOf(kind, slot)?.create;
	return create ? { display: create.display, values: [...(create.values ?? [])] } : null;
}

const ASCII = /^[\x20-\x7e]*$/;

/** The create for the draft, or every problem with it, each on its field. */
export function planCreate(kind: ItemKind, slot: Slot, draft: CreateDraft, schema: Record<string, FieldSchema>): CreatePlan {
	const spec = specOf(kind, slot);
	const create = spec?.create;
	if (!spec || !create) {
		return { ok: false, problems: [{ field: 'display', message: 'A link field cannot be created here. It also adds a field to the type it links. Ask an admin.' }] };
	}
	const entityType = kind === 'shot' ? 'Shot' : 'Asset';
	const display = draft.display.trim();
	const values = create.dataType === 'list' ? [...new Set(draft.values.map((v) => v.trim()).filter((v) => v !== ''))] : undefined;
	const problems: CreateProblem[] = [];
	const name = ASCII.test(display) ? fieldName(display) : null;

	if (display === '') problems.push({ field: 'display', message: 'Give the field a name.' });
	else if (name === null) problems.push({ field: 'display', message: `Use plain letters, digits and spaces. With any other character Flow PT names the field sg_${create.dataType}.` });
	else if (schema[name]) {
		problems.push({ field: 'display', message: `${entityType} already has ${name}, shown as ${schema[name].displayName || name}. Map that one, or pick another name.` });
	} else {
		const shown = Object.values(schema).find((f) => f.displayName.trim().toLowerCase() === display.toLowerCase());
		if (shown) problems.push({ field: 'display', message: `${entityType} already has a field shown as ${shown.displayName} (${shown.name}). Pick another name.` });
	}
	if (values && values.length === 0) problems.push({ field: 'values', message: 'Give the list at least one value.' });
	if (problems.length > 0 || !name) return { ok: false, problems };

	const properties: { property_name: string; value: unknown }[] = [
		{ property_name: 'name', value: display },
		{ property_name: 'description', value: `Added by sg-bids for bid requests. ${spec.line}` }
	];
	if (values) properties.push({ property_name: 'valid_values', value: values });
	return {
		ok: true,
		kind,
		slot,
		entityType,
		name,
		display,
		dataType: create.dataType,
		...(values ? { values } : {}),
		body: { data_type: create.dataType, properties }
	};
}

export type CreateAnswer =
	| { readonly state: 'created'; readonly name: string }
	| { readonly state: 'renamed'; readonly name: string; readonly expected: string }
	/** The field was found live just before the create, so none was sent. */
	| { readonly state: 'exists'; readonly name: string }
	| { readonly state: 'retired'; readonly name: string }
	| { readonly state: 'refused' }
	| { readonly state: 'failed'; readonly status: number; readonly title: string };

type ErrorBody = { errors?: { code?: unknown; title?: unknown; source?: { field_name?: unknown } | null }[] } | null;

/** What a field create answered. */
export function createAnswer(status: number, body: unknown, expected: string): CreateAnswer {
	if (status === 201 || status === 200) {
		const self = (body as { links?: { self?: unknown } } | null)?.links?.self;
		const name = typeof self === 'string' ? (self.split('/').pop() ?? '') : '';
		return name === expected ? { state: 'created', name } : { state: 'renamed', name, expected };
	}
	const error = (body as ErrorBody)?.errors?.[0];
	const title = typeof error?.title === 'string' ? error.title : `HTTP ${status}`;
	if (status === 400 && error?.code === 105 && error.source?.field_name !== undefined) {
		return { state: 'retired', name: /same field_name: ([A-Za-z0-9_]+)/.exec(title)?.[1] ?? expected };
	}
	if (status === 500 && /doesn't have permission/i.test(title)) return { state: 'refused' };
	return { state: 'failed', status, title };
}

export type CreateRight = { readonly state: 'yes' | 'no' | 'unknown'; readonly reason: string };

/**
 * Whether the person may create a field, from who the bearer is and their permission group code
 * (`fpt-session.ownGroupCode`). Only the script, Admin and Artist were measured (132).
 */
export function createRight(user: FptUser | null, groupCode: string | null): CreateRight {
	if (user?.type === 'ApiUser') return { state: 'yes', reason: 'The script key may create fields.' };
	const code = groupCode?.toLowerCase() ?? null;
	if (user?.type === 'HumanUser' && code === 'admin') return { state: 'yes', reason: 'Admins may create fields.' };
	if (user?.type === 'HumanUser' && code === 'artist') {
		return { state: 'no', reason: `Your permission group, ${groupCode}, may not create fields in Flow PT. Ask an admin.` };
	}
	return { state: 'unknown', reason: 'Only admins are known to have this right. Flow PT may refuse. Then nothing is created.' };
}

/** The answer in words, with what to do next. */
export function answerWords(answer: CreateAnswer, entityType: string): string {
	switch (answer.state) {
		case 'created':
			return `Created ${answer.name} on ${entityType}. It is mapped.`;
		case 'renamed':
			return `Flow PT named it ${answer.name}, not ${answer.expected}. It is mapped as ${answer.name}.`;
		case 'exists':
			return `${entityType} has ${answer.name} now. Nothing was created. Map it from the list.`;
		case 'retired':
			return `A retired field holds the name ${answer.name}. Pick another name, or empty the field trash in Flow PT: open the admin menu, then Trash, then Fields.`;
		case 'refused':
			return 'Flow PT refused: you may not create fields. Ask an admin, or set it per item in the request.';
		case 'failed':
			return `Flow PT answered ${answer.status}: ${answer.title.replace(/\.$/, '')}.${answer.status >= 500 ? ' A 500 can be a refusal of the right to create fields.' : ''}`;
	}
}
