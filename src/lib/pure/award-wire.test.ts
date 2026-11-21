import { describe, expect, it } from 'vitest';
import { parseAwardRecord, parseAwardUndo, parseSite, parseWritten } from './award-wire';

const REQ = '11111111-1111-4111-8111-111111111111';
const SC = '22222222-2222-4222-8222-222222222222';
const VA = '33333333-3333-4333-8333-333333333333';
const KEY = `sgbids/${REQ}/${VA}/r1`;
const SITE = { projectId: 1180, bidType: 'CustomEntity14', lineType: 'CustomEntity15', vendorField: { Shot: 'sg_vendor_groups' }, statuses: { awarded: 'awd' } };
const WRITTEN = {
	bids: [{ key: KEY, id: 5001, created: true }],
	lines: [{ key: `${KEY}/shot:shot-101`, id: 6001, created: true }],
	groups: [{ itemType: 'Shot', id: 101, field: 'sg_vendor_groups', groups: [38] }],
	attachments: [{ key: KEY, id: 77 }]
};

function body(extra: Record<string, unknown> = {}) {
	return { requestId: REQ, scenarioId: SC, state: 'published', site: SITE, written: WRITTEN, options: { allLines: false, groups: { [VA]: null } }, problems: [], error: null, exposure: null, byName: 'Kevin', ...extra };
}

describe('parseWritten', () => {
	it('takes what was written, keyed as the app keys it', () => {
		expect(parseWritten(WRITTEN)).toEqual(WRITTEN);
	});

	it('takes the Bid of a package and the general Bid, with their lines', () => {
		const packaged = {
			...WRITTEN,
			bids: [
				{ key: `${KEY}/p:seq%3ASQ%20A`, id: 5002, created: true },
				{ key: `${KEY}/general`, id: 5003, created: true }
			],
			lines: [{ key: `${KEY}/p:seq%3ASQ%20A/shot:shot-101`, id: 6002, created: true }]
		};
		expect(parseWritten(packaged)).toEqual(packaged);
		expect(parseWritten({ ...WRITTEN, bids: [{ key: `${KEY}/p:seq:raw space`, id: 1, created: true }] })).toBeNull();
	});

	it('refuses a foreign key, a bad id, a field name that is not one, an empty Group list', () => {
		expect(parseWritten({ ...WRITTEN, bids: [{ key: 'other/1', id: 1, created: true }] })).toBeNull();
		expect(parseWritten({ ...WRITTEN, lines: [{ key: KEY, id: -1, created: true }] })).toBeNull();
		expect(parseWritten({ ...WRITTEN, groups: [{ itemType: 'Shot', id: 1, field: 'x; drop', groups: [1] }] })).toBeNull();
		expect(parseWritten({ ...WRITTEN, groups: [{ itemType: 'Shot', id: 1, field: 'f', groups: [] }] })).toBeNull();
		expect(parseWritten({ ...WRITTEN, groups: [{ itemType: 'Task', id: 1, field: 'f', groups: [1] }] })).toBeNull();
		expect(parseWritten(null)).toBeNull();
	});
});

describe('parseWritten, the rows a publish created', () => {
	it('takes Shots, Assets and Sequences keyed as the app keys them', () => {
		const items = [
			{ key: 'shot:shot-bd-1f2e', type: 'Shot', id: 9001 },
			{ key: 'asset:asset-bd-9', type: 'Asset', id: 9002 },
			{ key: 'sequence:sq new', type: 'Sequence', id: 300 }
		];
		expect(parseWritten({ ...WRITTEN, items })).toEqual({ ...WRITTEN, items });
	});

	it('refuses another type, a bad key or id', () => {
		expect(parseWritten({ ...WRITTEN, items: [{ key: 'shot:a', type: 'Task', id: 1 }] })).toBeNull();
		expect(parseWritten({ ...WRITTEN, items: [{ key: 'task:a', type: 'Shot', id: 1 }] })).toBeNull();
		expect(parseWritten({ ...WRITTEN, items: [{ key: 'shot:a', type: 'Shot', id: 0 }] })).toBeNull();
		expect(parseWritten({ ...WRITTEN, items: [{ key: 'shot:a', type: 'Sequence', id: 1 }] })).toBeNull();
		expect(parseWritten({ ...WRITTEN, items: 'x' })).toBeNull();
	});
});

