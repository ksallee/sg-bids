import { describe, expect, it } from 'vitest';
import { asset, request, shot } from './fixtures';
import { emptyHeaderForm } from './header';
import { isLocalId, localId, nextRound, savable } from './persist';
import type { BuilderState } from './request';

function state(extra: Partial<BuilderState> = {}): BuilderState {
	return {
		id: 'local-1',
		project: { id: 85, name: 'Demo Show' },
		form: { ...emptyHeaderForm('EUR'), code: ' DS_R1 ', title: 'Main bid' },
		shots: [shot('shot-1', { thumbnail: 'https://s3/presigned?sig=x', fpt: { type: 'Shot', id: 1 } })],
		assets: [asset('asset-9')],
		...extra
	};
}

describe('local ids', () => {
	it('marks a draft the server has not seen yet', () => {
		expect(isLocalId(localId('abc'))).toBe(true);
		expect(isLocalId('6f1c2a4e-0000-4000-8000-000000000000')).toBe(false);
	});
});

describe('savable', () => {
	it('gives the code, the header and the items to store', () => {
		const out = savable(state());
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.code).toBe('DS_R1');
		expect(out.header.baseCurrency).toBe('EUR');
		expect(out.header.code).toBe('DS_R1');
		expect(out.items.shots.map((s) => s.id)).toEqual(['shot-1']);
		expect(out.items.assets.map((a) => a.id)).toEqual(['asset-9']);
	});

	it('stores no thumbnail: a presigned URL expires (081)', () => {
		const out = savable(state());
		expect(out.ok && 'thumbnail' in out.items.shots[0]).toBe(false);
	});

	it('waits for a project and a code', () => {
		expect(savable(state({ project: null }))).toEqual({ ok: false, reason: 'Pick a project to save the draft.' });
		expect(savable(state({ form: { ...emptyHeaderForm(), code: ' ' } }))).toEqual({ ok: false, reason: 'Give the request a code to save it.' });
	});

	it('leaves out a date or a link that does not pass yet, so a half typed form still saves', () => {
		const out = savable(state({ form: { ...state().form, dueDate: '2026-02-30', turnoverDate: 'soon', deliveryDate: '2027-01-10', round: 'x' } }));
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.header.dueDate).toBeUndefined();
		expect(out.header.turnoverDate).toBeUndefined();
		expect(out.header.deliveryDate).toBe('2027-01-10');
		expect(out.header.round).toBe(1);
	});

	it('keeps the base currency only when it is on the list, else USD', () => {
		const out = savable(state({ form: { ...state().form, baseCurrency: 'XAU' } }));
		expect(out.ok && out.header.baseCurrency).toBe('USD');
	});
});

describe('nextRound', () => {
	it('copies the request into the next round as a draft', () => {
		const issued = request({
			header: { code: 'DS_R1', project: 'Demo Show', projectRef: { type: 'Project', id: 85 }, round: 1, baseCurrency: 'EUR', assumptions: ['A'] },
			shots: [shot('shot-1', { omitted: true })],
			assets: [asset('asset-9', { timesUsed: 3 })],
			vendors: [{ id: 'v1', name: 'Vendor', email: 'v@x.test', ndaExecuted: false }]
		});
		const next = nextRound(issued);
		expect(next.code).toBe('DS_R1');
		expect(next.header.round).toBe(2);
		expect(next.header.assumptions).toEqual(['A']);
		expect(next.items.shots[0]).toEqual(issued.shots[0]);
		expect(next.items.assets[0].timesUsed).toBeUndefined();
	});
});
