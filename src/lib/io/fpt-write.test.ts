import { describe, expect, it } from 'vitest';
import { SgApiError, type BatchRequest, type EntityRow, type SgClient } from 'sg-widgets-core';
import { preflight, writeFields, WRITE_CHUNK } from './fpt-write';
import type { FptWrite } from '$lib/pure/row-edit';

const error = (status: number, title: string) => new SgApiError(status, { errors: [{ status, title }] }, title);

/** A site that refuses writes to the rows named, as one batch refusal rolls back the whole batch (recipe 002). */
function site(refuse: Set<number>, opts: { canWrite?: (field: string) => boolean } = {}) {
	const calls = { batches: [] as BatchRequest[][], updates: [] as number[] };
	const client = {
		async batch(requests: BatchRequest[]) {
			calls.batches.push(requests);
			for (const r of requests) {
				if (r.request_type !== 'update') continue;
				const field = Object.keys(r.data)[0];
				if (r.entity === 'Task' && r.record_id === 999999999) throw error(404, 'Entity of type [Task] with id=999999999 does not exist.');
				if (opts.canWrite && !opts.canWrite(field)) throw error(400, `The field is not editable for this user: [${r.entity}.${field}].`);
				if (refuse.has(r.record_id)) throw error(404, `Entity of type [Shot] with id=${r.record_id} does not exist.`);
			}
			return [];
		},
		async update(_type: string, id: number) {
			calls.updates.push(id);
			if (refuse.has(id)) throw error(404, `Entity of type [Shot] with id=${id} does not exist.`);
			return {} as EntityRow;
		},
		async read() {
			throw error(404, 'Not found');
		}
	} as unknown as SgClient;
	return { client, calls };
}

const write = (id: number): FptWrite => ({ itemId: `shot-${id}`, key: 'difficulty', type: 'Shot', id, field: 'sg_complexity', value: 'B', before: 'A' });

describe('writeFields', () => {
	it('sends the writes in batches of a hundred', async () => {
		const { client, calls } = site(new Set());
		const writes = Array.from({ length: WRITE_CHUNK + 20 }, (_, i) => write(i + 1));
		expect((await writeFields(client, writes)).size).toBe(0);
		expect(calls.batches.map((b) => b.length)).toEqual([100, 20]);
		expect(calls.batches[0][0]).toEqual({ request_type: 'update', entity: 'Shot', record_id: 1, data: { sg_complexity: 'B' } });
	});

	it('writes a refused batch one row at a time and names each refusal by index', async () => {
		const { client, calls } = site(new Set([2]));
		const refused = await writeFields(client, [write(1), write(2), write(3)]);
		expect(calls.updates).toEqual([1, 2, 3]);
		expect([...refused]).toEqual([[1, 'Entity of type [Shot] with id=2 does not exist.']]);
	});
});

describe('preflight', () => {
	const row: EntityRow = { type: 'Shot', id: 7, attributes: { sg_complexity: 'A', sg_brief: null }, relationships: {} };

	it('names the fields the site refuses, and passes the ones it lets through to the sentinel', async () => {
		const { client, calls } = site(new Set(), { canWrite: (field) => field !== 'sg_brief' });
		const denied = await preflight(client, row, ['sg_complexity', 'sg_brief']);
		expect(denied).toEqual({ sg_brief: 'The field is not editable for this user: [Shot.sg_brief].' });
		// Each ask carries the current value, then the sentinel, so the batch rolls back.
		expect(calls.batches.find((b) => 'sg_complexity' in (b[0] as { data: object }).data)?.[0]).toEqual({ request_type: 'update', entity: 'Shot', record_id: 7, data: { sg_complexity: 'A' } });
		expect(calls.batches.every((b) => b[1] && (b[1] as { record_id: number }).record_id === 999999999)).toBe(true);
	});
});
