import { describe, expect, it } from 'vitest';
import { DEFAULT_INVITATION_DAYS } from '$lib/server/store';
import { CURRENCIES } from './currencies';
import { DOCS, HOW, LINK_DAYS, REBATE_PLACES } from './public-content';
import { REBATE_DEFAULTS } from './rebate-defaults';
import { REPO } from './seo';

describe('the facts the pages state', () => {
	it('gives a vendor link the days the store gives it', () => {
		expect(LINK_DAYS).toBe(DEFAULT_INVITATION_DAYS);
		expect(HOW.vendors.list.some((line) => line.includes(`${DEFAULT_INVITATION_DAYS} days`))).toBe(true);
	});

	it('names a place for every rebate default, and counts them right', () => {
		for (const entry of REBATE_DEFAULTS) expect(REBATE_PLACES[entry.code], entry.code).toBeDefined();
		const line = HOW.money.list.find((l) => l.startsWith('Default rates'))!;
		expect(line).toContain(`for ${REBATE_DEFAULTS.length} places`);
		for (const entry of REBATE_DEFAULTS) expect(line).toContain(REBATE_PLACES[entry.code]);
	});

	it('counts the currencies a request can be based in from the list itself', () => {
		expect(HOW.money.list).toContain(`A request can be based in any of ${CURRENCIES.length} ISO 4217 currencies.`);
	});

	it('says how a request is deleted and a vendor draft discarded', () => {
		expect(HOW.stays.note).toContain('delete a request');
		expect(HOW.stays.note).toContain('undo it first');
		expect(HOW.stays.note).toContain('writes nothing to Flow PT');
		expect(HOW.vendors.list.some((line) => line.startsWith('A vendor can discard a draft.'))).toBe(true);
	});

	it('links the docs on GitHub, in the main branch', () => {
		for (const link of Object.values(DOCS)) expect(link.href.startsWith(REPO)).toBe(true);
		expect(DOCS.deploy.href).toBe(`${REPO}/blob/main/docs/deploy.md`);
	});
});
