import { describe, expect, it } from 'vitest';
import { emptyForm, formFromBid, formToDraft, formTotals, itemNames, lineDetailTotal, type BidForm } from './bid-form';
import { asset, bid, line, onAsset, onShot, request, shot } from './fixtures';
import { money } from './money';

const req = request({ shots: [shot('sh010'), shot('sh020'), shot('sh030')], assets: [asset('hero', { name: 'Hero' })] });
const TODAY = '2026-11-20';

function filled(edit: (form: BidForm) => void): BidForm {
	const form = emptyForm(req, TODAY);
	edit(form);
	return form;
}

const lineOf = (form: BidForm, key: string) => form.lines.find((l) => l.key === key)!;

describe('emptyForm', () => {
	it('has one line per shot then asset, in the request’s order, in the base currency', () => {
		const form = emptyForm(req, TODAY);
		expect(form.lines.map((l) => l.key)).toEqual(['shot:sh010', 'shot:sh020', 'shot:sh030', 'asset:hero']);
		expect(form.currency).toBe('USD');
		expect(form.date).toBe(TODAY);
		expect(form.lines.every((l) => l.price === '' && !l.excluded)).toBe(true);
	});

	it('offers the four usual non-shot costs, none counted as labour until the vendor says so', () => {
		const form = emptyForm(req, TODAY);
		expect(form.costs.map((c) => [c.kind, c.label, c.amount, c.labour])).toEqual([
			['overhead', 'Overhead', '', false],
			['supervision', 'Supervision', '', false],
			['on_set', 'On set', '', false],
			['contingency', 'Contingency', '', false]
		]);
	});
});

