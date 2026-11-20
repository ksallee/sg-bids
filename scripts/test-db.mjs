#!/usr/bin/env node
// `pnpm test:db`: start a throwaway Postgres and PostgREST in Docker, run the database tests
// against them, and remove both, pass or fail.
//
// The containers are `sg-bids-test-<run>` and `sg-bids-test-<run>-rest` on the network
// `sg-bids-test-<run>-net`, each on a free port on 127.0.0.1. `<run>` is `SG_BIDS_TEST_RUN` when set
// (CI sets the workflow run), else random, so two runs on one machine never share a container.
// Nothing else on the machine is touched: every docker command below names one of these three.
// Passwords and the JWT secret are random per run.

import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RUN = process.env.SG_BIDS_TEST_RUN || randomBytes(4).toString('hex');
if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(RUN)) {
	console.error('SG_BIDS_TEST_RUN is lower-case letters, digits and dashes, 40 at most.');
	process.exit(1);
}
const PG = `sg-bids-test-${RUN}`;
const REST = `${PG}-rest`;
const NET = `${PG}-net`;
const PG_IMAGE = 'postgres:17';
const REST_IMAGE = 'postgrest/postgrest:v12.2.12';
const root = fileURLToPath(new URL('..', import.meta.url));

const docker = (args, input) => execFileSync('docker', args, { encoding: 'utf8', input, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] }).trim();
const quiet = (args) => spawnSync('docker', args, { stdio: 'ignore' });

function cleanup() {
	quiet(['rm', '-f', REST]);
	quiet(['rm', '-f', PG]);
	quiet(['network', 'rm', NET]);
}

function hostPort(container, port) {
	const line = docker(['port', container, `${port}/tcp`]).split('\n').find((l) => l.startsWith('127.0.0.1:'));
	if (!line) throw new Error(`${container} publishes no port for ${port}.`);
	return line;
}

async function until(what, check, seconds = 60) {
	const deadline = Date.now() + seconds * 1000;
	for (;;) {
		if (await check()) return;
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
		await new Promise((done) => setTimeout(done, 500));
	}
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
	process.on(signal, () => {
		cleanup();
		process.exit(code);
	});
}

cleanup();
let status = 1;
try {
	const pgPassword = randomBytes(16).toString('hex');
	const authPassword = randomBytes(16).toString('hex');
	const jwtSecret = randomBytes(32).toString('hex');

	docker(['network', 'create', NET]);
	docker(['run', '-d', '--name', PG, '--network', NET, '-e', `POSTGRES_PASSWORD=${pgPassword}`, '-p', '127.0.0.1::5432', PG_IMAGE]);
	// The image's init runs a server on a socket only, then restarts it on TCP: wait for TCP.
	await until('Postgres', () => quiet(['exec', PG, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-c', 'select 1']).status === 0);
	docker(
		['exec', '-i', PG, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-v', `auth_password=${authPassword}`, '-q', '-f', '-'],
		readFileSync(`${root}tests/db/supabase-roles.sql`, 'utf8')
	);

	docker([
		'run',
		'-d',
		'--name',
		REST,
		'--network',
		NET,
		'-e',
		`PGRST_DB_URI=postgres://authenticator:${authPassword}@${PG}:5432/postgres`,
		'-e',
		'PGRST_DB_SCHEMAS=public',
		'-e',
		'PGRST_DB_ANON_ROLE=anon',
		'-e',
		`PGRST_JWT_SECRET=${jwtSecret}`,
		'-p',
		'127.0.0.1::3000',
		REST_IMAGE
	]);

	const env = {
		...process.env,
		TEST_DATABASE_URL: `postgres://postgres:${pgPassword}@${hostPort(PG, 5432)}/postgres`,
		TEST_REST_URL: `http://${hostPort(REST, 3000)}`,
		TEST_JWT_SECRET: jwtSecret
	};
	const run = spawnSync('pnpm', ['exec', 'vitest', '--run', '--config', 'vitest.db.config.ts', ...process.argv.slice(2)], {
		cwd: root,
		env,
		stdio: 'inherit'
	});
	status = run.status ?? 1;
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
} finally {
	cleanup();
}
process.exit(status);
