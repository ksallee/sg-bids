import { describe, expect, it } from 'vitest';
import type { EntityRow, SearchOptions, SgClient } from 'sg-widgets-core';
import { ID_CHUNK, PAGE_SIZE, loadSequences, rowsByIds, searchAll } from './reads';

function rows(n: number): EntityRow[] {
	return Array.from({ length: n }, (_, i) => ({ type: 'Shot', id: i + 1, attributes: {}, relationships: {} }));
}

/** Answers `search` from a list, a page at a time, as the client does: `hasMore` from a full page (006). */
function client(all: EntityRow[]): { client: SgClient; calls: SearchOptions[] } {
	const calls: SearchOptions[] = [];
	const fake = {
		async search(_type: string, options: SearchOptions) {
			calls.push(options);
			const ids = options.filters?.conditions.find((c) => Array.isArray(c) && c[0] === 'id') as [string, string, number[]] | undefined;
			const pool = ids ? all.filter((row) => ids[2].includes(row.id)) : all;
			const size = options.page?.size ?? 500;
			const start = ((options.page?.number ?? 1) - 1) * size;
			const data = pool.slice(start, start + size);
			return { data, hasMore: data.length === size };
		}
	} as unknown as SgClient;
	return { client: fake, calls };
}

const all = { logical_operator: 'and' as const, conditions: [] };

describe('searchAll', () => {
	it('reads pages of 5000 until a short one (082, 006)', async () => {
		const fake = client(rows(PAGE_SIZE + 3));
		const got = await searchAll(fake.client, 'Shot', all, ['code']);
		expect(got).toHaveLength(PAGE_SIZE + 3);
		expect(fake.calls.map((c) => c.page)).toEqual([
			{ size: 5000, number: 1 },
			{ size: 5000, number: 2 }
		]);
	});

	it('reads one page when the set is short', async () => {
		const fake = client(rows(3));
		expect(await searchAll(fake.client, 'Shot', all, ['code'])).toHaveLength(3);
		expect(fake.calls).toHaveLength(1);
	});
});

describe('rowsByIds', () => {
	it('reads ids a chunk at a time', async () => {
		const fake = client(rows(ID_CHUNK + 10));
		const ids = rows(ID_CHUNK + 10).map((r) => r.id);
		expect(await rowsByIds(fake.client, 'Shot', ids, ['code'])).toHaveLength(ID_CHUNK + 10);
		expect(fake.calls).toHaveLength(2);
	});
});

describe('loadSequences', () => {
	it("reads the project's Sequences with the Episode link when there is one", async () => {
		const fake = client(rows(2));
		await loadSequences(fake.client, 85, 'episode');
		expect(fake.calls[0].fields).toEqual(['code', 'episode']);
		expect(fake.calls[0].filters?.conditions).toEqual([['project', 'is', { type: 'Project', id: 85 }]]);
		expect(fake.calls[0].sort).toBe('code');
		await loadSequences(fake.client, 85, null);
		expect(fake.calls[1].fields).toEqual(['code']);
	});
});
