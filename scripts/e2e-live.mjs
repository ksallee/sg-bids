#!/usr/bin/env node
// `pnpm e2e:live`: the whole product, live, in a real browser. Opt-in, never in CI. It writes to a
// real Flow PT project and a real Supabase database, then takes everything back.
//
//   E2E_SANDBOX_PROJECT="<project name>" pnpm e2e:live
//
// Needs in `.env.local`: the three `FPT_API_*` lines (the dev key: the app signs in with it under
// `vite dev`), `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `POSTGRES_URL_NON_POOLING`. And in the
// environment: `E2E_SANDBOX_PROJECT`, the one Flow PT project it may write to, by name, and
// `E2E_GROUP_A`, `E2E_GROUP_B`, two Group ids the vendors are linked to. The award migration must be
// applied to that database.
//
// It starts `vite dev` on 5182 (docs/development.md: a drive takes its own port), then:
//   1. builds a request from 12 Shots and 2 Assets of the sandbox (fixtures `zzsgbids_*` are
//      created when it has fewer, and deleted at the end), issues it;
//   2. invites two vendors linked to the two Groups; each opens its link in its own browser
//      context, prices every row (B in GBP), submits;
//   3. sets B's rate, builds a scenario with one split row, marks it chosen;
//   4. publishes from the publish page, and reads Flow PT back: the Bids, the Bid Lines, the
//      Shots' vendor groups;
//   5. undoes the award from the request page, and reads Flow PT back: no Bid or Bid Line of this
//      request, every Shot's and Asset's vendor groups as they were;
//   6. deletes the fixtures and the request's rows in Supabase, and checks they are gone.
// A failure part way still runs the clean-up. Screenshots go to `shots/e2e-live/`, light, and dark
// for the key screens. It prints ids and counts, never a token, a key or the site's address.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { chromium } from 'playwright';
import { loadEnv } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5182;
const APP = `http://localhost:${PORT}`;
const OUT = `${ROOT}shots/e2e-live`;
const env = { ...loadEnv('development', ROOT, ''), ...process.env };
for (const name of ['FPT_API_SITE_URL', 'FPT_API_SCRIPT_NAME', 'FPT_API_API_KEY', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'POSTGRES_URL_NON_POOLING', 'E2E_SANDBOX_PROJECT', 'E2E_GROUP_A', 'E2E_GROUP_B']) {
	if (!env[name]) {
		console.error(`${name} is not set. See the head of scripts/e2e-live.mjs.`);
		process.exit(1);
	}
}
mkdirSync(OUT, { recursive: true });
const GROUP_A = Number(env.E2E_GROUP_A);
const GROUP_B = Number(env.E2E_GROUP_B);
const STAMP = new Date().toISOString().slice(0, 16).replace(/\D/g, '');
const log = (...parts) => console.log(`[e2e] ${parts.join(' ')}`);
const evidence = [];
const prove = (line) => {
	evidence.push(line);
	log('PROOF', line);
};
const expect = (ok, what) => {
	if (!ok) throw new Error(`Expected: ${what}`);
	prove(what);
};

// Flow PT as the script key: the fixtures, the read-back and the clean-up. The app itself writes as
// the dev key from the browser, the way production writes from its session.
const SITE = env.FPT_API_SITE_URL.replace(/\/+$/, '');
let bearer = null;
async function fpt(method, path, body, type = 'application/json') {
	bearer ??= (
		await (
			await fetch(`${SITE}/api/v1/auth/access_token`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
				body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.FPT_API_SCRIPT_NAME, client_secret: env.FPT_API_API_KEY })
			})
		).json()
	).access_token;
	const res = await fetch(`${SITE}/api/v1${path}`, {
		method,
		headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json', ...(body ? { 'Content-Type': type } : {}) },
		body: body ? JSON.stringify(body) : undefined
	});
	const text = await res.text();
	const json = text ? JSON.parse(text) : null;
	if (!res.ok) throw new Error(`${method} ${path.split('?')[0]}: ${res.status} ${json?.errors?.[0]?.title ?? ''}`);
	return json;
}
// Filters in the array form, which a `_search` takes with its own content type (004).
const search = (type, filters, fields) => fpt('POST', `/entity/${type}/_search?page[size]=500`, { filters, fields }, 'application/vnd+shotgun.api3_array+json').then((r) => r.data);
const json = search;

