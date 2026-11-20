// `pnpm test:db`: the database tests, against the throwaway Postgres and PostgREST that
// `scripts/test-db.mjs` starts. Never part of `pnpm test`.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: { alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } },
	test: {
		name: 'db',
		environment: 'node',
		include: ['tests/db/**/*.db.test.ts'],
		globalSetup: ['tests/db/setup.ts'],
		fileParallelism: false,
		testTimeout: 30_000,
		hookTimeout: 60_000,
		expect: { requireAssertions: true }
	}
});
