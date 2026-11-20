/**
 * The migrations apply in order to an empty database (the setup did, twice) and again on top of
 * themselves without an error or a change.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { TABLES } from '$lib/pure/access';
import { migrations, superuser } from './helpers';

const sql = superuser();

afterAll(async () => {
	await sql.end();
});

describe('the migrations', () => {
	it('are timestamped plain SQL, in order', () => {
		const names = migrations().map((m) => m.name);
		expect(names.length).toBeGreaterThan(0);
		for (const name of names) expect(name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
		expect([...names].sort()).toEqual(names);
	});

	it('apply again without an error and leave the same tables', async () => {
		const tables = async () =>
			(await sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`).map((t) => t.table_name);
		const before = await tables();
		for (const { sql: text } of migrations()) await sql.unsafe(text).simple();
		expect(await tables()).toEqual(before);
		expect(before).toEqual([...TABLES].sort());
	});
});