const sql = postgres(env.POSTGRES_URL_NON_POOLING.replace(/[?&]sslmode=[^&]*/, ''), { ssl: { rejectUnauthorized: false }, max: 1, onnotice: () => {} });

const state = { projectId: 0, bidType: '', lineType: '', shots: [], assets: [], created: { Shot: [], Asset: [] }, before: {}, requestId: null };

async function preflight() {
	const projects = await fpt('GET', '/entity/projects?fields=name&page[size]=500');
	const sandbox = projects.data.find((p) => p.attributes.name === env.E2E_SANDBOX_PROJECT);
	if (!sandbox) throw new Error('No project by the E2E_SANDBOX_PROJECT name.');
	state.projectId = sandbox.id;
	const schema = await fpt('GET', '/schema');
	const slot = (display) => Object.entries(schema.data).find(([k, v]) => /^CustomEntity\d+$/.test(k) && String(v.name?.value).trim() === display)?.[0];
	state.bidType = slot('Bid');
	state.lineType = slot('Bid Line');
	if (!state.bidType || !state.lineType) throw new Error('Bid and Bid Line are not enabled.');
	const inProject = [['project', 'is', { type: 'Project', id: sandbox.id }]];
	for (const [type, want, key] of [
		['Shot', 12, 'shots'],
		['Asset', 2, 'assets']
	]) {
		let rows = (await search(type, inProject, ['code', 'sg_vendor_groups'])).filter((r) => typeof r.attributes.code === 'string' && r.attributes.code.trim() !== '');
		for (let i = rows.length; i < want; i++) {
			const made = await fpt('POST', `/entity/${type === 'Shot' ? 'shots' : 'assets'}`, { project: { type: 'Project', id: sandbox.id }, code: `zzsgbids_${type.toLowerCase()}_${STAMP}_${i}` });
			state.created[type].push(made.data.id);
			rows.push({ id: made.data.id, attributes: { code: made.data.attributes.code }, relationships: { sg_vendor_groups: { data: [] } } });
		}
		// The rows the vendors' Groups are not on yet, so every add shows.
		rows = rows.filter((r) => !(r.relationships.sg_vendor_groups?.data ?? []).some((g) => g.id === GROUP_A || g.id === GROUP_B)).slice(0, want);
		if (rows.length < want) throw new Error(`Too few ${type}s without the two Groups.`);
		state[key] = rows.map((r) => ({ id: r.id, code: r.attributes.code }));
		for (const r of rows) state.before[`${type}:${r.id}`] = (r.relationships.sg_vendor_groups?.data ?? []).map((g) => g.id).sort();
	}
	log(`sandbox ${state.projectId}, Bid ${state.bidType}, Bid Line ${state.lineType}, ${state.shots.length} Shots, ${state.assets.length} Assets, fixtures created: ${state.created.Shot.length + state.created.Asset.length}`);
}

async function startApp() {
	if (await fetch(APP).then((r) => r.ok).catch(() => false)) {
		log(`an app already answers on ${PORT}; using it`);
		return null;
	}
	const child = spawn('pnpm', ['exec', 'vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('vite dev did not start.')), 60_000);
		child.stdout.on('data', (d) => {
			if (String(d).includes('Local')) {
				clearTimeout(timer);
				resolve(child);
			}
		});
		child.on('exit', (code) => reject(new Error(`vite dev stopped: ${code}`)));
	});
}

