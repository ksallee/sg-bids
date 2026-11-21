import { describe, expect, it } from 'vitest';
import { emptyHeaderForm, type HeaderForm } from './header';
import { savableHeader } from './persist';

const project = { id: 85, name: 'Demo Show' };
const form: HeaderForm = { ...emptyHeaderForm('GBP'), code: 'ROOF-01', title: 'Rooftop', dueDate: '2026-12-01', assumptions: '4K\n\nPlates by day 3' };

describe('savableHeader', () => {
	it('is the header the form makes, with the project', () => {
		expect(savableHeader(form, project)).toEqual({
			code: 'ROOF-01',
			title: 'Rooftop',
			project: 'Demo Show',
			projectRef: { type: 'Project', id: 85 },
			round: 1,
			dueDate: '2026-12-01',
			baseCurrency: 'GBP',
			assumptions: ['4K', 'Plates by day 3']
		});
	});

	it('leaves out a date or a link that does not pass yet, so a half typed form still saves', () => {
		const out = savableHeader({ ...form, dueDate: '2026-02-30', turnoverDate: 'soon', deliveryDate: '2027-01-10', round: 'x', materialLink: 'intranet/cut' }, project);
		expect(out.materialLink).toBeUndefined();
		expect(out.dueDate).toBeUndefined();
		expect(out.turnoverDate).toBeUndefined();
		expect(out.deliveryDate).toBe('2027-01-10');
		expect(out.round).toBe(1);
	});

	it('keeps the base currency only when it is on the list, else USD', () => {
		expect(savableHeader({ ...form, baseCurrency: 'XAU' }, project).baseCurrency).toBe('USD');
	});
});
