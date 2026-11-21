/**
 * How far a draft request is from going out, in words. Pure, no I/O.
 *
 * Every problem names its field or its row and points at the control that fixes it: the page lists
 * them when Issue is pressed, and each one takes the person to the exact field and marks it. A list
 * never counts without naming. The order is the page's: the name, the bids and their rows, the
 * details, the vendors.
 *
 * The issue needs the name, the base currency and the day answers are due (`header.REQUIRED`), one
 * row at least, every bid holding a row, a code on every row (a row typed by hand starts with none),
 * one row not omitted, and one vendor, each with a name and an email. A due day in the past is a warning while the draft is worked on and an error at issue.
 */

import { checkHeader, type FieldProblem, type HeaderForm, type Stage } from './header';
import type { Day } from './model';
import { bidStats, type DraftBid, type DraftRows } from './request-draft';
import { isBlank, rowProblems, type VendorRow } from './vendor-rows';

/**
 * What a problem points at: a header field, the rows (`items`), one bid (`bid:<key>`), the vendors,
 * or one field of one vendor (`vendor:<id>:name`).
 */
export type Target = keyof HeaderForm | 'items' | 'vendors' | `bid:${string}` | `row:shot:${string}` | `row:asset:${string}` | `vendor:${string}:name` | `vendor:${string}:email`;

export interface Problem {
	readonly id: string;
	readonly target: Target;
	readonly label: string;
	readonly tone: 'error' | 'warning';
	/** Something still to do, not a value to fix: a blank required field, no row. */
	readonly missing: boolean;
	readonly short: string;
	readonly message: string;
}

/** What the page holds: the details, the bids and their rows, the vendor rows. */
export interface DraftFacts {
	readonly form: HeaderForm;
	readonly today: Day;
	readonly bids: readonly DraftBid[];
	readonly rows: DraftRows;
	readonly vendors: readonly VendorRow[];
}

export interface Readiness {
	/** What is wrong now, in the order of the page. */
	readonly problems: readonly Problem[];
	/** What stops the issue: the problems as the issue checks them. */
	readonly toIssue: readonly Problem[];
	readonly canIssue: boolean;
}

function fromField(p: FieldProblem): Problem {
	return { id: p.field, target: p.field, label: p.label, tone: p.tone, missing: p.missing, short: p.short, message: p.message };
}

const ROWS_LABEL = 'Rows';
const VENDORS_LABEL = 'Vendors';

function problemsAt(facts: DraftFacts, stage: Stage): Problem[] {
	const header = checkHeader(facts.form, facts.today, stage).map(fromField);
	const out: Problem[] = header.filter((p) => p.target === 'title');

	const all = [...facts.rows.shots, ...facts.rows.assets];
	if (all.length === 0) {
		out.push({ id: 'items', target: 'items', label: ROWS_LABEL, tone: 'error', missing: true, short: 'none yet', message: 'Add shots or assets to a bid.' });
	} else {
		const stats = bidStats(facts.bids, facts.rows);
		for (const bid of facts.bids) {
			if ((stats.get(bid.key)?.rows ?? 0) > 0) continue;
			out.push({ id: `bid:${bid.key}`, target: `bid:${bid.key}`, label: bid.name, tone: 'error', missing: true, short: 'no rows', message: `${bid.name} holds no rows. Add rows to it, or delete it.` });
		}
		// A row typed by hand and left without a code: the list takes the person to it.
		const names = new Map(facts.bids.map((b) => [b.key, b.name]));
		for (const [kind, list] of [
			['shot', facts.rows.shots.map((r) => ({ id: r.id, code: r.code, package: r.package }))],
			['asset', facts.rows.assets.map((r) => ({ id: r.id, code: r.name, package: r.package }))]
		] as const) {
			for (const row of list) {
				if ((row.code ?? '').trim() !== '') continue;
				const where = names.get(row.package ?? '');
				const target = `row:${kind}:${row.id}` as const;
				out.push({ id: target, target, label: kind === 'shot' ? 'Shots' : 'Assets', tone: 'error', missing: true, short: 'no code', message: `${kind === 'shot' ? 'A shot' : 'An asset'} row${where ? ` in ${where}` : ''} has no code. Type one, or remove the row.` });
			}
		}
		if (all.every((r) => r.omitted)) {
			out.push({ id: 'items', target: 'items', label: ROWS_LABEL, tone: 'error', missing: false, short: 'every one is omitted', message: 'Every row is omitted. Bring one back.' });
		}
	}

	out.push(...header.filter((p) => p.target !== 'title'));

	const typed = facts.vendors.map((v, i) => ({ v, n: i + 1 })).filter(({ v }) => !isBlank(v));
	if (typed.length === 0) out.push({ id: 'vendors', target: 'vendors', label: VENDORS_LABEL, tone: 'error', missing: true, short: 'none yet', message: 'Add a vendor to send the request to.' });
	for (const { v, n } of typed) {
		const wrong = rowProblems(v);
		const label = v.name.trim() || `Vendor ${n}`;
		if (wrong.name) out.push({ id: `vendor:${v.id}:name`, target: `vendor:${v.id}:name`, label, tone: 'error', missing: true, short: 'no name', message: wrong.name });
		if (wrong.email) {
			const blank = v.email.trim() === '';
			out.push({ id: `vendor:${v.id}:email`, target: `vendor:${v.id}:email`, label, tone: 'error', missing: blank, short: blank ? 'no email' : 'not an address', message: wrong.email });
		}
	}
	return out;
}

export function readiness(facts: DraftFacts): Readiness {
	const problems = problemsAt(facts, 'draft');
	const toIssue = problemsAt(facts, 'issue').filter((p) => p.tone === 'error');
	return { problems, toIssue, canIssue: toIssue.length === 0 };
}

/** The id of the control a problem points at: `f-` and the target, safe as an element id. */
export function controlId(target: Target): string {
	return `f-${target.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}
