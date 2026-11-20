import { describe, expect, it } from 'vitest';
import { headerSummary } from './header-summary';
import type { HeaderForm } from './header';
import type { Problem } from './readiness';

const form = (extra: Partial<HeaderForm> = {}): HeaderForm => ({
	title: 'Forest sequences',
	code: 'BBB-01',
	round: '1',
	baseCurrency: 'USD',
	dueDate: '2026-12-04',
	turnoverDate: '',
	deliveryDate: '',
	deliveryFormat: '',
	materialLink: '',
	assumptions: '',
	...extra
});

const problem = (target: Problem['target'], tone: Problem['tone'] = 'error'): Problem => ({
	id: `${target}-x`,
	target,
	label: String(target),
	tone,
	missing: true,
	message: 'Fix it.',
	short: 'fix'
});

describe('headerSummary', () => {
	it('sums up a valid header in one line: code, round, currency, due day', () => {
		const summary = headerSummary(form(), [], (day) => `on ${day}`);
		expect(summary.toFix).toBe(0);
		expect(summary.parts).toEqual([
			{ key: 'code', text: 'BBB-01', mono: true },
			{ key: 'round', text: 'Round 1' },
			{ key: 'baseCurrency', text: 'USD', mono: true },
			{ key: 'dueDate', text: 'Bids due on 2026-12-04' }
		]);
	});

	it('leaves out what is blank, and says no due day', () => {
		const summary = headerSummary(form({ code: ' ', baseCurrency: '', dueDate: '' }), [], (d) => d);
		expect(summary.parts.map((p) => p.key)).toEqual(['round', 'dueDate']);
		expect(summary.parts[1].text).toBe('No due day');
	});

	it('counts the header errors to fix, not warnings, the project or the items', () => {
		const problems = [problem('title'), problem('code'), problem('dueDate', 'warning'), problem('items'), problem('project'), problem('deliveryFormat')];
		expect(headerSummary(form(), problems, (d) => d).toFix).toBe(3);
	});
});
