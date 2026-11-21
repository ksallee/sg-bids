import { describe, expect, it } from 'vitest';
import { readDraft } from './draft-input';

const usd = (minor: number) => ({ minor, currency: 'USD' });

function good(): Record<string, unknown> {
	return {
		number: 'Q-1',
		date: '2026-11-20',
		currency: 'USD',
		rate: null,
		validUntil: '2027-01-31',
		assumptions: ['4K'],
		exclusions: [],
		milestones: [{ label: 'On award', percent: '30', due: 'week 1' }],
		lines: [
			{
				target: { kind: 'shot', id: 'sh010' },
				total: usd(1000),
				excluded: false,
				departments: [{ department: 'Comp', days: '4.5', cost: usd(800) }],
				compute: usd(200),
				notes: 'n',
				methodology: 'm',
				assumptions: 'a'
			},
			{ target: { kind: 'asset', id: 'hero' }, total: usd(0), excluded: true }
		],
		costs: [{ kind: 'overhead', label: 'Overhead', amount: usd(50), labour: false }],
		discount: { kind: 'percent', percent: '5' },
		tax: { kind: 'amount', amount: usd(10) },
		rebate: [{ jurisdiction: 'CA-QC', workPercent: '50', rate: '25', base: { kind: 'contract', percent: '65' } }]
	};
}