describe('formToDraft', () => {
	it('turns typed prices into lines in minor units, leaving unpriced items out', () => {
		const form = filled((f) => {
			lineOf(f, 'shot:sh010').price = '12,500.50';
			lineOf(f, 'asset:hero').price = '0';
		});
		const { draft, errors, counts } = formToDraft(form, '.');
		expect(errors).toEqual({});
		expect(draft.lines).toEqual([
			{ target: onShot('sh010'), total: money(1_250_050, 'USD'), excluded: false },
			{ target: onAsset('hero'), total: money(0, 'USD'), excluded: false }
		]);
		expect(counts).toEqual({ priced: 2, excluded: 0, open: 2 });
	});

	it('keeps an excluded item apart from a zero price, its typed price kept', () => {
		const form = filled((f) => {
			lineOf(f, 'shot:sh020').excluded = true;
			lineOf(f, 'shot:sh030').excluded = true;
			lineOf(f, 'shot:sh030').price = '900';
		});
		const { draft, counts } = formToDraft(form, '.');
		expect(draft.lines).toEqual([
			{ target: onShot('sh020'), total: money(0, 'USD'), excluded: true },
			{ target: onShot('sh030'), total: money(90_000, 'USD'), excluded: true }
		]);
		expect(counts).toEqual({ priced: 0, excluded: 2, open: 2 });
	});

	it('reads prices with a comma for a decimal in a comma locale', () => {
		const form = filled((f) => (lineOf(f, 'shot:sh010').price = '1 250,5'));
		expect(formToDraft(form, ',').draft.lines[0].total).toEqual(money(125_050, 'USD'));
	});

	it('writes department detail, compute and the texts of a line, trimmed', () => {
		const form = filled((f) => {
			const l = lineOf(f, 'shot:sh010');
			l.price = '1000';
			l.departments = [
				{ department: ' Comp ', days: '4,5', cost: '800' },
				{ department: '', days: '', cost: '' }
			];
			l.compute = '200';
			l.methodology = ' 2D only ';
			l.assumptions = 'clean plate';
			l.notes = '';
		});
		const { draft, errors } = formToDraft(form, '.');
		expect(errors).toEqual({});
		expect(draft.lines[0]).toEqual({
			target: onShot('sh010'),
			total: money(100_000, 'USD'),
			excluded: false,
			departments: [{ department: 'Comp', days: '4.5', cost: money(80_000, 'USD') }],
			compute: money(20_000, 'USD'),
			methodology: '2D only',
			assumptions: 'clean plate'
		});
	});

	it('names each field it cannot read, and leaves it out of the draft', () => {
		const form = filled((f) => {
			lineOf(f, 'shot:sh010').price = 'abc';
			lineOf(f, 'shot:sh020').price = '10';
			lineOf(f, 'shot:sh020').departments = [{ department: '', days: '2', cost: '' }];
			lineOf(f, 'shot:sh020').compute = '1.234';
			f.costs[0].amount = '-5';
			f.discount = { kind: 'percent', value: '120' };
			f.tax = { kind: 'amount', value: 'x' };
			f.date = '2026-02-31';
		});
		const { draft, errors } = formToDraft(form, '.');
		expect(errors).toEqual({
			'line:shot:sh010:price': 'Not a number.',
			'line:shot:sh020:dept:0:department': 'Name the department.',
			'line:shot:sh020:compute': 'USD takes 2 decimals.',
			'cost:0:amount': 'Use an amount of zero or more.',
			discount: 'A discount is 100% at most.',
			tax: 'Not a number.',
			date: 'Use a real day.'
		});
		expect(draft.lines).toEqual([{ target: onShot('sh020'), total: money(1000, 'USD'), excluded: false }]);
		expect(draft.costs).toEqual([]);
		expect(draft.discount).toBeNull();
		expect(draft.tax).toBeNull();
	});

	it('writes costs that have an amount, an other cost with its label', () => {
		const form = filled((f) => {
			f.costs[1].amount = '5000';
			f.costs[1].labour = true;
			f.costs.push({ kind: 'other', label: 'Lidar scan', amount: '1200', labour: false });
			f.costs.push({ kind: 'other', label: '', amount: '10', labour: false });
		});
		const { draft, errors } = formToDraft(form, '.');
		expect(draft.costs).toEqual([
			{ kind: 'supervision', label: 'Supervision', amount: money(500_000, 'USD'), labour: true },
			{ kind: 'other', label: 'Lidar scan', amount: money(120_000, 'USD'), labour: false }
		]);
		expect(errors).toEqual({ 'cost:5:label': 'Name the cost.' });
	});

	it('writes a discount and a tax as an amount or a percent', () => {
		const form = filled((f) => {
			f.discount = { kind: 'amount', value: '1,000' };
			f.tax = { kind: 'percent', value: '8,25 %' };
		});
		const { draft } = formToDraft(form, '.');
		expect(draft.discount).toEqual({ kind: 'amount', amount: money(100_000, 'USD') });
		expect(draft.tax).toEqual({ kind: 'percent', percent: '8.25' });
	});

	it('writes rebate splits with their base, and refuses splits over 100% of the work', () => {
		const form = filled((f) => {
			f.rebate = [
				{ jurisdiction: 'CA-QC', workPercent: '60', rate: '25', base: 'contract', contractPercent: '65' },
				{ jurisdiction: 'GB', workPercent: '40', rate: '39', base: 'all', contractPercent: '' }
			];
		});
		const { draft, errors } = formToDraft(form, '.');
		expect(errors).toEqual({});
		expect(draft.rebate).toEqual([
			{ jurisdiction: 'CA-QC', workPercent: '60', rate: '25', base: { kind: 'contract', percent: '65' } },
			{ jurisdiction: 'GB', workPercent: '40', rate: '39', base: { kind: 'all' } }
		]);

		form.rebate[1].workPercent = '50';
		const over = formToDraft(form, '.');
		expect(over.errors).toEqual({ splits: 'The splits cover 110% of the work. 100% at most.' });
		expect(over.draft.rebate).toEqual([]);
	});

	it('names a split with no place or a bad rate', () => {
		const form = filled((f) => {
			f.rebate = [{ jurisdiction: '', workPercent: '100', rate: 'abc', base: 'labour', contractPercent: '' }];
		});
		expect(formToDraft(form, '.').errors).toEqual({ 'split:0:jurisdiction': 'Pick where the work is done.', 'split:0:rate': 'Not a percent.' });
	});

	it('writes milestones and global texts one per line, and warns when milestones do not make 100%', () => {
		const form = filled((f) => {
			f.milestones = [
				{ label: 'On award', percent: '30', due: '' },
				{ label: 'On delivery', percent: '60', due: 'final delivery' }
			];
			f.assumptions = 'Plates by week 2\n\n  4K delivery ';
			f.exclusions = 'Stereo';
			f.validUntil = '2027-01-31';
			f.number = ' Q-7 ';
		});
		const { draft, warnings } = formToDraft(form, '.');
		expect(draft.milestones).toEqual([
			{ label: 'On award', percent: '30' },
			{ label: 'On delivery', percent: '60', due: 'final delivery' }
		]);
		expect(draft.assumptions).toEqual(['Plates by week 2', '4K delivery']);
		expect(draft.exclusions).toEqual(['Stereo']);
		expect(draft.validUntil).toBe('2027-01-31');
		expect(draft.number).toBe('Q-7');
		expect(warnings).toContain('The payment milestones add up to 90%, not 100%.');
	});

	it('never carries an exchange rate: production locks that', () => {
		const form = filled((f) => (f.currency = 'EUR'));
		const { draft } = formToDraft(form, '.');
		expect(draft.currency).toBe('EUR');
		expect(draft.rate).toBeNull();
	});

	it('lists what blocks a submit', () => {
		expect(formToDraft(emptyForm(req, TODAY), '.').blockers).toEqual(['Price at least one shot or asset.']);
		const bad = filled((f) => {
			lineOf(f, 'shot:sh010').price = 'x';
			lineOf(f, 'shot:sh020').price = 'y';
			lineOf(f, 'shot:sh030').price = '1';
		});
		expect(formToDraft(bad, '.', itemNames(req)).blockers).toEqual(['Price for SH010: Not a number.', 'Price for SH020: Not a number.']);
		const one = filled((f) => (lineOf(f, 'shot:sh010').price = '1'));
		expect(formToDraft(one, '.').blockers).toEqual([]);
	});

	it('names each problem by its field, in the order of the form, with the control that fixes it', () => {
		const bad = filled((f) => {
			f.date = '2026-02-30';
			lineOf(f, 'shot:sh020').price = '12,345.678';
			lineOf(f, 'asset:hero').price = '10';
			lineOf(f, 'asset:hero').departments = [{ department: '', days: 'two', cost: '5' }];
			f.costs[1].amount = 'lots';
			f.discount = { kind: 'percent', value: '120' };
			f.rebate = [{ jurisdiction: '', workPercent: '50', rate: 'x', base: 'all', contractPercent: '' }];
			f.milestones = [{ label: '', percent: '50', due: '' }];
		});
		const { problems } = formToDraft(bad, '.', itemNames(req));
		expect(problems.map((p) => [p.label, p.message, p.control, p.line ?? null])).toEqual([
			['Bid date', 'Use a real day.', 'vf-date', null],
			['Price for SH020', 'USD takes 2 decimals.', 'vf-line:shot:sh020:price', 'shot:sh020'],
			['Hero, department 1, days', 'Not a number of days.', 'vf-line:asset:hero:dept:0:days', 'asset:hero'],
			['Hero, department 1', 'Name the department.', 'vf-line:asset:hero:dept:0:department', 'asset:hero'],
			['Supervision', 'Not a number.', 'vf-cost:1:amount', null],
			['Discount', 'A discount is 100% at most.', 'vf-discount', null],
			['Rebate split 1, where', 'Pick where the work is done.', 'vf-split:0:jurisdiction', null],
			['Rebate split 1, rate', 'Not a percent.', 'vf-split:0:rate', null],
			['Milestone 1, name', 'Name the milestone.', 'vf-milestone:0:label', null]
		]);
		const empty = formToDraft(emptyForm(req, TODAY), '.', itemNames(req));
		expect(empty.problems).toEqual([{ key: 'priced', label: 'Shots and assets', message: 'Price at least one shot or asset.', control: 'vf-line:shot:sh010:price', line: 'shot:sh010' }]);
	});

	it('blocks a submit whose total is not above zero, or whose discount is more than the subtotal', () => {
		const over = filled((f) => {
			lineOf(f, 'shot:sh010').price = '100';
			f.discount = { kind: 'amount', value: '150' };
		});
		expect(formToDraft(over, '.').blockers).toEqual(['The discount is more than the subtotal.', 'The total must be above zero.']);
		const all = filled((f) => {
			lineOf(f, 'shot:sh010').price = '100';
			f.discount = { kind: 'percent', value: '100' };
		});
		expect(formToDraft(all, '.').blockers).toEqual(['The total must be above zero.']);
		const zero = filled((f) => (lineOf(f, 'shot:sh010').price = '0'));
		expect(formToDraft(zero, '.').blockers).toEqual(['The total must be above zero.']);
	});

	it('names a tax over 100%', () => {
		const form = filled((f) => {
			lineOf(f, 'shot:sh010').price = '100';
			f.tax = { kind: 'percent', value: '120' };
		});
		const result = formToDraft(form, '.');
		expect(result.errors.tax).toBe('A tax is 100% at most.');
		expect(result.draft.tax).toBeNull();
	});

	it('warns about items with no price', () => {
		const one = filled((f) => (lineOf(f, 'shot:sh010').price = '1'));
		expect(formToDraft(one, '.').warnings).toContain('3 items have no price. They will show as not bid.');
	});
});