describe('parseAwardRecord, the choice for rows with no Flow PT row', () => {
	it('keeps the choice per kind and the Sequence switch, and refuses another', () => {
		const out = parseAwardRecord(body({ options: { allLines: false, groups: {}, missing: { shot: 'create', asset: 'without', sequences: true } } }), 1180);
		expect(out.ok && out.value.options.missing).toEqual({ shot: 'create', asset: 'without', sequences: true });
		expect(parseAwardRecord(body({ options: { allLines: false, groups: {}, missing: { shot: 'maybe' } } }), 1180).ok).toBe(false);
	});
});

describe('parseSite', () => {
	it("takes the site's names for the verified project only", () => {
		expect(parseSite(SITE, 1180)).toEqual(SITE);
		expect(parseSite(SITE, 1181)).toBeNull();
		expect(parseSite({ ...SITE, bidType: 'Shot' }, 1180)).toBeNull();
		expect(parseSite({ ...SITE, statuses: { won: 'awd' } }, 1180)).toBeNull();
		expect(parseSite({ ...SITE, vendorField: { Task: 'sg_x' } }, 1180)).toBeNull();
	});
});

describe('parseAwardRecord', () => {
	it('takes a run, with the choice to publish anyway', () => {
		const exposure = { state: 'unknown', lines: ['The app could not read what the Vendor role may see.'] };
		const parsed = parseAwardRecord(body({ exposure }), 1180);
		expect(parsed).toEqual({
			ok: true,
			value: { requestId: REQ, scenarioId: SC, state: 'published', site: SITE, written: WRITTEN, options: { allLines: false, groups: { [VA]: null } }, problems: [], error: null, exposure, byName: 'Kevin' }
		});
	});

	it('holds a run with an error or a read-back difference to partial', () => {
		expect(parseAwardRecord(body({ error: 'Bids: 400' }), 1180)).toEqual({ ok: false, message: 'A run with an error or a difference is partial.' });
		expect(parseAwardRecord(body({ state: 'partial', error: 'Bids: 400', problems: ['x: no row reads back.'] }), 1180).ok).toBe(true);
	});

	it('refuses what is not named, typed or sized', () => {
		expect(parseAwardRecord(body({ requestId: 'x' }), 1180).ok).toBe(false);
		expect(parseAwardRecord(body({ state: 'done' }), 1180).ok).toBe(false);
		expect(parseAwardRecord(body({ options: { allLines: 'yes', groups: {} } }), 1180).ok).toBe(false);
		expect(parseAwardRecord(body({ options: { allLines: false, groups: { notauuid: 1 } } }), 1180).ok).toBe(false);
		expect(parseAwardRecord(body({ exposure: { state: 'safe', lines: [] } }), 1180).ok).toBe(false);
		expect(parseAwardRecord(body({ error: 'x'.repeat(2001), state: 'partial' }), 1180).ok).toBe(false);
	});
});

describe('parseAwardUndo', () => {
	it('takes a clean undo, or what is left with the error', () => {
		expect(parseAwardUndo({ requestId: REQ, remaining: null, error: null })).toEqual({ ok: true, value: { requestId: REQ, remaining: null, error: null } });
		expect(parseAwardUndo({ requestId: REQ, remaining: WRITTEN, error: 'Batch refused.' })).toEqual({ ok: true, value: { requestId: REQ, remaining: WRITTEN, error: 'Batch refused.' } });
		expect(parseAwardUndo({ requestId: REQ, remaining: { bids: 'x' }, error: null }).ok).toBe(false);
	});
});
