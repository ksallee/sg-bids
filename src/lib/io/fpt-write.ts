/**
 * Writes to a draft's Shots and Assets, as the signed in person, and the checks around them. Thin:
 * every decision is in `src/lib/pure/row-edit.ts`. Facts from `../sg-groundtruth/corpus`:
 *
 * - `POST /entity/_batch` is all or nothing and answers in request order; a batch of about 200
 *   answers inside the response window (recipe 002). A refused batch wrote nothing, so its writes
 *   go one `PUT` at a time to learn which the site refuses, each with its own words (028: a 400
 *   names what it wanted).
 * - A write is confirmed by reading the rows back, never by its status (028, 024).
 * - Whether the person may write a field is asked with a write that cannot land: the update in a
 *   `_batch` with a sentinel update of a Task id that does not exist, which rolls the batch back.
 *   A refusal is a 400 naming the field, checked before the sentinel's 404 (094, recipe 017).
 */

import { SgApiError, type EntityRow, type SgClient } from 'sg-widgets-core';
import type { FptWrite } from '$lib/pure/row-edit';
import { rowsByIds } from './reads';

/** Writes per `_batch`, inside the 200 the response window holds (recipe 002). */
export const WRITE_CHUNK = 100;

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Send the writes. Answers the ones the site refused, by index, with its words. */
export async function writeFields(client: SgClient, writes: readonly FptWrite[]): Promise<Map<number, string>> {
	const refused = new Map<number, string>();
	for (let start = 0; start < writes.length; start += WRITE_CHUNK) {
		const part = writes.slice(start, start + WRITE_CHUNK);
		try {
			await client.batch(part.map((w) => ({ request_type: 'update' as const, entity: w.type, record_id: w.id, data: { [w.field]: w.value } })));
		} catch {
			for (const [offset, w] of part.entries()) {
				try {
					await client.update(w.type, w.id, { [w.field]: w.value });
				} catch (error) {
					refused.set(start + offset, message(error));
				}
			}
		}
	}
	return refused;
}

/** The rows the writes touched, read again with the fields given, a type at a time. */
export async function readRows(client: SgClient, refs: readonly { type: string; id: number }[], fieldsOf: (type: string) => string[]): Promise<EntityRow[]> {
	const rows: EntityRow[] = [];
	for (const type of new Set(refs.map((r) => r.type))) {
		const ids = [...new Set(refs.filter((r) => r.type === type).map((r) => r.id))];
		if (ids.length > 0) rows.push(...(await rowsByIds(client, type, ids, fieldsOf(type))));
	}
	return rows;
}

const SENTINEL = { request_type: 'update' as const, entity: 'Task', record_id: 999999999, data: { content: 'x' } };

/** The site's words for an API error: the first error's title, else its detail, else the message. */
function words(error: unknown): { status: number; text: string } {
	if (error instanceof SgApiError) {
		const first = (error.body as { errors?: { title?: unknown; detail?: unknown }[] } | null)?.errors?.[0];
		const parts = [first?.title, first?.detail].filter((p): p is string => typeof p === 'string');
		return { status: error.status, text: parts.join(' ') || error.message };
	}
	return { status: 0, text: message(error) };
}

/**
 * The fields the person may not write on this row, with what the site said. Each field is asked
 * with its current value in a batch that rolls back, so nothing is written (094). A field whose
 * answer is not a refusal or the sentinel's 404 is left unlocked: the real write reports loudly.
 */
export async function preflight(client: SgClient, row: EntityRow, fields: readonly string[]): Promise<Record<string, string>> {
	try {
		await client.read('Task', SENTINEL.record_id);
		return {};
	} catch {
		// The sentinel id answers 404: it is safe to use (recipe 017).
	}
	const denied: Record<string, string> = {};
	await Promise.all(
		fields.map(async (field) => {
			const value = field in row.attributes ? row.attributes[field] : (row.relationships[field]?.data ?? null);
			try {
				await client.batch([{ request_type: 'update', entity: row.type, record_id: row.id, data: { [field]: value } }, SENTINEL]);
			} catch (error) {
				const { status, text } = words(error);
				if (status === 400 && text.includes(`${row.type}.${field}`)) denied[field] = text;
			}
		})
	);
	return denied;
}
