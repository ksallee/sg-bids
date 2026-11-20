import { describe, expect, it } from 'vitest';
import { codeMatches, deletedLine, deletionPlan, names, REFUSED_AWARD, type DeletionFacts } from './request-delete';

const facts = (extra: Partial<DeletionFacts> = {}): DeletionFacts => ({
	id: 'r1',
	code: 'BR-1',
	title: 'Rooftop',
	round: 2,
	status: 'issued',
	shots: 12,
	assets: 1,
	invitations: 2,
	bids: 3,
	vendors: ['Vendor A', 'Vendor B'],
	scenarios: 2,
	rates: 1,
	award: null,
	...extra
});

describe('deletionPlan', () => {
	it('asks once for a draft, naming it and what goes', () => {
		expect(deletionPlan(facts({ status: 'draft', invitations: 0, bids: 0, vendors: [], scenarios: 0, rates: 0 }))).toEqual({
			kind: 'draft',
			title: 'Delete the draft BR-1?',
			lines: ['The draft, with 12 shots and 1 asset.'],
			typed: false,
			confirm: 'Delete draft'
		});
	});

	it('says a draft’s invited vendors lose their links', () => {
		const plan = deletionPlan(facts({ status: 'draft', invitations: 1, bids: 0, vendors: [] }));
		expect(plan.kind === 'draft' && plan.lines).toEqual(['The draft, with 12 shots and 1 asset.', '1 invitation. Their links stop working.']);
	});

	it('names everything an issued request takes with it, and asks for the code', () => {
		const plan = deletionPlan(facts());
		expect(plan).toEqual({
			kind: 'issued',
			title: 'Delete BR-1, round 2?',
			lines: [
				'The request, round 2, with 12 shots and 1 asset.',
				'2 invitations. Their links stop working. The vendors see that the production withdrew the request.',
				'3 submitted bids, from Vendor A and Vendor B.',
				'Any draft a vendor started.',
				'2 award scenarios.',
				'1 exchange rate.'
			],
			typed: true,
			confirm: 'Delete request'
		});
	});

	it('leaves out what a request does not have', () => {
		const plan = deletionPlan(facts({ status: 'closed', invitations: 0, bids: 0, vendors: [], scenarios: 0, rates: 0 }));
		expect(plan.kind === 'issued' && plan.lines).toEqual(['The request, round 2, with 12 shots and 1 asset.']);
	});

	it('refuses while an award is in Flow PT, published, partial or part undone', () => {
		for (const award of ['published', 'partial', 'undo_partial'] as const) {
			expect(deletionPlan(facts({ award }))).toEqual({ kind: 'refused', reason: REFUSED_AWARD });
		}
		expect(deletionPlan(facts({ status: 'awarded' })).kind).toBe('refused');
	});
});

describe('codeMatches', () => {
	it('takes the code exactly, spaces around it aside', () => {
		expect(codeMatches('BR-1', 'BR-1')).toBe(true);
		expect(codeMatches('  BR-1 ', 'BR-1')).toBe(true);
		expect(codeMatches('br-1', 'BR-1')).toBe(false);
		expect(codeMatches('BR-', 'BR-1')).toBe(false);
		expect(codeMatches('', '')).toBe(false);
	});
});

describe('names and deletedLine', () => {
	it('joins names as a sentence does', () => {
		expect(names([])).toBe('');
		expect(names(['A'])).toBe('A');
		expect(names(['A', 'B'])).toBe('A and B');
		expect(names(['A', 'B', 'C'])).toBe('A, B and C');
	});

	it('says what went', () => {
		const base = { code: 'BR-1', round: 1, items: 3, invitations: 0, bids: 0, drafts: 0, lines: 0, scenarios: 0, rates: 0 };
		expect(deletedLine({ ...base, status: 'draft' })).toBe('Deleted the draft BR-1.');
		expect(deletedLine({ ...base, status: 'issued', invitations: 2, bids: 1, scenarios: 1 })).toBe('Deleted BR-1, round 1, with 2 invitations, 1 submitted bid and 1 scenario.');
	});
});
