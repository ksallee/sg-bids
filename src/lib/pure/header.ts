/**
 * The request header as production types it: the form, its checks, and the `RequestHeader` it
 * becomes. Every field is kept as typed so a half-filled form survives a reload; `toHeader` turns
 * it into the model whatever its state, and `validateHeader` says what stops it from going out.
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

export type HeaderErrors = Partial<Record<keyof HeaderForm, string>>;

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

function checkDay(text: string): string | undefined {
	return text.trim() === '' || isDay(text.trim()) ? undefined : 'Write the day as YYYY-MM-DD.';
}

/** What stops the header from going out, by field. Empty when nothing does. `today` is `YYYY-MM-DD`. */
export function validateHeader(form: HeaderForm, today: Day): HeaderErrors {
	const errors: HeaderErrors = {};
	if (form.code.trim() === '') errors.code = 'Give the request a code.';
	if (form.title.trim() === '') errors.title = 'Give the request a title.';
	if (!ROUND.test(form.round.trim())) errors.round = 'The round is a whole number from 1.';

	const currency = form.baseCurrency.trim();
	if (currency === '') errors.baseCurrency = 'Pick a base currency.';
	else if (!isCurrency(currency)) errors.baseCurrency = `${currency} is not a currency on the list.`;

	const due = form.dueDate.trim();
	errors.dueDate = checkDay(due);
	if (!errors.dueDate && due !== '' && due < today) errors.dueDate = 'The due date has passed.';

	errors.turnoverDate = checkDay(form.turnoverDate);
	errors.deliveryDate = checkDay(form.deliveryDate);
	const turnover = form.turnoverDate.trim();
	const delivery = form.deliveryDate.trim();
	if (!errors.turnoverDate && !errors.deliveryDate && turnover !== '' && delivery !== '' && delivery < turnover) {
		errors.deliveryDate = 'Delivery comes before turnover.';
	}

	const link = form.materialLink.trim();
	if (link !== '' && !isWebLink(link)) errors.materialLink = 'The link starts with https:// or http://.';

	for (const key of Object.keys(errors) as (keyof HeaderForm)[]) if (errors[key] === undefined) delete errors[key];
	return errors;
}

/** The model's header from the form, blank fields left out. A round it cannot read is 1. */
export function toHeader(form: HeaderForm, project: ProjectPick): RequestHeader {
	const text = (value: string): string | undefined => (value.trim() === '' ? undefined : value.trim());
	const round = ROUND.test(form.round.trim()) ? Number(form.round.trim()) : 1;
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