describe('formFromBid', () => {
	it('writes a saved bid back into the form, every item present', () => {
		const saved = bid({
			currency: 'EUR',
			number: 'Q-7',
			validUntil: '2027-01-31',
			assumptions: ['a', 'b'],
			milestones: [{ label: 'On award', percent: '30' }],
			lines: [
				line('l1', onShot('sh020'), money(125_050, 'EUR'), {
					departments: [{ department: 'Comp', days: '4.5', cost: money(100_000, 'EUR') }],
					compute: money(2_000, 'EUR'),
					notes: 'n'
				}),
				line('l2', onAsset('hero'), money(0, 'EUR'), { excluded: true })
			],
			costs: [
				{ kind: 'supervision', label: 'Supervision', amount: money(500_000, 'EUR'), labour: true },
				{ kind: 'other', label: 'Lidar', amount: money(1_000, 'EUR'), labour: false }
			],
			discount: { kind: 'amount', amount: money(10_000, 'EUR') },
			tax: { kind: 'percent', percent: '20' },
			rebate: [{ jurisdiction: 'FR', workPercent: '100', rate: '30', base: { kind: 'all' } }]
		});
		const form = formFromBid(saved, req, ',');
		expect(form.currency).toBe('EUR');
		expect(form.number).toBe('Q-7');
		expect(lineOf(form, 'shot:sh010').price).toBe('');
		expect(lineOf(form, 'shot:sh020')).toMatchObject({
			price: '1250,50',
			compute: '20',
			notes: 'n',
			departments: [{ department: 'Comp', days: '4,5', cost: '1000' }]
		});
		expect(lineOf(form, 'asset:hero')).toMatchObject({ price: '', excluded: true });
		expect(form.costs.map((c) => [c.kind, c.amount, c.labour])).toEqual([
			['overhead', '', false],
			['supervision', '5000', true],
			['on_set', '', false],
			['contingency', '', false],
			['other', '10', false]
		]);
		expect(form.discount).toEqual({ kind: 'amount', value: '100' });
		expect(form.tax).toEqual({ kind: 'percent', value: '20' });
		expect(form.rebate).toEqual([{ jurisdiction: 'FR', workPercent: '100', rate: '30', base: 'all', contractPercent: '' }]);
		expect(form.assumptions).toBe('a\nb');
		expect(form.milestones).toEqual([{ label: 'On award', percent: '30', due: '' }]);
	});

	it('round-trips through formToDraft', () => {
		const form = filled((f) => {
			f.currency = 'EUR';
			lineOf(f, 'shot:sh010').price = '1250.5';
			lineOf(f, 'shot:sh020').excluded = true;
			f.costs[2].amount = '300';
			f.tax = { kind: 'percent', value: '7.5' };
		});
		const { draft } = formToDraft(form, '.');
		const back = formToDraft(formFromBid({ ...draft, lines: draft.lines.map((l, i) => ({ ...l, id: `l${i}` })) }, req, '.'), '.');
		expect(back.draft).toEqual(draft);
	});
});

