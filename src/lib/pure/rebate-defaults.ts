/**
 * Default rebate rates, one entry per jurisdiction. A user edits them per bid; the app shows every
 * result as an estimate with the date checked. Rates change: check the source before relying on
 * one.
 *
 * Where a jurisdiction has stacked rates, each is its own component: `base`, then an `uplift` on
 * top, or a rate that applies `instead` under a condition. Whether stacked credits apply to the
 * same base was not verified, so the table never adds them into one number.
 *
 * Only what the sources below say is here. Where a source gives no base beyond "spend" or "costs",
 * the base is `all`.
 */

import type { Day, Percent, RebateBase } from './model';

export type Claimant = 'production' | 'vendor' | 'either';

export interface RateComponent {
	readonly label: string;
	readonly rate: Percent;
	/** `base` first; `uplift` adds to it; `instead` replaces it when the condition holds. */
	readonly kind: 'base' | 'uplift' | 'instead';
	readonly condition?: string;
}

export interface RebateDefault {
	/** ISO 3166 code. */
	readonly code: string;
	readonly label: string;
	readonly rates: readonly RateComponent[];
	readonly base: RebateBase;
	/** Who usually claims it. */
	readonly claimedBy: Claimant;
	readonly source: string;
	readonly checked: Day;
}

const checked = '2026-11-20';

export const REBATE_DEFAULTS: readonly RebateDefault[] = [
	{
		code: 'GB',
		label: 'UK AVEC, VFX',
		rates: [{ label: 'AVEC on UK VFX costs', rate: '39', kind: 'base' }],
		base: { kind: 'all' },
		claimedBy: 'production',
		source:
			'https://www.gov.uk/government/publications/corporation-tax-additional-tax-credit-for-visual-effects-vfx-expenditure/additional-tax-relief-for-visual-effects-vfx',
		checked
	},
	{
		code: 'CA',
		label: 'Canada federal PSTC',
		rates: [{ label: 'PSTC on qualified Canadian labour', rate: '16', kind: 'base' }],
		base: { kind: 'labour' },
		claimedBy: 'production',
		source:
			'https://www.canada.ca/en/revenue-agency/services/tax/international-non-residents/film-media-tax-credits/film-video-production-services-tax-credit-overview.html',
		checked
	},
	{
		code: 'CA-BC',
		label: 'British Columbia production services',
		rates: [
			{ label: 'Basic, on qualified BC labour', rate: '36', kind: 'base' },
			{ label: 'DAVE', rate: '16', kind: 'uplift' }
		],
		base: { kind: 'labour' },
		claimedBy: 'production',
		source: 'https://www2.gov.bc.ca/gov/content/taxes/income-taxes/corporate/credits/production-services',
		checked
	},
	{
		code: 'CA-QC',
		label: 'Quebec PSTC',
		rates: [
			{ label: 'Base', rate: '25', kind: 'base' },
			{ label: 'VFX and animation', rate: '16', kind: 'uplift' }
		],
		base: { kind: 'contract', percent: '65' },
		claimedBy: 'production',
		source: 'https://sodec.gouv.qc.ca/wp-content/uploads/fact-sheet-quebec-pstc-2024-april.pdf',
		checked
	},
	{
		code: 'CA-ON',
		label: 'Ontario OCASE',
		rates: [{ label: 'OCASE on Ontario labour', rate: '18', kind: 'base' }],
		base: { kind: 'labour' },
		claimedBy: 'vendor',
		source: 'https://ontariocreates.ca/tax-incentives/ocase',
		checked
	},
	{
		code: 'AU',
		label: 'Australia PDV Offset',
		rates: [{ label: 'PDV Offset on qualifying spend', rate: '30', kind: 'base' }],
		base: { kind: 'all' },
		claimedBy: 'either',
		source:
			'https://arts.gov.au/sites/default/files/documents/post-digital-and-visual-effects-pdv-offset-guidelines-april-2025.pdf',
		checked
	},
	{
		code: 'FR',
		label: 'France TRIP',
		rates: [
			{ label: 'TRIP', rate: '30', kind: 'base' },
			{ label: 'TRIP, higher rate', rate: '40', kind: 'instead', condition: 'French VFX spend over EUR 2M' }
		],
		base: { kind: 'all' },
		claimedBy: 'production',
		source: 'https://www.cnc.fr/web/en/tax-rebate/the-tax-rebate-for-international-productions-trip_190742',
		checked
	},
	{
		code: 'NZ',
		label: 'New Zealand PDV rebate',
		rates: [
			{ label: 'PDV rebate', rate: '20', kind: 'base' },
			{ label: 'Uplift', rate: '5', kind: 'uplift' }
		],
		base: { kind: 'all' },
		claimedBy: 'either',
		source: 'https://www.nzfilm.co.nz/assets/resources/NZFC_RebatesSummaries_Nov2025_PDV.pdf',
		checked
	}
];

export function rebateDefault(code: string): RebateDefault | undefined {
	return REBATE_DEFAULTS.find((entry) => entry.code === code);
}