let shotN = 0;
async function shoot(page, name, { dark = false, full = true } = {}) {
	const file = `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png`;
	await page.screenshot({ path: file, fullPage: full });
	if (dark) {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.evaluate(() => localStorage.setItem('sg-bids:mode', 'dark'));
		await page.reload();
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(800);
		await page.screenshot({ path: file.replace('.png', '-dark.png'), fullPage: full });
		await page.evaluate(() => localStorage.removeItem('sg-bids:mode'));
		await page.emulateMedia({ colorScheme: 'light' });
		await page.reload();
		await page.waitForLoadState('networkidle');
	}
	log('shot', file.slice(ROOT.length));
}

/** Open a picker, type, and take the option whose label is exactly `text`, never a near one. */
async function pickEntity(page, trigger, text) {
	await trigger.click();
	await page.keyboard.type(text, { delay: 20 });
	const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const option = page.getByRole('option').filter({ hasText: new RegExp(`(^|\\n)\\s*${escaped}\\s*($|\\n)`) }).first();
	await option.waitFor({ timeout: 20_000 });
	await option.click();
}

const next = (page) => page.getByRole('button', { name: /^Next/ }).click();

async function build(page) {
	await page.goto(`${APP}/bids/new`);
	await page.waitForLoadState('networkidle');
	await pickEntity(page, page.locator('[data-slot=project-picker] button').first(), env.E2E_SANDBOX_PROJECT);
	await page.waitForTimeout(1000);
	const picked = await page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('sg-bids:project:'))?.[1] ?? 'null');
	if (JSON.parse(picked)?.id !== state.projectId) throw new Error('The builder picked another project than the sandbox. Stopped before any write.');
	await shoot(page, 'builder-project');

	await next(page);
	await page.locator('#f-code').fill(`E2E-${STAMP}`);
	await page.locator('#f-title').fill('Live drive: publish and undo');
	const currency = page.locator('#f-baseCurrency');
	if ((await currency.innerText()).includes('Pick')) await pickEntity(page, currency, 'US Dollar');
	// The draft saves once it has a code; its id is in the address from then on.
	await page.waitForURL(/[?&]id=[0-9a-f-]{36}/, { timeout: 20_000 });
	state.requestId = new URL(page.url()).searchParams.get('id');
	await page.waitForTimeout(800);
	await shoot(page, 'builder-details');
	await next(page);
	await page.waitForTimeout(1000);
	await shoot(page, 'builder-fields', { full: false });

	for (const [step, rows] of [
		['Shots', state.shots],
		['Assets', state.assets]
	]) {
		await next(page);
		await page.waitForLoadState('networkidle');
		for (const row of rows) {
			const box = page.getByRole('searchbox', { name: 'Search the code' });
			await box.fill(row.code);
			await page.waitForTimeout(900);
			const cell = page.getByRole('row').filter({ hasText: row.code }).first();
			await cell.getByRole('checkbox').first().check();
		}
		await page.getByRole('searchbox', { name: 'Search the code' }).fill('');
		await page.waitForTimeout(800);
		await shoot(page, `builder-${step.toLowerCase()}`, { full: false });
	}

	await next(page);
	await page.waitForTimeout(800);
	await shoot(page, 'builder-items', { full: false });
	await next(page);
	await page.waitForTimeout(1500);
	await shoot(page, 'builder-review', { dark: true });
	await page.locator('[data-slot=issue]').click();
	await page.locator('[data-slot=issue-confirm]').getByRole('button', { name: 'Issue' }).click();
	await page.waitForURL(/\/bids\/[0-9a-f-]{36}$/, { timeout: 30_000 });
	await page.getByText('Issued', { exact: true }).first().waitFor();
	expect(page.url().endsWith(`/bids/${state.requestId}`), `the request is issued: ${state.requestId}`);
}