describe('formTotals', () => {
	it('sums the bid in its own currency, and estimates the rebate', () => {
		const form = filled((f) => {
			f.currency = 'GBP';
			lineOf(f, 'shot:sh010').price = '1000';
			lineOf(f, 'shot:sh020').price = '500';
			lineOf(f, 'shot:sh030').excluded = true;
			lineOf(f, 'shot:sh030').price = '999';
			f.costs[0].amount = '500';
			f.discount = { kind: 'percent', value: '10' };
			f.tax = { kind: 'percent', value: '20' };
			f.rebate = [{ jurisdiction: 'GB', workPercent: '100', rate: '39', base: 'all', contractPercent: '' }];
		});
		const { totals, rebate } = formTotals(formToDraft(form, '.').draft);
		expect(totals.subtotal.bid).toEqual(money(200_000, 'GBP'));
		expect(totals.discount.bid).toEqual(money(20_000, 'GBP'));
		expect(totals.tax.bid).toEqual(money(36_000, 'GBP'));
		expect(totals.grand.bid).toEqual(money(216_000, 'GBP'));
		expect(rebate?.rebate?.bid).toEqual(money(70_200, 'GBP'));
	});

	it('gives no rebate without splits', () => {
		expect(formTotals(formToDraft(emptyForm(req, TODAY), '.').draft).rebate).toBeNull();
	});
});

describe('lineDetailTotal', () => {
	it('adds the department costs and compute of a line, null when it has none', () => {
		const form = filled((f) => {
			const l = lineOf(f, 'shot:sh010');
			l.departments = [
				{ department: 'Comp', days: '', cost: '800' },
				{ department: 'Roto', days: '', cost: 'x' }
			];
			l.compute = '200,5';
		});
		expect(lineDetailTotal(lineOf(form, 'shot:sh010'), 'USD', ',')).toEqual(money(100_050, 'USD'));
		expect(lineDetailTotal(lineOf(form, 'shot:sh020'), 'USD', '.')).toBeNull();
	});
});
