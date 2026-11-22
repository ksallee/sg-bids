/**
 * The request header as production types it: the form, its checks, and the `RequestHeader` it
 * becomes. Every field is kept as typed so a half-filled form survives a reload; `toHeader` turns
 * it into the model whatever its state, and `checkHeader` names, field by field, what is wrong.
 */

import { isCurrency } from './currencies';
import type { Day, RequestHeader } from './model';
import { isWebLink } from './safe-href';

export interface HeaderForm {
	code: string;
	title: string;
	round: string;
	dueDate: string;
	baseCurrency: string;
	turnoverDate: string;
	deliveryDate: string;
	deliveryFormat: string;
	materialLink: string;
	/** One assumption per line. */
	assumptions: string;
}

/** The project the request is for. */
export interface ProjectPick {
	readonly id: number;
	readonly name: string;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ROUND = /^[1-9]\d*$/;

/** A real calendar day written `YYYY-MM-DD`. */
export function isDay(text: string): boolean {
	const parts = DAY.exec(text);
	if (!parts) return false;
	const [year, month, day] = parts.slice(1).map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function emptyHeaderForm(baseCurrency = 'USD'): HeaderForm {
	return {
		code: '',
		title: '',
		round: '1',
		dueDate: '',
		baseCurrency,
		turnoverDate: '',
		deliveryDate: '',
		deliveryFormat: '',
		materialLink: '',
		assumptions: ''
	};
}

export function splitAssumptions(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== '');
}

/**
 * The header fields in the order the page shows them: the name in the title, then the details. The
 * code and the round are the app's: never typed, last.
 */
export const FIELD_ORDER: readonly (keyof HeaderForm)[] = [
	'title',
	'dueDate',
	'baseCurrency',
	'turnoverDate',
	'deliveryDate',
	'deliveryFormat',
	'materialLink',
	'assumptions',
	'round',
	'code'
];

/** What each field is called, in the form and in every message about it. */
export const LABELS: Readonly<Record<keyof HeaderForm, string>> = {
	title: 'Name',
	code: 'Code',
	round: 'Round',
	baseCurrency: 'Base currency',
	dueDate: 'Answers due',
	turnoverDate: 'Turnover',
	deliveryDate: 'Delivery',
	deliveryFormat: 'Delivery format',
	materialLink: 'Bid material',
	assumptions: 'Assumptions'
};

/**
 * What a request cannot go out without: its name, the currency it is compared in, and the day
 * answers are due. The code is made from the name when the request is made and the round starts at
 * 1: neither is typed. Everything else is optional.
 */
export const REQUIRED: readonly (keyof HeaderForm)[] = ['title', 'baseCurrency', 'dueDate'];

/** The optional fields, in the groups the form folds them into. The due date sits with the required ones. */
export const OPTIONAL_GROUPS = {
	delivery: ['turnoverDate', 'deliveryDate', 'deliveryFormat', 'materialLink'],
	assumptions: ['assumptions']
} as const satisfies Record<string, readonly (keyof HeaderForm)[]>;

/** A draft is checked as it is typed; an issue checks it for good. Only a past due date differs. */
export type Stage = 'draft' | 'issue';

export interface FieldProblem {
	readonly field: keyof HeaderForm;
	/** The field's name, as the form shows it. */
	readonly label: string;
	/** An error stops the issue. A warning stops nothing yet. */
	readonly tone: 'error' | 'warning';
	/** The field is blank: a thing still to do rather than a value to fix. */
	readonly missing: boolean;
	/** A few words for a summary line: `Title: missing`. */
	readonly short: string;
	/** The sentence beside the field. It names the field. */
	readonly message: string;
}

const DAY_WORDS: Readonly<Record<'dueDate' | 'turnoverDate' | 'deliveryDate', string>> = {
	dueDate: 'answers due day',
	turnoverDate: 'turnover day',
	deliveryDate: 'delivery day'
};

/** Every problem with the header, in the order of the form. Empty when nothing is wrong. `today` is `YYYY-MM-DD`. */
export function checkHeader(form: HeaderForm, today: Day, stage: Stage): FieldProblem[] {
	const found = new Map<keyof HeaderForm, Omit<FieldProblem, 'field' | 'label' | 'missing'>>();
	const error = (field: keyof HeaderForm, short: string, message: string) => found.set(field, { tone: 'error', short, message });

	if (form.title.trim() === '') error('title', 'missing', 'Name the request.');
	if (form.dueDate.trim() === '') error('dueDate', 'missing', 'Pick the day answers are due.');
	if (!ROUND.test(form.round.trim())) error('round', 'not a whole number from 1', 'The round is a whole number from 1.');

	const currency = form.baseCurrency.trim();
	if (currency === '') error('baseCurrency', 'missing', 'Pick a base currency.');
	else if (!isCurrency(currency)) error('baseCurrency', 'not on the list', `${currency} is not a currency on the list. Pick a base currency.`);

	for (const field of ['dueDate', 'turnoverDate', 'deliveryDate'] as const) {
		const text = form[field].trim();
		if (text !== '' && !isDay(text)) error(field, 'not a day', `Write the ${DAY_WORDS[field]} as YYYY-MM-DD.`);
	}
	const due = form.dueDate.trim();
	if (!found.has('dueDate') && due !== '' && due < today) {
		found.set('dueDate', {
			tone: stage === 'issue' ? 'error' : 'warning',
			short: 'the day has passed',
			message: stage === 'issue' ? 'The answers due day has passed. Move it to issue.' : 'The answers due day has passed. Move it before you issue.'
		});
	}
	const turnover = form.turnoverDate.trim();
	const delivery = form.deliveryDate.trim();
	if (!found.has('turnoverDate') && !found.has('deliveryDate') && turnover !== '' && delivery !== '' && delivery < turnover) {
		error('deliveryDate', 'before turnover', 'Delivery comes before turnover. Move one of them.');
	}

	const link = form.materialLink.trim();
	if (link !== '' && !isWebLink(link)) error('materialLink', 'not a web link', 'The bid material link starts with https:// or http://.');

	return FIELD_ORDER.flatMap((field) => {
		const problem = found.get(field);
		return problem ? [{ field, label: LABELS[field], ...problem, missing: form[field].trim() === '' }] : [];
	});
}

const CODE_LENGTH = 16;

/**
 * A request code made from the project's name: its words in capitals, joined by `_`, cut at a word
 * to 16 characters, then the first number from 01 that no request of the project uses. A new round
 * keeps the code, so the round is not in it. Production can change it.
 */
export function suggestCode(projectName: string, taken: readonly string[]): string {
	const words = projectName
		.normalize('NFD')
		.replace(/[^\x20-\x7e]/g, '')
		.toUpperCase()
		.split(/[^A-Z0-9]+/)
		.filter(Boolean);
	let stem = '';
	for (const word of words) {
		const next = stem ? `${stem}_${word}` : word;
		if (next.length > CODE_LENGTH) break;
		stem = next;
	}
	if (!stem) stem = words[0]?.slice(0, CODE_LENGTH) || 'BID';
	const used = new Set(taken);
	for (let n = 1; ; n++) {
		const code = `${stem}-${String(n).padStart(2, '0')}`;
		if (!used.has(code)) return code;
	}
}

/** The form's round. One it cannot read is 1. */
export function roundOf(form: HeaderForm): number {
	return ROUND.test(form.round.trim()) ? Number(form.round.trim()) : 1;
}

/** The model's header from the form, blank fields left out. A round it cannot read is 1. */
export function toHeader(form: HeaderForm, project: ProjectPick): RequestHeader {
	const text = (value: string): string | undefined => (value.trim() === '' ? undefined : value.trim());
	const round = roundOf(form);
	const header: RequestHeader = {
		code: text(form.code),
		title: text(form.title),
		project: project.name,
		projectRef: { type: 'Project', id: project.id },
		round,
		dueDate: text(form.dueDate),
		baseCurrency: form.baseCurrency.trim(),
		turnoverDate: text(form.turnoverDate),
		deliveryDate: text(form.deliveryDate),
		deliveryFormat: text(form.deliveryFormat),
		materialLink: text(form.materialLink),
		assumptions: splitAssumptions(form.assumptions)
	};
	return Object.fromEntries(Object.entries(header).filter(([, value]) => value !== undefined)) as unknown as RequestHeader;
}

/** The form a header was made from. */
export function headerForm(header: RequestHeader): HeaderForm {
	return {
		code: header.code ?? '',
		title: header.title ?? '',
		round: String(header.round),
		dueDate: header.dueDate ?? '',
		baseCurrency: header.baseCurrency,
		turnoverDate: header.turnoverDate ?? '',
		deliveryDate: header.deliveryDate ?? '',
		deliveryFormat: header.deliveryFormat ?? '',
		materialLink: header.materialLink ?? '',
		assumptions: header.assumptions.join('\n')
	};
}
