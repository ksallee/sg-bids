import { describe, expect, it, vi } from 'vitest';

import { serverDraftStore, type DraftApi, type EditedDraft } from './drafts';

// The real API calls this app's server; these tests hand the store a fake one.
vi.mock('$lib/api', () => ({ api: {} }));
import { emptyHeaderForm } from './pure/header';
import { shot } from './pure/fixtures';
import { blankVendor } from './pure/vendor-rows';

const UUID = '6f1c2a4e-0000-4000-8000-000000000000';

function edited(extra: Partial<EditedDraft> = {}): EditedDraft {
	return {
		id: UUID,
		project: { id: 85, name: 'Demo' },
		form: { ...emptyHeaderForm(), code: 'ROOF-01', title: 'Rooftop', dueDate: '2026-02-30' },
		bids: [
			{ key: 'bid:a', name: 'Bid 1' },
			{ key: 'bid:b', name: 'Hero' }
		],
		rows: { shots: [{ ...shot('shot-1', { thumbnail: 'https://x' }), package: 'bid:b' }], assets: [] },
		vendors: [blankVendor('v0'), { ...blankVendor('v1'), name: 'Studio A', email: 'a@a.com', bids: ['bid:b'] }],
		...extra
	};
}

describe('serverDraftStore', () => {
	function fake() {
		const calls: { projectId: number; body: unknown }[] = [];
		const remote: DraftApi = {
			saveDraft: async (projectId, body) => {
				calls.push({ projectId, body });
				return { ok: true };
			},
			get: async () => {
				throw new Error('not here');
			}
		};
		return { remote, calls };
	}

	it('saves the page in one call: the details as they read, each bid with its rows, the vendors typed in', async () => {
		const { remote, calls } = fake();
		await serverDraftStore(remote).save(edited());
		expect(calls).toHaveLength(1);
		expect(calls[0].projectId).toBe(85);
		const body = calls[0].body as { id: string; header: Record<string, unknown>; bids: unknown[]; vendors: unknown[] };
		expect(body.id).toBe(UUID);
		expect(body.header.title).toBe('Rooftop');
		expect('dueDate' in body.header).toBe(false);
		expect(body.bids).toEqual([
			{ key: 'bid:a', name: 'Bid 1', items: { shots: [], assets: [] } },
			{ key: 'bid:b', name: 'Hero', items: { shots: [shot('shot-1')], assets: [] } }
		]);
		expect(body.vendors).toEqual([{ id: 'v1', name: 'Studio A', email: 'a@a.com', group: null, bids: ['bid:b'] }]);
	});

	it('refuses two bids of one name, before any call', async () => {
		const { remote, calls } = fake();
		await expect(serverDraftStore(remote).save(edited({ bids: [{ key: 'bid:a', name: 'Hero' }, { key: 'bid:b', name: 'hero' }] }))).rejects.toThrow(
			'Two bids are named Hero. Give each its own name.'
		);
		expect(calls).toEqual([]);
	});
});
