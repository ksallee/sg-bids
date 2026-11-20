/**
 * The request's header folded to one line in the page header, once it is filled: the code, the
 * round, the base currency and the bids due day, and how many header fields still need a fix. The
 * builder opens the header form while there is one to fix; the title is the page's own title.
 */

import type { HeaderForm } from './header';
import type { Problem } from './readiness';

export interface SummaryPart {
	readonly key: 'code' | 'round' | 'baseCurrency' | 'dueDate';
	readonly text: string;
	/** Drawn in the mono face: a code. */
	readonly mono?: true;
}

export interface HeaderSummary {
	readonly parts: readonly SummaryPart[];
	/** Header fields with an error. Warnings, the project and the items are not counted. */
	readonly toFix: number;
}

const NOT_HEADER = new Set(['project', 'items']);

export function headerSummary(form: HeaderForm, problems: readonly Problem[], day: (iso: string) => string): HeaderSummary {
	const parts: SummaryPart[] = [];
	if (form.code.trim()) parts.push({ key: 'code', text: form.code.trim(), mono: true });
	if (form.round.trim()) parts.push({ key: 'round', text: `Round ${form.round.trim()}` });
	if (form.baseCurrency.trim()) parts.push({ key: 'baseCurrency', text: form.baseCurrency.trim(), mono: true });
	parts.push({ key: 'dueDate', text: form.dueDate.trim() ? `Bids due ${day(form.dueDate.trim())}` : 'No due day' });
	const toFix = problems.filter((p) => p.tone === 'error' && !NOT_HEADER.has(p.target)).length;
	return { parts, toFix };
}
