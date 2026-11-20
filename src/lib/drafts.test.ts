import { describe, expect, it } from 'vitest';
import { keyValueDraftStore, type KeyValue } from './drafts';
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

describe('keyValueDraftStore', () => {
	it('saves a draft and reads the same one back', async () => {
		const store = keyValueDraftStore(memory());
		const draft = request({ shots: [shot('shot-1')] });
		await store.saveDraft(draft);
		expect(await store.loadDraft()).toEqual(draft);
	});

	it('has nothing before a save and after a clear', async () => {
		const store = keyValueDraftStore(memory());
		expect(await store.loadDraft()).toBeNull();
		await store.saveDraft(request());
		await store.clearDraft();
		expect(await store.loadDraft()).toBeNull();
	});

	it('reads garbage as no draft', async () => {
		const storage = memory();
		storage.data.set('sg-bids:draft', '{"nope":1}');
		expect(await keyValueDraftStore(storage).loadDraft()).toBeNull();
		storage.data.set('sg-bids:draft', 'not json');
		expect(await keyValueDraftStore(storage).loadDraft()).toBeNull();
	});

	it('never throws when storage is blocked or missing', async () => {
		const blocked: KeyValue = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		};
		for (const store of [keyValueDraftStore(blocked), keyValueDraftStore(null)]) {
			await expect(store.saveDraft(request())).resolves.toBeUndefined();
			await expect(store.loadDraft()).resolves.toBeNull();
			await expect(store.clearDraft()).resolves.toBeUndefined();
		}
	});
});
