/**
 * Once per `pnpm test:db` run: apply every migration, in order, to the fresh database, twice to
 * prove they are idempotent, then wait until PostgREST serves the new tables.
 */
import { jwt, migrations, REST_URL, superuser } from './helpers';

export default async function setup(): Promise<void> {
	const sql = superuser();
	try {
		for (let pass = 0; pass < 2; pass++) {
			for (const { name, sql: text } of migrations()) {
				try {
					await sql.unsafe(text).simple();
				} catch (error) {
					throw new Error(`Migration ${name} failed on pass ${pass + 1}: ${error instanceof Error ? error.message : error}`);
				}
			}
		}
		await sql`notify pgrst, 'reload schema'`;
	} finally {
		await sql.end();
	}

	const deadline = Date.now() + 30_000;
	for (;;) {
		try {
			const res = await fetch(`${REST_URL()}/bid_requests?limit=0`, { headers: { Authorization: `Bearer ${jwt('service_role')}` } });
			if (res.ok) return;
		} catch {
			/* not up yet */
		}
		if (Date.now() > deadline) throw new Error('PostgREST did not serve the tables.');
		await new Promise((done) => setTimeout(done, 300));
	}
}
