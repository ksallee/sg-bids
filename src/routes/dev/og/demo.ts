/**
 * Demo data for the share image: a made up show, three vendors named A, B and C, prices in three
 * currencies with locked rates. Nothing here comes from a Flow PT site. Built with the pure
 * modules' fixture builders, so the grid on the card is the real grid on real shaped data.
 */
import type { Comparison, StoredScenario } from '$lib/compare-api';
import { compareBids } from '$lib/pure/compare';
import { asset, bid, line, onAsset, onShot, request, shot } from '$lib/pure/fixtures';
import { awardLowest, picksToList } from '$lib/pure/scenario';
import { money, rate } from '$lib/pure/money';
import type { RebateSplit, Target, VendorBid } from '$lib/pure/model';

const SHOTS = [
	['opn_0010', 'OPN'],
	['opn_0020', 'OPN'],
	['opn_0030', 'OPN'],
	['opn_0040', 'OPN'],
	['opn_0050', 'OPN'],
	['chs_0010', 'CHS'],
	['chs_0020', 'CHS'],
	['chs_0030', 'CHS'],
	['chs_0040', 'CHS'],
	['chs_0050', 'CHS'],
	['chs_0060', 'CHS']
] as const;

const req = request({
	id: 'demo',
	header: { project: 'Demo show', title: 'Opening and chase', code: 'DEMO_R1', round: 1, baseCurrency: 'USD', assumptions: [] },
	shots: SHOTS.map(([id, sequence]) => shot(id, { sequence, frames: 96 })),
	assets: [asset('hero_ship', { name: 'Hero ship' })],
	vendors: ['A', 'B', 'C'].map((x) => ({ id: `v${x}`, name: `Vendor ${x}`, email: '', ndaExecuted: true }))
});

/** Per vendor, a price per target in its own currency's minor units; `x` is excluded, absent is not bid. */
const PRICES: Record<string, Record<string, number | 'x'>> = {
	A: { opn_0010: 1_250_000, opn_0020: 980_000, opn_0030: 1_640_000, opn_0040: 720_000, opn_0050: 2_100_000, chs_0010: 1_880_000, chs_0020: 1_420_000, chs_0030: 'x', chs_0040: 960_000, chs_0050: 1_310_000, chs_0060: 1_150_000, hero_ship: 4_800_000 },
	B: { opn_0010: 870_000, opn_0020: 840_000, opn_0030: 1_180_000, opn_0040: 520_000, opn_0050: 1_600_000, chs_0010: 1_330_000, chs_0020: 1_010_000, chs_0030: 1_230_000, chs_0040: 870_000, chs_0060: 840_000, hero_ship: 3_480_000 },
	C: { opn_0010: 2_230_000, opn_0020: 1_810_000, opn_0030: 2_870_000, opn_0040: 1_410_000, opn_0050: 3_700_000, chs_0010: 3_330_000, chs_0020: 2_560_000, chs_0030: 3_080_000, chs_0040: 1_670_000, chs_0050: 2_410_000, chs_0060: 2_070_000, hero_ship: 8_820_000 }
};

const CURRENCY: Record<string, string> = { A: 'USD', B: 'GBP', C: 'CAD' };
const RATE: Record<string, string> = { B: '1.2700', C: '0.7200' };
const REBATE: Record<string, RebateSplit[]> = {
	A: [],
	B: [{ jurisdiction: 'GB', workPercent: '100', rate: '39', base: { kind: 'all' } }],
	C: [{ jurisdiction: 'CA-QC', workPercent: '100', rate: '25', base: { kind: 'contract', percent: '65' } }]
};

const target = (id: string): Target => (id === 'hero_ship' ? onAsset(id) : onShot(id));

function vendorBid(x: string): VendorBid {
	const currency = CURRENCY[x];
	return bid({
		id: `bid${x}`,
		requestId: 'demo',
		vendorId: `v${x}`,
		currency,
		date: '2026-11-18',
		rate: RATE[x] ? rate(currency, 'USD', RATE[x], '2026-11-19') : null,
		lines: Object.entries(PRICES[x]).map(([id, price], i) =>
			line(`${x}${i}`, target(id), money(price === 'x' ? 0 : price, currency), { excluded: price === 'x' })
		),
		costs: [{ kind: 'supervision', label: 'Supervision', amount: money(1_500_000, currency), labour: true }],
		rebate: REBATE[x]
	});
}

const bids = ['A', 'B', 'C'].map(vendorBid);

const lowest: StoredScenario = {
	id: 'demo-scenario',
	requestId: 'demo',
	name: 'Lowest per shot',
	chosen: true,
	costsLeftOut: [],
	updatedAt: '2026-11-19T10:00:00Z',
	picks: (() => {
		const grid = compareBids(req, bids);
		return picksToList(grid, awardLowest(grid, new Map()).picks);
	})()
};

export const DEMO: Comparison = {
	request: req,
	code: 'DEMO_R1',
	status: 'issued',
	versions: bids.map((b) => ({ bidId: b.id, vendorId: b.vendorId, version: 1, status: 'submitted', number: '1', date: b.date, currency: b.currency, submittedAt: '2026-11-18T09:00:00Z', withdrawnAt: null })),
	bids,
	rates: bids.filter((b) => b.rate).map((b) => ({ bidId: b.id, rate: b.rate!, setAt: '2026-11-19T09:00:00Z' })),
	scenarios: [lowest],
	awarded: false,
	publication: null
};
