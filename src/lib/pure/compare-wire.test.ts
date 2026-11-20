import { describe, expect, it } from 'vitest';
import { parseCompareRead, parseRate, parseScenario, parseScenarioRef } from './compare-wire';

const R = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';

describe('parseCompareRead', () => {
	it('takes a request id and an optional list of bids', () => {
		expect(parseCompareRead({ id: R })).toEqual({ ok: true, value: { requestId: R, bids: [] } });
		expect(parseCompareRead({ id: R, bids: [B] })).toEqual({ ok: true, value: { requestId: R, bids: [B] } });
	});
	it('refuses a bad id or a bad list', () => {
		expect(parseCompareRead({ id: 'x' }).ok).toBe(false);
		expect(parseCompareRead({ id: R, bids: ['x'] }).ok).toBe(false);
		expect(parseCompareRead({ id: R, bids: B }).ok).toBe(false);
	});
});

describe('parseRate', () => {
	it('takes a positive decimal and a day, trimmed', () => {
		expect(parseRate({ requestId: R, bidId: B, rate: { rate: ' 1.2712 ', date: '2026-11-20' } })).toEqual({
			ok: true,
			value: { requestId: R, bidId: B, rate: { rate: '1.2712', date: '2026-11-20' } }
		});
	});
	it('takes null to clear', () => {
		expect(parseRate({ requestId: R, bidId: B, rate: null })).toEqual({ ok: true, value: { requestId: R, bidId: B, rate: null } });
	});
	it('refuses zero, a negative, a comma, a float in a number, or a bad day', () => {
		for (const rate of ['0', '0.000', '-1', '1,27', '', 'abc']) {
			expect(parseRate({ requestId: R, bidId: B, rate: { rate, date: '2026-11-20' } }).ok, rate).toBe(false);
		}
		expect(parseRate({ requestId: R, bidId: B, rate: { rate: 1.27, date: '2026-11-20' } }).ok).toBe(false);
		expect(parseRate({ requestId: R, bidId: B, rate: { rate: '1.2', date: '2026-02-30' } }).ok).toBe(false);
		expect(parseRate({ requestId: R, rate: null }).ok).toBe(false);
	});
});

describe('parseScenario', () => {
	const pick = { target: { kind: 'shot', id: 'sh010' }, shares: [{ bidId: B, percent: '100' }] };

	it('takes a name, picks and the costs left out, and nothing else', () => {
		const parsed = parseScenario({ requestId: R, name: ' All lowest ', picks: [{ ...pick, extra: 1 }], costsLeftOut: [B], siteHost: 'evil' });
		expect(parsed).toEqual({ ok: true, value: { requestId: R, name: 'All lowest', picks: [pick], costsLeftOut: [B] } });
	});

	it('keeps the id of a scenario to update', () => {
		const parsed = parseScenario({ requestId: R, id: S, name: 'A', picks: [] });
		expect(parsed.ok && parsed.value.id).toBe(S);
	});

	it('refuses no name, a bad target, a bad share, a bad id', () => {
		expect(parseScenario({ requestId: R, name: '  ', picks: [] }).ok).toBe(false);
		expect(parseScenario({ requestId: R, name: 'A', picks: [{ ...pick, target: { kind: 'sequence', id: 'x' } }] }).ok).toBe(false);
		expect(parseScenario({ requestId: R, name: 'A', picks: [{ ...pick, shares: [{ bidId: B, percent: 100 }] }] }).ok).toBe(false);
		expect(parseScenario({ requestId: R, name: 'A', picks: [{ ...pick, shares: [] }] }).ok).toBe(false);
		expect(parseScenario({ requestId: R, id: 'x', name: 'A', picks: [] }).ok).toBe(false);
		expect(parseScenario({ requestId: R, name: 'A', picks: [], costsLeftOut: ['x'] }).ok).toBe(false);
	});
});

describe('parseScenarioRef', () => {
	it('takes a scenario, a name when asked, or null when allowed', () => {
		expect(parseScenarioRef({ requestId: R, scenarioId: S })).toEqual({ ok: true, value: { requestId: R, scenarioId: S, name: '' } });
		expect(parseScenarioRef({ requestId: R, scenarioId: S, name: ' B ' }, { name: true })).toEqual({ ok: true, value: { requestId: R, scenarioId: S, name: 'B' } });
		expect(parseScenarioRef({ requestId: R, scenarioId: null }, { nullable: true })).toEqual({ ok: true, value: { requestId: R, scenarioId: null, name: '' } });
	});
	it('refuses null unless allowed, and a missing name when asked', () => {
		expect(parseScenarioRef({ requestId: R, scenarioId: null }).ok).toBe(false);
		expect(parseScenarioRef({ requestId: R, scenarioId: S }, { name: true }).ok).toBe(false);
	});
});
