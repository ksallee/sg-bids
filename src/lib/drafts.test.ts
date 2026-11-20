import { describe, expect, it, vi } from 'vitest';

import { keyValueCushion, serverDraftStore, type DraftApi, type KeyValue } from './drafts';

// The real API calls this app's server; these tests hand the store a fake one.
vi.mock('$lib/api', () => ({ api: {} }));
import { request, shot } from './pure/fixtures';
import type { BidRequest } from './pure/model';

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

function draft(id: string, extra: Partial<BidRequest['header']> = {}): BidRequest {
	return request({
		id,
		header: { code: 'DS_R1', project: 'Demo', projectRef: { type: 'Project', id: 85 }, round: 1, baseCurrency: 'USD', assumptions: [], ...extra },
		shots: [shot('shot-1')]
	});
}

function fakeApi() {
	const calls: { projectId: number; body: unknown }[] = [];
	const remote: DraftApi = {
		save: async (projectId, body) => {
			calls.push({ projectId, body });
			return { request: { ...draft(UUID) } };
		},
		get: async () => ({ request: draft(UUID), status: 'draft', issuedAt: null, invitations: [], award: null })
	};
	return { remote, calls };
}

describe('serverDraftStore', () => {
	it('creates a draft the server has not seen, in the project the header names', async () => {
		const { remote, calls } = fakeApi();
		const stored = await serverDraftStore(remote).saveDraft(draft('local-abc'));
		expect(stored.id).toBe(UUID);
		expect(calls[0].projectId).toBe(85);
		expect(calls[0].body).toMatchObject({ id: null, code: 'DS_R1' });
	});

	it('updates a stored draft by its id', async () => {
		const { remote, calls } = fakeApi();
		await serverDraftStore(remote).saveDraft(draft(UUID));
		expect(calls[0].body).toMatchObject({ id: UUID });
	});

	it('refuses a draft with no project or no code, before any call', async () => {
		const { remote, calls } = fakeApi();
		const store = serverDraftStore(remote);
		await expect(store.saveDraft(draft('local-1', { projectRef: undefined }))).rejects.toThrow('Pick a project to save the draft.');
		await expect(store.saveDraft(draft('local-1', { code: ' ' }))).rejects.toThrow('Give the request a code to save it.');
		expect(calls).toEqual([]);
	});
});

describe('keyValueCushion', () => {
	it('keeps a draft and reads the same one back', async () => {
		const cushion = keyValueCushion(memory());
		const kept = draft('local-1');
		await cushion.keep(kept);
		expect(await cushion.read()).toEqual(kept);
		await cushion.clear();
		expect(await cushion.read()).toBeNull();
	});

	it('reads garbage as no draft', async () => {
		const storage = memory();
		storage.data.set('sg-bids:draft', '{"nope":1}');
		expect(await keyValueCushion(storage).read()).toBeNull();
		storage.data.set('sg-bids:draft', 'not json');
		expect(await keyValueCushion(storage).read()).toBeNull();
	});

	it('never throws when storage is blocked or missing', async () => {
		const boom = () => {
			throw new Error('blocked');
		};
		for (const cushion of [keyValueCushion({ getItem: boom, setItem: boom, removeItem: boom }), keyValueCushion(null)]) {
			await expect(cushion.keep(draft('local-1'))).resolves.toBeUndefined();
			await expect(cushion.read()).resolves.toBeNull();
			await expect(cushion.clear()).resolves.toBeUndefined();
		}
	});
});
