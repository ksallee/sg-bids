#!/usr/bin/env node
// `pnpm seed:dev`: one issued bid request with 40 shots and 6 assets, two vendors invited, in a dev
// tenant of its own, written through the server's data layer (`src/lib/server/store.ts`) to the
// Supabase project in `.env.local`. Prints the two vendor links for `pnpm dev`.
//
//   pnpm seed:dev              remove the last seed, then seed again
//   pnpm seed:dev --clean      remove the seed and stop
//   pnpm seed:dev --port 5182  links for another dev port
//   pnpm seed:dev --shots 400  a bigger request, to try the form at size
//
// The dev tenant is the site host `dev-seed.sg-bids.local`, project 1. No Flow PT site has that
// host, so no production sign-in ever reaches it. An issued request and a submitted bid are frozen
// by triggers, so `--clean` deletes over the direct Postgres connection
// (`POSTGRES_URL_NON_POOLING`) with the triggers off for that one transaction, and only rows of
// the dev tenant. Nothing else is touched. Tokens are printed once and never written anywhere.

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { createServer, loadEnv } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TENANT = { kind: 'production', siteHost: 'dev-seed.sg-bids.local', projectId: 1 };
const TABLES = ['bid_rates', 'awards', 'award_publications', 'award_scenario_items', 'award_scenarios', 'bid_lines', 'bids', 'invitations', 'request_items', 'request_packages', 'production_bid_items', 'production_bids', 'bid_requests'];

const argv = process.argv.slice(2);
const clean = argv.includes('--clean');
const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const port = Number(flag('--port')) || 5181;
const shotCount = Math.max(1, Number(flag('--shots')) || 40);

const env = loadEnv('development', ROOT, '');
for (const name of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'POSTGRES_URL_NON_POOLING']) {
	if (!env[name]) {
		console.error(`${name} is not set in .env.local.`);
		process.exit(1);
	}
}

async function removeSeed() {
	const sql = postgres(env.POSTGRES_URL_NON_POOLING, { ssl: 'require', max: 1, onnotice: () => {} });
	try {
		const counts = await sql.begin(async (tx) => {
			await tx`set local session_replication_role = replica`;
			const removed = {};
			for (const table of TABLES) {
				const rows = await tx`delete from ${tx('public.' + table)} where site_host = ${TENANT.siteHost} and project_id = ${TENANT.projectId} returning id`;
				removed[table] = rows.length;
			}
			return removed;
		});
		const total = Object.values(counts).reduce((a, b) => a + b, 0);
		console.log(total === 0 ? 'Nothing to remove.' : `Removed ${Object.entries(counts).filter(([, n]) => n > 0).map(([t, n]) => `${n} ${t}`).join(', ')}.`);
	} finally {
		await sql.end();
	}
}

const SEQUENCES = [
	{ code: 'RTF', name: 'Rooftop chase', type: 'CG' },
	{ code: 'HBR', name: 'Harbour at night', type: 'Comp' },
	{ code: 'STM', name: 'The storm', type: 'FX' },
	{ code: 'END', name: 'Ending', type: 'Comp' }
];
const WORK = [
	'Sky replacement and grade match.',
	'Wire removal on the stunt double.',
	'Full CG extension of the skyline.',
	'Rain and wind FX, interaction with the cloth.',
	'Screen inserts on two monitors.',
	'Crowd multiplication from three passes.',
	'Paint out the rig and the tracking markers.',
	'Water sim at the hull, with spray.',
	'Face replacement for the double.',
	'Muzzle flashes and shell casings.'
];
const DIFFICULTY = ['Easy', 'Medium', 'Hard'];

function items() {
	const shots = [];
	let n = 0;
	for (const [index, sequence] of SEQUENCES.entries()) {
		const count = Math.floor(shotCount / SEQUENCES.length) + (index < shotCount % SEQUENCES.length ? 1 : 0);
		for (let i = 1; i <= count; i++) {
			const code = `${sequence.code}_${String(i * 10).padStart(4, '0')}`;
			shots.push({
				id: code.toLowerCase(),
				code,
				description: WORK[n % WORK.length],
				sequence: sequence.name,
				type: sequence.type,
				difficulty: DIFFICULTY[(n * 7) % 3],
				frames: 48 + ((n * 37) % 160),
				omitted: false,
				assetIds: n % 4 === 0 ? ['hero_suit'] : []
			});
			n++;
		}
	}
	const assets = [
		{ id: 'hero_suit', name: 'Hero suit', type: 'Character', difficulty: 'Hard', description: 'Digital double of the hero in the flight suit.' },
		{ id: 'harbour_crane', name: 'Harbour crane', type: 'Prop', difficulty: 'Medium' },
		{ id: 'city_skyline', name: 'City skyline', type: 'Environment', difficulty: 'Hard', description: 'Night skyline, 360 degrees, lights on.' },
		{ id: 'storm_clouds', name: 'Storm clouds', type: 'FX', difficulty: 'Medium' },
		{ id: 'cargo_ship', name: 'Cargo ship', type: 'Vehicle', difficulty: 'Medium' },
		{ id: 'rooftop_set', name: 'Rooftop set', type: 'Environment', difficulty: 'Easy', description: 'Set extension above the practical roof.' }
	];
	return { shots, assets };
}

async function seed() {
	const vite = await createServer({
		root: ROOT,
		configFile: false,
		logLevel: 'error',
		appType: 'custom',
		server: { middlewareMode: true, hmr: false, ws: false },
		resolve: { alias: { $lib: `${ROOT}src/lib` } },
		// Its own cache: the dev server's under node_modules/.vite stays untouched.
		cacheDir: join(tmpdir(), 'sg-bids-seed-vite'),
		optimizeDeps: { noDiscovery: true, include: [] }
	});
	try {
		const { createStore } = await vite.ssrLoadModule('/src/lib/server/store.ts');
		const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
		const store = createStore(db);
		const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
		const request = await store.createDraftRequest(TENANT, {
			code: 'DEV-001',
			header: {
				project: 'Night Harbour',
				studio: 'Example Pictures',
				director: 'A. Director',
				clientSupervisor: 'S. Supervisor',
				clientProducer: 'P. Producer',
				cutVersion: 'Cut 3',
				round: 1,
				dueDate: due,
				baseCurrency: 'USD',
				turnoverWeek: 'Week 2',
				deliveryDate: '2027-04-30',
				deliveryFormat: 'EXR, ACEScg, 4K',
				materialLink: 'https://example.com/bid-material',
				assumptions: ['Plates turn over in week 2.', 'Delivery at 4K, ACEScg EXR.', 'Two rounds of client notes per shot.']
			},
			items: items()
		});
		const first = await store.inviteVendor(TENANT, request.id, { name: 'Northlight Studio', email: 'bids@northlight.example', ndaExecuted: true });
		const second = await store.inviteVendor(TENANT, request.id, { name: 'Harbour Pixel', email: 'quotes@harbourpixel.example', ndaExecuted: true });
		await store.issueRequest(TENANT, request.id);
		console.log(`Seeded DEV-001: ${request.shots.length} shots, ${request.assets.length} assets, issued.`);
		console.log(`Vendor 1: http://localhost:${port}/v/${first.token}`);
		console.log(`Vendor 2: http://localhost:${port}/v/${second.token}`);
	} finally {
		await vite.close();
	}
}

await removeSeed();
if (!clean) await seed();