async function invite(page) {
	await page.goto(`${APP}/bids/${state.requestId}`);
	await page.waitForLoadState('networkidle');
	const links = {};
	for (const [name, group, groupCode] of [
		['Vendor A (drive)', GROUP_A, 'qa_ch_Vendor_A'],
		['Vendor B (drive)', GROUP_B, 'qa_ch_Vendor_B']
	]) {
		await page.locator('#v-name').fill(name);
		await page.locator('#v-email').fill(`${group}@e2e.sg-bids.test`);
		await pickEntity(page, page.getByRole('combobox', { name: 'No Group' }).first(), groupCode);
		await page.locator('#v-name').fill(name);
		await page.getByRole('button', { name: 'Invite' }).click();
		const link = page.locator('[data-slot=link-value]');
		await link.waitFor({ timeout: 20_000 });
		links[name] = await link.inputValue();
		await shoot(page, `invite-${group === GROUP_A ? 'a' : 'b'}`, { full: false });
		await page.locator('[data-slot=link-once]').getByRole('button', { name: 'Done' }).click();
	}
	expect(Object.keys(links).length === 2, 'two vendors invited, each linked to its Group');
	return links;
}

async function vendorBids(browser, links) {
	let k = 0;
	for (const [name, link] of Object.entries(links)) {
		const gbp = k++ === 1;
		const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		const page = await ctx.newPage();
		await page.goto(link.replace(/^https?:\/\/[^/]+/, APP));
		await page.waitForLoadState('networkidle');
		await page.locator('input[data-price]').first().waitFor({ timeout: 30_000 });
		if (gbp) await page.getByLabel('Your currency').selectOption('GBP');
		const prices = page.locator('input[data-price]');
		const n = await prices.count();
		for (let i = 0; i < n; i++) await prices.nth(i).fill(String((gbp ? 900 : 1000) + i * 125));
		await page.waitForTimeout(2000);
		await shoot(page, `vendor-${gbp ? 'b-gbp' : 'a-usd'}`, { dark: !gbp, full: false });
		// A submit waits for the draft to save.
		await page.locator('[data-slot=totals-rail] [data-save=saved]').filter({ visible: true }).first().waitFor({ timeout: 30_000 });
		await page.getByRole('button', { name: 'Review and submit' }).first().click();
		await page.getByRole('button', { name: 'Submit bid' }).click();
		await page.getByText('Submitted.').first().waitFor({ timeout: 20_000 });
		await shoot(page, `vendor-${gbp ? 'b' : 'a'}-submitted`, { full: false });
		await ctx.close();
		prove(`${name} priced ${n} rows${gbp ? ' in GBP' : ' in USD'} and submitted`);
	}
}

async function scenario(page) {
	await page.goto(`${APP}/bids/${state.requestId}/compare`);
	await page.waitForLoadState('networkidle');
	await page.locator('[data-slot=rate]').first().click();
	await page.getByPlaceholder('1.2712').fill('1.27');
	const day = page.locator('input[type=date]').first();
	if ((await day.inputValue()) === '') await day.fill(new Date().toISOString().slice(0, 10));
	await page.getByRole('button', { name: 'Set the rate' }).click();
	await page.waitForTimeout(2000);
	await shoot(page, 'compare-rate', { full: false });
	// A gets every Shot, B every Asset, then the first Shot is split 60/40.
	const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// The first pick starts the scenario; the bulk picks show once it exists.
	await page.getByRole('gridcell', { name: new RegExp(`^${esc(state.shots[0].code)}, Vendor A \\(drive\\):`) }).click();
	await page.getByText('Give everything to').waitFor({ timeout: 20_000 });
	await page.waitForTimeout(1500);
	await page.getByText('Give everything to').click();
	await page.getByRole('menuitem', { name: 'Vendor A (drive)' }).click();
	await page.getByText(`${state.shots.length + state.assets.length} of ${state.shots.length + state.assets.length} rows awarded`).waitFor({ timeout: 15_000 });
	await page.waitForTimeout(1500);
	for (const asset of state.assets) {
		await page.getByRole('gridcell', { name: new RegExp(`^${esc(asset.code)}, Vendor B \\(drive\\):`) }).click();
		await page.waitForTimeout(800);
	}
	await page.waitForTimeout(1500);
	await page.getByRole('button', { name: `Open ${state.shots[0].code}`, exact: true }).click();
	const dialog = page.locator('[data-slot=row-detail]');
	// The dialog fills its shares from the picks once open: type after it settles.
	await page.waitForTimeout(1500);
	for (const [vendor, share] of [
		['Vendor A (drive)', '60'],
		['Vendor B (drive)', '40']
	]) {
		const box = dialog.getByRole('textbox', { name: `${vendor} share, percent` });
		await box.click();
		await box.press('ControlOrMeta+a');
		await box.pressSequentially(share, { delay: 30 });
	}
	await dialog.getByText('100% of 100%').waitFor({ timeout: 10_000 });
	await shoot(page, 'compare-split', { full: false });
	await dialog.getByRole('button', { name: 'Apply the split' }).click();
	await page.waitForTimeout(500);
	if (await dialog.isVisible()) await page.keyboard.press('Escape');
	await page.waitForTimeout(2000);
	await page.getByRole('button', { name: 'Mark as the chosen scenario' }).click();
	await page.waitForTimeout(1500);
	await shoot(page, 'compare-scenario', { dark: true, full: false });
	prove('B rate 1.27 GBP to USD set; scenario with one split row marked chosen');
}

