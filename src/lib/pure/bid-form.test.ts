import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { emptyForm, formFromBid, formToDraft, formTotals, itemNames, lineDetailTotal, setBidding, switchMode, typedFor, type BidForm } from './bid-form';
import { asset, bid, line, onAsset, onShot, request, shot } from './fixtures';
import { applyRates, typePrice } from './rate-card';
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
		expect(counts).toEqual({ priced: 2, excluded: 0, open: 2, packaged: 0, declined: 0 });
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
		expect(counts).toEqual({ priced: 0, excluded: 2, open: 2, packaged: 0, declined: 0 });
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

describe('a package priced as one figure', () => {
	const packed = {
		header: req.header,
		packages: [
			{ id: 'p1', name: 'Creature' },
			{ id: 'p2', name: 'Comp' }
		],
		shots: [
			{ id: 'a', package: 'p1' },
			{ id: 'b', package: 'p1' },
			{ id: 'c', package: 'p1', omitted: true },
			{ id: 'd', package: 'p2' }
		],
		assets: []
	};
	const names = itemNames({ shots: packed.shots.map((s) => ({ id: s.id, code: s.id.toUpperCase() })), assets: [], packages: packed.packages });

	it('sends no line for a row omitted in a later round when the bid is priced row by row, and does not count it open', () => {
		const form = emptyForm(packed, TODAY);
		form.lines.find((l) => l.key === 'shot:a')!.price = '100';
		form.lines.find((l) => l.key === 'shot:b')!.price = '200';
		form.lines.find((l) => l.key === 'shot:c')!.price = '300';
		form.lines.find((l) => l.key === 'shot:d')!.price = '400';
		const { draft, counts } = formToDraft(form, '.', names);
		expect(draft.lines.map((l) => l.target.id)).toEqual(['a', 'b', 'd']);
		expect(counts).toEqual({ priced: 3, excluded: 0, open: 0, packaged: 0, declined: 0 });
		const blank = emptyForm(packed, TODAY);
		expect(formToDraft(blank, '.', names).counts.open).toBe(3);
	});

	it('starts every package row by row', () => {
		expect(emptyForm(packed, TODAY).packages).toEqual([
			{ id: 'p1', name: 'Creature', bidding: true, mode: 'rows', price: '', notes: '' },
			{ id: 'p2', name: 'Comp', bidding: true, mode: 'rows', price: '', notes: '' }
		]);
	});

	it('sends the figure and a line in the package price for each row not omitted', () => {
		const form = switchMode(emptyForm(packed, TODAY), 'p1', 'package');
		form.packages[0].price = '5,000.00';
		form.packages[0].notes = ' all in ';
		form.lines.find((l) => l.key === 'shot:d')!.price = '100';
		const { draft, counts, problems } = formToDraft(form, '.', names);
		expect(draft.packages).toEqual([{ package: 'p1', total: money(500_000, 'USD'), notes: 'all in' }]);
		expect(draft.lines).toEqual([
			{ target: onShot('a'), total: money(0, 'USD'), excluded: false, inPackage: true },
			{ target: onShot('b'), total: money(0, 'USD'), excluded: false, inPackage: true },
			{ target: onShot('d'), total: money(10_000, 'USD'), excluded: false }
		]);
		expect(counts).toEqual({ priced: 1, excluded: 0, open: 0, packaged: 2, declined: 0 });
		expect(problems).toEqual([]);
		expect(formTotals(draft).totals.grand.bid).toEqual(money(510_000, 'USD'));
	});

	it('leaves a package with a blank figure not bid, and names a figure it cannot read', () => {
		const form = switchMode(emptyForm(packed, TODAY), 'p1', 'package');
		expect(formToDraft(form, '.', names).counts).toEqual({ priced: 0, excluded: 0, open: 3, packaged: 0, declined: 0 });
		form.packages[0].price = 'lots';
		const { problems } = formToDraft(form, '.', names);
		expect(problems[0]).toMatchObject({ key: 'package:p1:price', label: 'Price for Creature', control: 'vf-package:p1:price' });
	});

	it('counts a figure alone as a price for the submit', () => {
		const form = switchMode(emptyForm(packed, TODAY), 'p1', 'package');
		form.packages[0].price = '10';
		expect(formToDraft(form, '.', names).problems.some((p) => p.key === 'priced')).toBe(false);
	});

	it('reads a saved figure back as the package priced as one figure, its rows blank', () => {
		const form = formFromBid(
			{
				number: '1',
				date: TODAY,
				currency: 'USD',
				assumptions: [],
				exclusions: [],
				milestones: [],
				costs: [],
				discount: null,
				tax: null,
				rebate: [],
				lines: [line('l1', onShot('a'), money(0, 'USD'), { inPackage: true }), line('l2', onShot('b'), money(0, 'USD'), { inPackage: true })],
				packages: [{ package: 'p1', total: money(250_000, 'USD') }]
			},
			packed,
			'.'
		);
		expect(form.packages[0]).toMatchObject({ mode: 'package', price: '2500' });
		expect(form.lines.find((l) => l.key === 'shot:a')).toMatchObject({ price: '', excluded: false });
		expect(formToDraft(form, '.').draft.packages).toEqual([{ package: 'p1', total: money(250_000, 'USD') }]);
	});

	it('says what a switch would clear, and clears it only when switched', () => {
		// Prices the vendor typed (`rate-card.typePrice` marks them so).
		const form = typePrice(typePrice(emptyForm(packed, TODAY), 'shot:a', '10'), 'shot:d', '7');
		form.lines.find((l) => l.key === 'shot:b')!.excluded = true;
		expect(typedFor(form, 'p1', 'package')).toEqual({ rows: 2, figure: false });
		const switched = switchMode(form, 'p1', 'package');
		expect(switched.lines.filter((l) => l.package === 'p1').every((l) => l.price === '' && !l.excluded)).toBe(true);
		expect(switched.lines.find((l) => l.key === 'shot:d')!.price).toBe('7');
		switched.packages[0].price = '99';
		expect(typedFor(switched, 'p1', 'rows')).toEqual({ rows: 0, figure: true });
		expect(switchMode(switched, 'p1', 'rows').packages[0]).toMatchObject({ mode: 'rows', price: '' });
	});

	it('sends no line for a package the vendor is not bidding on, and does not count its rows as open', () => {
		const form = setBidding(emptyForm(packed, TODAY), 'p1', false);
		form.lines.find((l) => l.key === 'shot:d')!.price = '100';
		const { draft, counts, problems } = formToDraft(form, '.', names);
		expect(draft.declined).toEqual(['p1']);
		expect(draft.lines).toEqual([{ target: onShot('d'), total: money(10_000, 'USD'), excluded: false }]);
		expect(counts).toEqual({ priced: 1, excluded: 0, open: 0, packaged: 0, declined: 2 });
		expect(problems).toEqual([]);
	});

	it('wants one package bid on at least', () => {
		const form = setBidding(setBidding(emptyForm(packed, TODAY), 'p1', false), 'p2', false);
		const { problems, blockers } = formToDraft(form, '.', names);
		expect(problems.map((p) => p.key)).toEqual(['bidding']);
		expect(blockers).toEqual(['Answer one bid at least.']);
	});

	it('says what not bidding would clear, clears it, and reads a declined package back', () => {
		const form = emptyForm(packed, TODAY);
		form.lines.find((l) => l.key === 'shot:a')!.price = '10';
		expect(typedFor(form, 'p1', 'declined')).toEqual({ rows: 1, figure: false });
		const off = setBidding(form, 'p1', false);
		expect(off.lines.find((l) => l.key === 'shot:a')!.price).toBe('');
		expect(setBidding(off, 'p1', true).packages[0]).toMatchObject({ bidding: true, mode: 'rows' });
		const back = formFromBid({ ...formToDraft(off, '.').draft }, packed, '.');
		expect(back.packages.map((p) => p.bidding)).toEqual([false, true]);
	});
});


