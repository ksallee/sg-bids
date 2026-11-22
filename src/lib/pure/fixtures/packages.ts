/**
 * A request with packages and three bids on it, for the comparison, scenario and award tests.
 *
 * Creature (`p1`): shots a (10 frames), b (30 frames) and d, omitted. Comp (`p2`): shot c and asset x.
 */

import { asset, bid, line, onAsset, onShot, request, shot } from '../fixtures';
import { money, rate } from '../money';

const usd = (minor: number) => money(minor, 'USD');
const gbp = (minor: number) => money(minor, 'GBP');

export const packed = request({
	packages: [
		{ id: 'p1', name: 'Creature' },
		{ id: 'p2', name: 'Comp' }
	],
	shots: [shot('a', { package: 'p1', frames: 10 }), shot('b', { package: 'p1', frames: 30 }), shot('c', { package: 'p2' }), shot('d', { package: 'p1', omitted: true })],
	assets: [asset('x', { package: 'p2' })]
});

/** A prices Creature as one figure, 1,000.00, and Comp row by row: c 300.00, x 200.00. */
export const byPackage = bid({
	id: 'A',
	vendorId: 'vA',
	currency: 'USD',
	lines: [line('Aa', onShot('a'), usd(0), { inPackage: true }), line('Ab', onShot('b'), usd(0), { inPackage: true }), line('Ac', onShot('c'), usd(30_000)), line('Ax', onAsset('x'), usd(20_000))],
	packages: [{ package: 'p1', total: usd(100_000) }],
	rebate: [{ jurisdiction: 'GB', workPercent: '100', rate: '10', base: { kind: 'all' } }]
});

/** B prices every row: a 300.00, b 600.00, c 250.00, x 250.00. */
export const byRow = bid({
	id: 'B',
	vendorId: 'vB',
	currency: 'USD',
	lines: [line('Ba', onShot('a'), usd(30_000)), line('Bb', onShot('b'), usd(60_000)), line('Bc', onShot('c'), usd(25_000)), line('Bx', onAsset('x'), usd(25_000))]
});

/** C in pounds at 1.25 prices Creature as one figure, 600.00 (750.00), c at 400.00 (500.00), and leaves x out. */
export const inPounds = bid({
	id: 'C',
	vendorId: 'vC',
	currency: 'GBP',
	rate: rate('GBP', 'USD', '1.25', '2026-11-20'),
	lines: [line('Ca', onShot('a'), gbp(0), { inPackage: true }), line('Cb', onShot('b'), gbp(0), { inPackage: true }), line('Cc', onShot('c'), gbp(40_000))],
	packages: [{ package: 'p1', total: gbp(60_000) }]
});
