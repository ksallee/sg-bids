import { describe, expect, it } from 'vitest';
import { OPTIONAL_GROUPS, REQUIRED, checkHeader, emptyHeaderForm, headerForm, isDay, roundOf, splitAssumptions, suggestCode, toHeader, type HeaderForm, type Stage } from './header';

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

describe('checkHeader', () => {
	const at = (f: HeaderForm, stage: Stage = 'draft') => Object.fromEntries(checkHeader(f, TODAY, stage).map((p) => [p.field, p]));

	it('passes a complete form', () => {
		const f = form({ dueDate: '2026-12-01', turnoverDate: '2026-12-05', deliveryDate: '2027-03-01', materialLink: 'https://example.com/cut' });
		expect(checkHeader(f, TODAY, 'draft')).toEqual([]);
		expect(checkHeader(f, TODAY, 'issue')).toEqual([]);
	});

	it('needs a name, a base currency and the day answers are due, each named in words; the code is the app’s', () => {
		const p = at(form({ code: '  ', title: '', baseCurrency: '', round: '', dueDate: '' }));
		expect(p.title).toEqual({ field: 'title', label: 'Name', tone: 'error', missing: true, short: 'missing', message: 'Name the request.' });
		expect(p.code).toBeUndefined();
		expect(p.round.message).toBe('The round is a whole number from 1.');
		expect(p.baseCurrency.message).toBe('Pick a base currency.');
		expect(p.dueDate).toEqual({ field: 'dueDate', label: 'Answers due', tone: 'error', missing: true, short: 'missing', message: 'Pick the day answers are due.' });
	});

	it('lists problems in the order of the form', () => {
		const order = checkHeader(form({ title: '', code: '', materialLink: 'x', dueDate: 'soon' }), TODAY, 'draft').map((p) => p.field);
		expect(order).toEqual(['title', 'dueDate', 'materialLink']);
	});

	it('refuses a currency off the list', () => {
		expect(at(form({ baseCurrency: 'XAU' })).baseCurrency.message).toBe('XAU is not a currency on the list. Pick a base currency.');
	});

	it('needs a whole round from 1', () => {
		for (const round of ['0', '-1', '1.5', 'one', '']) expect(at(form({ round })).round.message).toBe('The round is a whole number from 1.');
		expect(at(form({ round: ' 2 ' })).round).toBeUndefined();
	});

	it('names each date that is not a real day', () => {
		const p = at(form({ dueDate: '2026-02-30', turnoverDate: '12/01/2026', deliveryDate: 'soon' }));
		expect(p.dueDate.message).toBe('Write the answers due day as YYYY-MM-DD.');
		expect(p.turnoverDate.message).toBe('Write the turnover day as YYYY-MM-DD.');
		expect(p.deliveryDate.message).toBe('Write the delivery day as YYYY-MM-DD.');
	});

	it('warns on a due date in the past while drafting, refuses it at issue, takes today', () => {
		expect(at(form({ dueDate: '2026-11-19' })).dueDate).toEqual({
			field: 'dueDate',
			label: 'Answers due',
			tone: 'warning',
			missing: false,
			short: 'the day has passed',
			message: 'The answers due day has passed. Move it before you issue.'
		});
		expect(at(form({ dueDate: '2026-11-19' }), 'issue').dueDate.tone).toBe('error');
		expect(at(form({ dueDate: TODAY }), 'issue').dueDate).toBeUndefined();
	});

	it('wants delivery after turnover', () => {
		expect(at(form({ turnoverDate: '2027-01-10', deliveryDate: '2027-01-09' })).deliveryDate.message).toBe('Delivery comes before turnover. Move one of them.');
		expect(at(form({ turnoverDate: '2027-01-10', deliveryDate: '2027-01-10' })).deliveryDate).toBeUndefined();
	});

	it('wants the material link to be a web address', () => {
		expect(at(form({ materialLink: 'ftp://x' })).materialLink.message).toBe('The bid material link starts with https:// or http://.');
		expect(at(form({ materialLink: 'http://intra/cut' })).materialLink).toBeUndefined();
	});

	it('marks only what cannot be blank as required', () => {
		expect(REQUIRED).toEqual(['title', 'baseCurrency', 'dueDate']);
		expect(OPTIONAL_GROUPS).toEqual({ delivery: ['turnoverDate', 'deliveryDate', 'deliveryFormat', 'materialLink'], assumptions: ['assumptions'] });
	});
});

describe('suggestCode', () => {
	it('makes the code from the project name and the first free number', () => {
		expect(suggestCode('Big Buck Bunny', [])).toBe('BIG_BUCK_BUNNY-01');
		expect(suggestCode('Big Buck Bunny', ['BIG_BUCK_BUNNY-01', 'BIG_BUCK_BUNNY-02', 'OTHER'])).toBe('BIG_BUCK_BUNNY-03');
	});

	it('keeps it short, cut at a word', () => {
		expect(suggestCode('sg-comfyui Sandbox', [])).toBe('SG_COMFYUI-01');
		expect(suggestCode('Supercalifragilisticexpialidocious', [])).toBe('SUPERCALIFRAGILI-01');
	});

	it('drops accents and anything outside plain letters and digits', () => {
		expect(suggestCode('Élan Vital 2', [])).toBe('ELAN_VITAL_2-01');
		expect(suggestCode('日本', [])).toBe('BID-01');
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

describe('roundOf', () => {
	it('reads the round typed, and 1 for one it cannot read', () => {
		expect(roundOf(form({ round: ' 3 ' }))).toBe(3);
		expect(roundOf(form({ round: '0' }))).toBe(1);
		expect(roundOf(form({ round: 'x' }))).toBe(1);
	});
});