async function publish(page) {
	await page.locator('[data-slot=publish]').click();
	await page.waitForURL(/\/publish$/);
	const settled = async () => {
		await page.locator('[data-slot=gate-exposure]').getByText(/could not read|can read|cannot see/).first().waitFor({ timeout: 60_000 });
		await page.locator('[data-slot=write-ledger]').waitFor({ timeout: 60_000 });
		await page.waitForTimeout(1000);
	};
	await settled();
	// The dark shot reloads the page, so the choices on it are made after.
	await shoot(page, 'publish-preview', { dark: true });
	await settled();
	const anyway = page.locator('[data-slot=publish-anyway]');
	if (await anyway.count()) {
		await anyway.click();
		await page.locator('[data-slot=gate-exposure]').scrollIntoViewIfNeeded();
		await shoot(page, 'publish-anyway', { full: false });
		prove('the gate could not read the Vendor role with the dev key; publish anyway was checked and is recorded');
	}
	await page.locator('[data-slot=gate-rail] [data-slot=publish]').click();
	await page.locator('[data-slot=published], [data-slot=publish-failed]').first().waitFor({ timeout: 120_000 });
	await page.waitForTimeout(1000);
	await shoot(page, 'publish-done', { full: false });
	expect((await page.locator('[data-slot=published]').count()) === 1, 'the publish page says published and read back');
}

async function readFpt() {
	const prefix = `sgbids/${state.requestId}/`;
	const bids = await json(state.bidType, [['sg_sgbids_key', 'starts_with', prefix]], ['code', 'sg_vendor', 'sg_total', 'sg_currency', 'sg_total_base', 'sg_exchange_rate', 'sg_status_list', 'sg_sgbids_key']);
	const lines = await json(state.lineType, [['sg_sgbids_key', 'starts_with', prefix]], ['code', 'sg_item', 'sg_amount', 'sg_currency', 'sg_amount_base', 'sg_share_percent', 'sg_awarded_base', 'sg_awarded']);
	const groups = {};
	for (const [type, rows] of [
		['Shot', state.shots],
		['Asset', state.assets]
	]) {
		for (const r of await json(type, [['id', 'in', rows.map((x) => x.id)]], ['sg_vendor_groups'])) {
			groups[`${type}:${r.id}`] = (r.relationships.sg_vendor_groups?.data ?? []).map((g) => g.id).sort();
		}
	}
	return { bids, lines, groups };
}