describe('a counted row in the vendor form', () => {
	const counted = request({ shots: [shot('simple', { source: 'breakdown', count: 120, difficulty: 'Simple' }), shot('sh010')], assets: [asset('props', { source: 'breakdown', count: 12 })] });

	it('carries its count; the price typed is per unit, the line total is unit times count, the unit kept', () => {
		const form = emptyForm(counted, TODAY);
		expect(form.lines.map((l) => l.count)).toEqual([120, undefined, 12]);
		form.lines[0].price = '1,500';
		form.lines[1].price = '900';
		form.lines[2].price = '250.25';
		const { draft, errors } = formToDraft(form, '.');
		expect(errors).toEqual({});
		expect(draft.lines).toEqual([
			{ target: onShot('simple'), total: money(18_000_000, 'USD'), unit: money(150_000, 'USD'), excluded: false },
			{ target: onShot('sh010'), total: money(90_000, 'USD'), excluded: false },
			{ target: onAsset('props'), total: money(300_300, 'USD'), unit: money(25_025, 'USD'), excluded: false }
		]);
		expect(formTotals(draft).totals.lines.bid).toEqual(money(18_390_300, 'USD'));
	});

	it('takes its unit price from the rate card', () => {
		const form = { ...emptyForm(counted, TODAY) };
		form.rates = { tiers: [{ difficulty: 'Simple', price: '1500' }], fallback: '' };
		const { draft } = formToDraft(applyRates(form), '.');
		expect(draft.lines[0]).toEqual({ target: onShot('simple'), total: money(18_000_000, 'USD'), unit: money(150_000, 'USD'), excluded: false, fromRate: true });
	});

	it('reads a saved counted line back as its unit price', () => {
		const saved = bid({ currency: 'USD', lines: [line('l1', onShot('simple'), money(18_000_000, 'USD'), { unit: money(150_000, 'USD') })] });
		expect(formFromBid(saved, counted, '.').lines[0].price).toBe('1500');
	});

	it('names a unit price whose total would not hold exactly', () => {
		const form = emptyForm(counted, TODAY);
		form.lines[0].price = '1000000000000';
		const { errors, draft } = formToDraft(form, '.');
		expect(errors['line:shot:simple:price']).toMatch(/Too large/);
		expect(draft.lines).toEqual([]);
	});

	it('lets an excluded counted row go with no price as a zero, and with one as unit times count', () => {
		const form = emptyForm(counted, TODAY);
		form.lines[0].excluded = true;
		form.lines[2].excluded = true;
		form.lines[2].price = '10';
		expect(formToDraft(form, '.').draft.lines).toEqual([
			{ target: onShot('simple'), total: money(0, 'USD'), excluded: true },
			{ target: onAsset('props'), total: money(12_000, 'USD'), unit: money(1000, 'USD'), excluded: true }
		]);
	});
});

