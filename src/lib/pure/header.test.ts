import { describe, expect, it } from 'vitest';
import { emptyHeaderForm, headerForm, isDay, splitAssumptions, toHeader, validateHeader, type HeaderForm } from './header';

const TODAY = '2026-11-20';
const project = { id: 85, name: 'Demo Show' };

function form(extra: Partial<HeaderForm> = {}): HeaderForm {
	return { ...emptyHeaderForm(), code: 'DS_R1', title: 'Main bid', ...extra };
}

describe('isDay', () => {
	it('takes a real day written YYYY-MM-DD', () => {
		expect(isDay('2026-02-28')).toBe(true);
		expect(isDay('2028-02-29')).toBe(true);
	});
	it('refuses anything else', () => {
		for (const text of ['2026-02-29', '2026-13-01', '26-01-01', '2026-1-1', '', 'tomorrow']) expect(isDay(text)).toBe(false);
	});
});

describe('emptyHeaderForm', () => {
	it('starts at round 1 in USD with nothing else set', () => {
		const empty = emptyHeaderForm();
		expect(empty.round).toBe('1');
		expect(empty.baseCurrency).toBe('USD');
		expect(empty.code).toBe('');
	});
	it('takes another base currency', () => {
		expect(emptyHeaderForm('EUR').baseCurrency).toBe('EUR');
	});
});

describe('validateHeader', () => {
	it('passes a complete form', () => {
		const errors = validateHeader(
			form({ dueDate: '2026-12-01', turnoverDate: '2026-12-05', deliveryDate: '2027-03-01', materialLink: 'https://example.com/cut' }),
			TODAY
		);
		expect(errors).toEqual({});
	});

	it('needs a code, a title and a base currency', () => {
		const errors = validateHeader(form({ code: '  ', title: '', baseCurrency: '' }), TODAY);
		expect(errors.code).toBe('Give the request a code.');
		expect(errors.title).toBe('Give the request a title.');
		expect(errors.baseCurrency).toBe('Pick a base currency.');
	});

	it('refuses a currency off the list', () => {
		expect(validateHeader(form({ baseCurrency: 'XAU' }), TODAY).baseCurrency).toBe('XAU is not a currency on the list.');
	});

	it('needs a whole round from 1', () => {
		for (const round of ['0', '-1', '1.5', 'one', '']) expect(validateHeader(form({ round }), TODAY).round).toBe('The round is a whole number from 1.');
		expect(validateHeader(form({ round: ' 2 ' }), TODAY).round).toBeUndefined();
	});

	it('checks each date is a real day', () => {
		const errors = validateHeader(form({ dueDate: '2026-02-30', turnoverDate: '12/01/2026', deliveryDate: 'soon' }), TODAY);
		expect(errors.dueDate).toBe('Write the day as YYYY-MM-DD.');
		expect(errors.turnoverDate).toBe('Write the day as YYYY-MM-DD.');
		expect(errors.deliveryDate).toBe('Write the day as YYYY-MM-DD.');
	});

	it('refuses a due date in the past, takes today', () => {
		expect(validateHeader(form({ dueDate: '2026-11-19' }), TODAY).dueDate).toBe('The due date has passed.');
		expect(validateHeader(form({ dueDate: TODAY }), TODAY).dueDate).toBeUndefined();
	});

	it('wants delivery after turnover', () => {
		const errors = validateHeader(form({ turnoverDate: '2027-01-10', deliveryDate: '2027-01-09' }), TODAY);
		expect(errors.deliveryDate).toBe('Delivery comes before turnover.');
		expect(validateHeader(form({ turnoverDate: '2027-01-10', deliveryDate: '2027-01-10' }), TODAY).deliveryDate).toBeUndefined();
	});

	it('wants the material link to be a web address', () => {
		expect(validateHeader(form({ materialLink: 'ftp://x' }), TODAY).materialLink).toBe('The link starts with https:// or http://.');
		expect(validateHeader(form({ materialLink: 'not a link' }), TODAY).materialLink).toBe('The link starts with https:// or http://.');
		expect(validateHeader(form({ materialLink: 'http://intra/cut' }), TODAY).materialLink).toBeUndefined();
	});
});

describe('splitAssumptions', () => {
	it('keeps one assumption per non-empty line, trimmed', () => {
		expect(splitAssumptions('  Plates are 4K.\n\n  Client supplies LUTs. \r\n')).toEqual(['Plates are 4K.', 'Client supplies LUTs.']);
		expect(splitAssumptions('')).toEqual([]);
	});
});

describe('toHeader', () => {
	it('writes the request header, blank fields left out', () => {
		const header = toHeader(form({ round: '2', assumptions: 'A\nB' }), project);
		expect(header).toEqual({
			code: 'DS_R1',
			title: 'Main bid',
			project: 'Demo Show',
			projectRef: { type: 'Project', id: 85 },
			round: 2,
			baseCurrency: 'USD',
			assumptions: ['A', 'B']
		});
	});

	it('keeps every set field, trimmed', () => {
		const header = toHeader(
			form({ dueDate: '2026-12-01', turnoverDate: '2026-12-05', deliveryDate: '2027-03-01', deliveryFormat: ' EXR 16-bit ', materialLink: 'https://x.test' }),
			project
		);
		expect(header.dueDate).toBe('2026-12-01');
		expect(header.turnoverDate).toBe('2026-12-05');
		expect(header.deliveryDate).toBe('2027-03-01');
		expect(header.deliveryFormat).toBe('EXR 16-bit');
		expect(header.materialLink).toBe('https://x.test');
	});

	it('reads a round it cannot parse as 1, so a draft always holds', () => {
		expect(toHeader(form({ round: 'x' }), project).round).toBe(1);
	});
});

describe('headerForm', () => {
	it('reads a header back into the form it came from', () => {
		const start = form({ round: '3', dueDate: '2026-12-01', deliveryFormat: 'ProRes', assumptions: 'A\nB' });
		expect(headerForm(toHeader(start, project))).toEqual(start);
	});
});