async function verifyPublished() {
	const back = await readFpt();
	expect(back.bids.length === 2, `Flow PT holds 2 Bids for the request: ${back.bids.map((b) => `${b.id} ${b.attributes.code} ${b.attributes.sg_total} ${b.attributes.sg_currency} = ${b.attributes.sg_total_base} USD rate ${b.attributes.sg_exchange_rate ?? 'none'} status ${b.attributes.sg_status_list} vendor Group ${b.relationships.sg_vendor?.data?.id}`).join('; ')}`);
	const split = back.lines.filter((l) => l.attributes.sg_share_percent !== null && Number(l.attributes.sg_share_percent) !== 100);
	expect(back.lines.length === state.shots.length + state.assets.length + 1, `Flow PT holds ${back.lines.length} Bid Lines: one per awarded row and two for the split one`);
	expect(split.length === 2 && split.map((l) => Number(l.attributes.sg_share_percent)).sort().join('/') === '40/60', `the split row reads back as shares ${split.map((l) => `${l.attributes.sg_share_percent}% of ${l.attributes.sg_amount_base} USD = ${l.attributes.sg_awarded_base}`).join(' and ')}`);
	const gotA = state.shots.filter((s) => back.groups[`Shot:${s.id}`].includes(GROUP_A)).length;
	const gotB = state.assets.filter((a) => back.groups[`Asset:${a.id}`].includes(GROUP_B)).length;
	const firstShot = back.groups[`Shot:${state.shots[0].id}`];
	expect(gotA === state.shots.length && gotB === state.assets.length && firstShot.includes(GROUP_B), `vendor groups: Group ${GROUP_A} on all ${gotA} Shots, Group ${GROUP_B} on both Assets and on the split Shot`);
	for (const [k, before] of Object.entries(state.before)) {
		const kept = before.every((g) => back.groups[k].includes(g));
		if (!kept) throw new Error(`${k} lost a Group it had before.`);
	}
	prove('every Group already on a Shot or Asset is still there');
}

async function after(page) {
	await page.goto(`${APP}/bids/${state.requestId}`);
	await page.waitForLoadState('networkidle');
	await page.locator('[data-slot=award-panel]').waitFor({ timeout: 30_000 });
	await shoot(page, 'request-awarded', { dark: true, full: false });
	await page.goto(`${APP}/bids/${state.requestId}/compare`);
	await page.locator('[data-slot=award-panel]').waitFor({ timeout: 30_000 });
	await shoot(page, 'compare-awarded', { full: false });
	await page.goto(`${APP}/how`);
	await page.waitForLoadState('networkidle');
	await shoot(page, 'how-it-works', { dark: true });
}

async function undo(page) {
	await page.goto(`${APP}/bids/${state.requestId}`);
	await page.locator('[data-slot=award-panel] [data-slot=undo]').click();
	await shoot(page, 'undo-confirm', { full: false });
	await page.locator('[data-slot=undo-confirm]').click();
	await page.locator('[data-slot=award-panel]').waitFor({ state: 'detached', timeout: 120_000 });
	await shoot(page, 'request-after-undo', { full: false });
	const back = await readFpt();
	expect(back.bids.length === 0 && back.lines.length === 0, 'after the undo Flow PT holds no Bid and no Bid Line of the request');
	for (const [k, before] of Object.entries(state.before)) {
		if (JSON.stringify(back.groups[k]) !== JSON.stringify(before)) throw new Error(`${k} vendor groups are ${back.groups[k]}, were ${before}.`);
	}
	prove(`every Shot's and Asset's vendor groups are as before (${Object.keys(state.before).length} rows checked)`);
	const [row] = await sql`select status from public.bid_requests where id = ${state.requestId}`;
	const [{ n }] = await sql`select count(*)::int as n from public.awards where request_id = ${state.requestId}`;
	expect(row.status === 'issued' && n === 0, 'the request is issued again, with no award row');
}