describe('readDraft', () => {
	it('reads a well formed draft, the rate always null', () => {
		const result = readDraft({ ...good(), rate: { from: 'USD', to: 'EUR', rate: '1', date: '2026-11-20' } });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.draft.rate).toBeNull();
		expect(result.draft.lines).toHaveLength(2);
		expect(result.draft.lines[0].departments).toEqual([{ department: 'Comp', days: '4.5', cost: usd(800) }]);
		expect(result.draft.rebate[0].base).toEqual({ kind: 'contract', percent: '65' });
	});

	it('reads a counted line with its unit price, and refuses a unit that is not an amount', () => {
		const input = good();
		const lines = input.lines as Record<string, unknown>[];
		lines[0] = { target: { kind: 'shot', id: 'bd-1' }, total: usd(18_000_000), unit: usd(150_000), excluded: false, fromRate: true };
		const result = readDraft(input);
		expect(result.ok && result.draft.lines[0]).toEqual({ target: { kind: 'shot', id: 'bd-1' }, total: usd(18_000_000), unit: usd(150_000), excluded: false, fromRate: true });
		lines[0] = { ...lines[0], unit: { minor: 1.5, currency: 'USD' } };
		expect(readDraft(input).ok).toBe(false);
	});

	it('drops keys it does not know, ids included: the server owns them', () => {
		const input = good();
		input.id = 'other-bid';
		input.vendorId = 'other-vendor';
		input.status = 'submitted';
		(input.lines as Record<string, unknown>[])[0].id = 'other-line';
		(input.lines as Record<string, unknown>[])[0].awarded = true;
		const result = readDraft(input);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const text = JSON.stringify(result.draft);
		for (const word of ['other-bid', 'other-vendor', 'submitted', 'other-line', 'awarded']) expect(text).not.toContain(word);
	});

	it('names where a draft is wrong', () => {
		const cases: [unknown, string][] = [
			[null, 'the bid'],
			[{ ...good(), currency: 'usd' }, 'currency'],
			[{ ...good(), lines: 'x' }, 'lines'],
			[{ ...good(), lines: [{ target: { kind: 'shot', id: 'a' }, total: usd(-1), excluded: false }] }, 'lines[0].total'],
			[{ ...good(), lines: [{ target: { kind: 'sequence', id: 'a' }, total: usd(1), excluded: false }] }, 'lines[0].target'],
			[{ ...good(), lines: [{ target: { kind: 'shot', id: 'a' }, total: { minor: 1.5, currency: 'USD' }, excluded: false }] }, 'lines[0].total'],
			[{ ...good(), lines: [{ target: { kind: 'shot', id: 'a' }, total: usd(1), excluded: 'no' }] }, 'lines[0].excluded'],
			[{ ...good(), costs: [{ kind: 'bribe', label: 'x', amount: usd(1), labour: false }] }, 'costs[0].kind'],
			[{ ...good(), discount: { kind: 'percent', percent: 'ten' } }, 'discount'],
			[{ ...good(), rebate: [{ jurisdiction: 'GB', workPercent: '50', rate: '39', base: { kind: 'magic' } }] }, 'rebate[0].base'],
			[{ ...good(), milestones: [{ label: 'x' }] }, 'milestones[0].percent'],
			[{ ...good(), validUntil: 5 }, 'validUntil'],
			[{ ...good(), notes: 'x'.repeat(10) }, ''],
			[{ ...good(), assumptions: ['x'.repeat(20_001)] }, 'assumptions[0]']
		];
		for (const [input, where] of cases) {
			const result = readDraft(input);
			if (where === '') {
				expect(result.ok).toBe(true);
				continue;
			}
			expect(result, where).toEqual({ ok: false, message: `The bid could not be read at ${where}.` });
		}
	});

	it('refuses a currency off the ISO list, and percents out of range', () => {
		const cases: [unknown, string][] = [
			[{ ...good(), currency: 'XYZ' }, 'currency'],
			[{ ...good(), currency: 'XAU' }, 'currency'],
			[{ ...good(), discount: { kind: 'percent', percent: '100.01' } }, 'discount'],
			[{ ...good(), tax: { kind: 'percent', percent: '101' } }, 'tax'],
			[{ ...good(), rebate: [{ jurisdiction: 'GB', workPercent: '50', rate: '120', base: { kind: 'all' } }] }, 'rebate[0].rate'],
			[{ ...good(), rebate: [{ jurisdiction: 'GB', workPercent: '150', rate: '20', base: { kind: 'all' } }] }, 'rebate[0].workPercent'],
			[{ ...good(), rebate: [{ jurisdiction: 'GB', workPercent: '50', rate: '20', base: { kind: 'contract', percent: '101' } }] }, 'rebate[0].base'],
			[
				{
					...good(),
					rebate: [
						{ jurisdiction: 'GB', workPercent: '60', rate: '20', base: { kind: 'all' } },
						{ jurisdiction: 'CA-QC', workPercent: '41', rate: '20', base: { kind: 'all' } }
					]
				},
				'rebate'
			]
		];
		for (const [input, where] of cases) expect(readDraft(input), where).toEqual({ ok: false, message: `The bid could not be read at ${where}.` });
		expect(readDraft({ ...good(), currency: 'JPY', discount: { kind: 'percent', percent: '100' }, tax: { kind: 'percent', percent: '100' } }).ok).toBe(true);
	});

	it('refuses more lines than any request holds', () => {
		const line = { target: { kind: 'shot', id: 'a' }, total: usd(1), excluded: false };
		expect(readDraft({ ...good(), lines: Array.from({ length: 10_001 }, () => line) }).ok).toBe(false);
	});

	it('takes a package figure and the lines it covers, and refuses a bad one', () => {
		const covered = { target: { kind: 'shot', id: 'a' }, total: usd(0), excluded: false, inPackage: true };
		const result = readDraft({ ...good(), lines: [covered], packages: [{ package: 'p1', total: usd(5000), notes: 'all in', extra: 1 }] });
		expect(result.ok && result.draft.packages).toEqual([{ package: 'p1', total: usd(5000), notes: 'all in' }]);
		expect(result.ok && result.draft.lines[0].inPackage).toBe(true);
		expect(readDraft({ ...good(), packages: [{ package: 'p1', total: { minor: -1, currency: 'USD' } }] }).ok).toBe(false);
		expect(readDraft({ ...good(), packages: [{ total: usd(1) }] }).ok).toBe(false);
		expect(readDraft({ ...good(), lines: [{ ...covered, inPackage: 'yes' }] }).ok).toBe(false);
		const declined = readDraft({ ...good(), declined: ['p2'] });
		expect(declined.ok && declined.draft.declined).toEqual(['p2']);
		expect(readDraft({ ...good(), declined: [3] }).ok).toBe(false);
	});
});