describe('count 1 is the form as before (properties)', () => {
	const priceArb = fc.oneof(
		fc.constant(''),
		fc.integer({ min: 0, max: 9_999_999 }).map(String),
		fc.tuple(fc.integer({ min: 0, max: 99_999 }), fc.integer({ min: 0, max: 99 })).map(([u, c]) => `${u}.${String(c).padStart(2, '0')}`)
	);
	const rowsArb = fc.array(fc.record({ price: priceArb, excluded: fc.boolean(), count: fc.integer({ min: 1, max: 5000 }) }), { minLength: 1, maxLength: 10 });
	const build = (rows: { price: string; excluded: boolean; count: number }[], counts: 'absent' | 'one' | 'own') => {
		const r = request({ shots: rows.map((row, i) => shot(`s${i}`, { source: 'breakdown', ...(counts === 'one' ? { count: 1 } : counts === 'own' ? { count: row.count } : {}) })) });
		const form = emptyForm(r, TODAY);
		rows.forEach((row, i) => {
			form.lines[i].price = row.price;
			form.lines[i].excluded = row.excluded;
		});
		return formToDraft(form, '.');
	};

	it('a count of 1 makes the same draft as a row with no count (differential)', () => {
		fc.assert(
			fc.property(rowsArb, (rows) => {
				expect(build(rows, 'one')).toEqual(build(rows, 'absent'));
				expect(build(rows, 'absent').draft.lines.every((l) => l.unit === undefined)).toBe(true);
			})
		);
	});

	it('a count scales each line: the total is the count-1 total times the count, the unit is that total', () => {
		fc.assert(
			fc.property(rowsArb, (rows) => {
				const one = build(rows, 'absent').draft.lines;
				const own = build(rows, 'own').draft.lines;
				expect(own.map((l) => l.target)).toEqual(one.map((l) => l.target));
				own.forEach((l, i) => {
					const row = rows[Number(l.target.id.slice(1))];
					expect(BigInt(l.total.minor)).toBe(BigInt(one[i].total.minor) * BigInt(row.count));
					if (row.count > 1 && row.price !== '') expect(l.unit).toEqual(one[i].total);
					else expect(l.unit).toBeUndefined();
				});
			})
		);
	});

	it('the line totals sum to the subtotal of lines', () => {
		fc.assert(
			fc.property(rowsArb, (rows) => {
				const { draft } = build(rows, 'own');
				const live = draft.lines.filter((l) => !l.excluded).reduce((n, l) => n + BigInt(l.total.minor), 0n);
				expect(BigInt(formTotals(draft).totals.lines.bid.minor)).toBe(live);
			})
		);
	});
});
