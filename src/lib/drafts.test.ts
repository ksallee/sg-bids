import { describe, expect, it, vi } from 'vitest';

import { keyValueCushion, serverBidStore, serverDraftStore, type BidApi, type DraftApi, type KeptBid, type KeyValue } from './drafts';

// The real API calls this app's server; these tests hand the stores a fake one.
vi.mock('$lib/api', () => ({ api: {}, bidsApi: {} }));
import { request, shot } from './pure/fixtures';

function memory(): KeyValue & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => void data.set(key, value),
		removeItem: (key) => void data.delete(key)
	};
}

const UUID = '6f1c2a4e-0000-4000-8000-000000000000';

function kept(id: string): KeptBid {
	return { id, project: { id: 85, name: 'Demo' }, name: 'SEQ010', shots: [shot('shot-1')], assets: [] };
}

describe('serverBidStore', () => {
	function fake() {
		const calls: { projectId: number; body: unknown }[] = [];
		const remote: BidApi = {
			save: async (projectId, body) => {
				calls.push({ projectId, body });
				return { bid: { id: UUID, name: body.name, shots: [], assets: [] }, projectId, updatedAt: '2026-11-20T10:00:00Z', requests: [] };
			},
			get: async () => ({ bid: { id: UUID, name: 'SEQ010', shots: [], assets: [] }, projectId: 85, updatedAt: '2026-11-20T10:00:00Z', requests: [] })
		};
		return { remote, calls };
	}

	it('creates a bid the server has not seen, and updates a stored one by its id', async () => {
		const { remote, calls } = fake();
		const store = serverBidStore(remote);
		const stored = await store.save(85, kept('local-abc'));
		expect(stored.bid.id).toBe(UUID);
		await store.save(85, kept(UUID));
		expect(calls.map((c) => [c.projectId, (c.body as { id: string | null }).id])).toEqual([
			[85, null],
			[85, UUID]
		]);
		expect(calls[0].body).toMatchObject({ name: 'SEQ010', items: { shots: [shot('shot-1')], assets: [] } });
	});

	it('refuses a bid with no name, before any call', async () => {
		const { remote, calls } = fake();
		await expect(serverBidStore(remote).save(85, { ...kept('local-1'), name: ' ' })).rejects.toThrow('Name the bid to save it.');
		expect(calls).toEqual([]);
	});
});

describe('serverDraftStore', () => {
	function fake() {
		const calls: { projectId: number; body: unknown }[] = [];
		const remote: DraftApi = {
			save: async (projectId, body) => {
				calls.push({ projectId, body });
				return { request: request({ id: UUID }) };
			},
			get: async () => ({ request: request({ id: UUID }), overlaps: [], status: 'draft', issuedAt: null, invitations: [], award: null })
		};
		return { remote, calls };
	}

	it('sends the header, and the bids only when they are given', async () => {
		const { remote, calls } = fake();
		const store = serverDraftStore(remote);
		const header = { code: 'DS_R1', project: 'Demo', round: 1, baseCurrency: 'USD', assumptions: [] };
		await store.save(85, { id: null, code: ' DS_R1 ', header, bids: ['b1', 'b2'] });
		await store.save(85, { id: UUID, code: 'DS_R1', header });
		expect(calls[0]).toEqual({ projectId: 85, body: { id: null, code: 'DS_R1', header, bids: ['b1', 'b2'] } });
		expect(calls[1].body).toEqual({ id: UUID, code: 'DS_R1', header });
	});

	it('refuses a draft with no code, before any call', async () => {
		const { remote, calls } = fake();
		await expect(serverDraftStore(remote).save(85, { id: null, code: ' ', header: { project: 'Demo', round: 1, baseCurrency: 'USD', assumptions: [] } })).rejects.toThrow(
			'Give the request a code to save it.'
		);
		expect(calls).toEqual([]);
	});
});

describe('keyValueCushion', () => {
	it('keeps a bid and reads the same one back', async () => {
		const cushion = keyValueCushion(memory());
		await cushion.keep(kept('local-1'));
		expect(await cushion.read()).toEqual(kept('local-1'));
		await cushion.clear();
		expect(await cushion.read()).toBeNull();
	});

	it('reads garbage as no bid', async () => {
		const storage = memory();
		storage.data.set('sg-bids:bid', '{"nope":1}');
		expect(await keyValueCushion(storage).read()).toBeNull();
		storage.data.set('sg-bids:bid', 'not json');
		expect(await keyValueCushion(storage).read()).toBeNull();
	});

	it('never throws when storage is blocked or missing', async () => {
		const boom = () => {
			throw new Error('blocked');
		};
		for (const cushion of [keyValueCushion({ getItem: boom, setItem: boom, removeItem: boom }), keyValueCushion(null)]) {
			await expect(cushion.keep(kept('local-1'))).resolves.toBeUndefined();
			await expect(cushion.read()).resolves.toBeNull();
			await expect(cushion.clear()).resolves.toBeUndefined();
		}
	});
});