async function cleanUp() {
	// Flow PT: anything of this request left behind, then the fixtures.
	if (state.requestId && state.bidType) {
		const back = await readFpt().catch(() => null);
		if (back && (back.bids.length || back.lines.length)) {
			await fpt('POST', '/entity/_batch', {
				requests: [...back.lines.map((l) => ({ request_type: 'delete', entity: state.lineType, record_id: l.id })), ...back.bids.map((b) => ({ request_type: 'delete', entity: state.bidType, record_id: b.id }))]
			});
			log(`clean-up deleted ${back.lines.length} Bid Lines and ${back.bids.length} Bids left behind`);
		}
		if (back) {
			for (const [k, before] of Object.entries(state.before)) {
				const extra = (back.groups[k] ?? []).filter((g) => !before.includes(g));
				if (!extra.length) continue;
				const [type, id] = k.split(':');
				await fpt('PUT', `/entity/${type === 'Shot' ? 'shots' : 'assets'}/${id}`, { sg_vendor_groups: { multi_entity_update_mode: 'remove', value: extra.map((g) => ({ type: 'Group', id: g })) } });
				log(`clean-up removed Groups ${extra} from ${k}`);
			}
		}
	}
	for (const [type, ids] of Object.entries(state.created)) {
		for (const id of ids) await fpt('DELETE', `/entity/${type === 'Shot' ? 'shots' : 'assets'}/${id}`);
	}
	if (state.created.Shot.length + state.created.Asset.length) prove(`fixtures deleted: ${state.created.Shot.length} Shots, ${state.created.Asset.length} Assets`);
	// Supabase: the request's rows, by its id. Frozen rows need the triggers off for one transaction.
	// Also any request an earlier drive left in the sandbox: its code is `E2E-<12 digits>`.
	const strays = state.projectId ? (await sql`select id from public.bid_requests where project_id = ${state.projectId} and code ~ '^E2E-[0-9]{12}$'`).map((r) => r.id) : [];
	for (const id of new Set([state.requestId, ...strays].filter(Boolean))) {
		await sql.begin(async (tx) => {
			await tx`set local session_replication_role = replica`;
			for (const table of ['bid_rates', 'awards', 'award_publications', 'award_scenario_items', 'award_scenarios', 'bid_lines', 'bids', 'invitations', 'request_items']) {
				await tx`delete from ${tx('public.' + table)} where request_id = ${id}`;
			}
			await tx`delete from public.bid_requests where id = ${id}`;
		});
		if (id !== state.requestId) log(`clean-up removed an earlier drive's request ${id}`);
	}
	if (state.requestId) {
		const id = state.requestId;
		const left = await sql`
			select (select count(*) from public.bid_requests where id = ${id}) + (select count(*) from public.request_items where request_id = ${id})
				+ (select count(*) from public.invitations where request_id = ${id}) + (select count(*) from public.bids where request_id = ${id})
				+ (select count(*) from public.bid_lines where request_id = ${id}) + (select count(*) from public.award_scenarios where request_id = ${id})
				+ (select count(*) from public.awards where request_id = ${id}) + (select count(*) from public.award_publications where request_id = ${id})
				+ (select count(*) from public.bid_rates where request_id = ${id}) as n`;
		expect(Number(left[0].n) === 0, 'no Supabase row of the drive is left');
	}
}

let app = null;
let browser = null;
let failed = null;
try {
	await preflight();
	app = await startApp();
	browser = await chromium.launch();
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const page = await ctx.newPage();
	page.on('pageerror', (e) => log('page error:', e.message.slice(0, 200)));
	// `E2E_STOP_AFTER=<stage>` stops early, then cleans up: for working on the drive itself.
	const stop = env.E2E_STOP_AFTER;
	await build(page);
	if (stop === 'build') throw new Error('stopped after build');
	const links = await invite(page);
	if (stop === 'invite') throw new Error('stopped after invite');
	await vendorBids(browser, links);
	if (stop === 'bids') throw new Error('stopped after bids');
	await scenario(page);
	if (stop === 'scenario') throw new Error('stopped after scenario');
	await publish(page);
	await verifyPublished();
	await after(page);
	await undo(page);
} catch (error) {
	failed = error;
	await browser
		?.contexts()[0]
		?.pages()[0]
		?.screenshot({ path: `${OUT}/failure.png` })
		.catch(() => {});
	console.error('[e2e] FAILED:', error.message);
} finally {
	try {
		await cleanUp();
	} catch (error) {
		console.error('[e2e] clean-up failed:', error.message);
		failed ??= error;
	}
	await browser?.close();
	app?.kill();
	await sql.end();
}
console.log('\n[e2e] evidence:\n' + evidence.map((e) => `- ${e}`).join('\n'));
process.exit(failed ? 1 : 0);
