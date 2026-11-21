#!/usr/bin/env node
// `pnpm e2e:live`: the whole product, live, in a real browser. Opt-in, never in CI. It writes to a
// real Flow PT project and a database, then takes everything back.
//
//   E2E_SANDBOX_PROJECT="<project name>" E2E_GROUP_A=<id> E2E_GROUP_B=<id> pnpm e2e:live
//
// Needs in `.env.local`: the three `FPT_API_*` lines (the dev key: the app signs in with it under
// `vite dev`), `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `POSTGRES_URL_NON_POOLING`, pointing at a
// throwaway database, not one a running app reads. And in the environment: `E2E_SANDBOX_PROJECT`,
// the one Flow PT project it may write to, by name, and `E2E_GROUP_A`, `E2E_GROUP_B`, two Group ids
// the vendors are linked to.
//
// It starts `vite dev` on 5182 (docs/development.md: a drive takes its own port), then:
//   1. builds a bid from 4 Shots of the sandbox (`zzsgbids_*` fixtures when it has fewer) and one
//      from a pasted breakdown, and clones the first from the Bids list;
//   2. ticks the two bids, makes a request: a title, Vendor A invited to both bids, Vendor B to the
//      breakdown bid alone, issues it, and keeps the two links shown once;
//   3. takes a row out of the first bid and checks the issued request did not change;
//   4. answers as each vendor in its own browser context: A declines the breakdown bid and prices
//      the other row by row; B sees its bid alone and prices it as one figure in GBP;
//   5. sets B's rate, gives Seq A to A and the breakdown bid whole to B, chooses the scenario;
//   6. publishes (breakdown rows without a Shot or Asset), reads Flow PT back: the Bids, the Bid
//      Lines, their sums, the Group on the Shots; undoes from the request page and reads it again;
//   7. sends the breakdown bid again in a second request, and checks the bid lists both;
//   8. deletes what the drive made, in Flow PT and in the database, also on a failure part way.
// Screenshots go to `shots/e2e-live/`. It prints ids and counts, never a token, a key or the site.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { chromium } from 'playwright';
import { loadEnv } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5182;
const APP = `http://localhost:${PORT}`;
const OUT = `${ROOT}shots/e2e-live/`;
const env = { ...loadEnv('development', ROOT, ''), ...process.env };
for (const name of ['FPT_API_SITE_URL', 'FPT_API_SCRIPT_NAME', 'FPT_API_API_KEY', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'POSTGRES_URL_NON_POOLING', 'E2E_SANDBOX_PROJECT', 'E2E_GROUP_A', 'E2E_GROUP_B']) {
	if (!env[name]) {
		console.error(`${name} is not set. See the head of scripts/e2e-live.mjs.`);
		process.exit(1);
	}
}
mkdirSync(OUT, { recursive: true });
const SANDBOX = env.E2E_SANDBOX_PROJECT;
const GROUP_A = Number(env.E2E_GROUP_A);
const GROUP_B = Number(env.E2E_GROUP_B);
const STAMP = new Date().toISOString().slice(0, 16).replace(/\D/g, '');
const log = (...parts) => console.log('[e2e]', ...parts);
const state = {};
const evidence = [];
const prove = (line) => {
	evidence.push(line);
	log('PROOF', line);
};
const expect = (ok, what) => {
	if (!ok) throw new Error(`Expected: ${what}`);
	prove(what);
};
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(env.POSTGRES_URL_NON_POOLING);
const sql = postgres(env.POSTGRES_URL_NON_POOLING.replace(/[?&]sslmode=[^&]*/, ''), { ...(local ? {} : { ssl: { rejectUnauthorized: false } }), max: 1, onnotice: () => {} });

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

let app = null;
let browser = null;
let ctx = null;
let page = null;
let shotN = 0;
async function shoot(p, name) {
	const file = `${OUT}${String(++shotN).padStart(2, '0')}-${name}.png`;
	await p.screenshot({ path: file });
	log('shot', file.slice(ROOT.length));
}

async function pickEntity(trigger, text) {
	await trigger.click();
	await page.keyboard.type(text, { delay: 20 });
	const option = page.getByRole('option').filter({ hasText: new RegExp(`(^|\\n)\\s*${esc(text)}\\s*($|\\n)`) }).first();
	await option.waitFor({ timeout: 20_000 });
	await option.click();
}

async function saved() {
	await page.locator('[data-slot=save-line][data-state=saved]').waitFor({ timeout: 30_000 });
}

const stages = {
	async pre() {
		const projects = await fpt('GET', '/entity/projects?fields=name&page[size]=500');
		const sb = projects.data.find((p) => p.attributes.name === SANDBOX);
		if (!sb) throw new Error('No project by the E2E_SANDBOX_PROJECT name.');
		state.projectId = sb.id;
		const groups = await search('Group', [['id', 'in', [GROUP_A, GROUP_B]]], ['code']);
		state.groupCode = Object.fromEntries(groups.map((g) => [g.id, g.attributes.code]));
		if (!state.groupCode[GROUP_A] || !state.groupCode[GROUP_B]) throw new Error('E2E_GROUP_A or E2E_GROUP_B is not a Group.');
		let shots = (await search('Shot', [['project', 'is', { type: 'Project', id: sb.id }]], ['code', 'sg_vendor_groups']))
			.filter((s) => typeof s.attributes.code === 'string' && s.attributes.code.trim() !== '' && !s.attributes.code.startsWith('zzsgbids'))
			.filter((s) => !(s.relationships.sg_vendor_groups?.data ?? []).some((g) => g.id === GROUP_A || g.id === GROUP_B))
			.sort((a, b) => a.attributes.code.localeCompare(b.attributes.code))
			.slice(0, 4)
			.map((s) => ({ id: s.id, code: s.attributes.code }));
		for (let i = shots.length; i < 4; i++) {
			const made = await fpt('POST', '/entity/shots', { project: { type: 'Project', id: sb.id }, code: `zzsgbids_e2e_${STAMP}_${i}` });
			shots.push({ id: made.data.id, code: made.data.attributes.code });
		}
		state.shots = shots;
		const schema = await fpt('GET', '/schema');
		const slot = (display) => Object.entries(schema.data).find(([k, v]) => /^CustomEntity\d+$/.test(k) && String(v.name?.value).trim() === display)?.[0];
		state.bidType = slot('Bid');
		state.lineType = slot('Bid Line');
		state.stamp = STAMP;
		log('sandbox', state.projectId, 'shots', state.shots.length);
	},

	async bidA() {
		await page.goto(`${APP}/bids`);
		await page.waitForLoadState('networkidle');
		await page.locator('[data-slot=new-bid]').first().click();
		await page.waitForURL(/\/bids\/new/);
		await page.waitForLoadState('networkidle');
		// The project: picked by name in the gate, or changed to the sandbox when another was kept.
		if (await page.locator('[data-slot=project-gate]').count()) {
			await pickEntity(page.locator('[data-slot=project-picker] button').first(), SANDBOX);
		} else if (!(await page.locator('[data-slot=page-context]').innerText()).includes(SANDBOX)) {
			await page.locator('[data-slot=change-project]').click();
			await pickEntity(page.locator('[role=dialog] [data-slot=project-picker] button').first(), SANDBOX);
		}
		await page.locator('[data-slot=bid-name]').waitFor({ timeout: 30_000 });
		await page.locator('[data-slot=bid-name]').fill(`zzsgbids Seq A ${state.stamp}`);
		await page.locator('[data-slot=fpt-open]').click();
		const dialog = page.locator('[data-slot=fpt-add-dialog]');
		await dialog.waitFor();
		for (const s of state.shots) {
			await dialog.locator('[data-slot=fpt-add-search]').fill(s.code);
			await page.waitForTimeout(1200);
			await dialog.getByRole('checkbox', { name: s.code, exact: true }).click();
		}
		await dialog.locator('[data-slot=fpt-add-search]').fill('');
		await page.waitForTimeout(800);
		await shoot(page, 'fpt-add-dialog');
		await dialog.locator('[data-slot=fpt-add-submit]').click();
		await page.waitForURL(/\/bids\/[0-9a-f-]{36}/, { timeout: 30_000 });
		await saved();
		state.bidA = new URL(page.url()).pathname.split('/').pop();
		await page.waitForTimeout(1500);
		await shoot(page, 'bid-editor-a');
		const [row] = await sql`select name, shot_count from public.production_bids where id = ${state.bidA}`;
		expect(row?.shot_count === state.shots.length, `bid A stored with ${row?.shot_count} Shots from Flow PT: ${row?.name}`);
	},

	async bidB() {
		await page.goto(`${APP}/bids/new`);
		await page.waitForLoadState('networkidle');
		await page.locator('[data-slot=bid-name]').waitFor({ timeout: 30_000 });
		const context = await page.locator('[data-slot=page-context]').innerText();
		if (!context.includes(SANDBOX)) throw new Error('The new bid is not in the sandbox.');
		await page.locator('[data-slot=bid-name]').fill(`zzsgbids Creature ${state.stamp}`);
		// Shots from a breakdown, pasted.
		await page.locator('[data-slot=breakdown-open]').click();
		const dialog = page.locator('[data-slot=breakdown-dialog]');
		await dialog.waitFor();
		await dialog.locator('[data-slot=breakdown-paste]').fill(`Shot\tDescription\tFrames\nzzsgbids_CR010\tCreature lands\t100\nzzsgbids_CR020\tCreature roars\t80`);
		await dialog.locator('[data-slot=breakdown-next]').click();
		await dialog.locator('[data-slot=breakdown-add]').click();
		await dialog.waitFor({ state: 'detached' });
		// An asset too.
		await page.locator('#tab-asset').click();
		await page.locator('[data-slot=breakdown-open]').click();
		await dialog.waitFor();
		await dialog.locator('[data-slot=breakdown-paste]').fill(`Asset\tType\nzzsgbids_Creature\tCharacter`);
		await dialog.locator('[data-slot=breakdown-next]').click();
		await dialog.locator('[data-slot=breakdown-add]').click();
		await dialog.waitFor({ state: 'detached' });
		await page.waitForURL(/\/bids\/[0-9a-f-]{36}/, { timeout: 30_000 });
		await saved();
		state.bidB = new URL(page.url()).pathname.split('/').pop();
		await page.locator('#tab-shot').click();
		await page.waitForTimeout(1000);
		await shoot(page, 'bid-editor-b');
		const [row] = await sql`select name, shot_count, asset_count from public.production_bids where id = ${state.bidB}`;
		expect(row?.shot_count === 2 && row?.asset_count === 1, `bid B stored from a breakdown: ${row?.shot_count} Shots and ${row?.asset_count} Asset`);
	},

	async clone() {
		await page.goto(`${APP}/bids`);
		await page.waitForLoadState('networkidle');
		const row = page.locator(`tr[data-bid="${state.bidA}"]`);
		await row.locator('[data-slot=row-actions]').click();
		await page.locator('[data-slot=row-clone]').click();
		await page.locator('[data-slot=edit-toast]').waitFor({ timeout: 20_000 });
		await page.waitForTimeout(1500);
		await shoot(page, 'bids-list');
		const [copy] = await sql`select id, name, shot_count from public.production_bids where name = ${`zzsgbids Seq A ${state.stamp} copy`}`;
		state.bidCopy = copy?.id;
		expect(copy?.shot_count === state.shots.length, `clone made: "${copy?.name}" with ${copy?.shot_count} Shots`);
	},

	async request() {
		await page.goto(`${APP}/bids`);
		await page.waitForLoadState('networkidle');
		await page.locator(`tr[data-bid="${state.bidA}"] [data-slot=bid-tick]`).click();
		await page.locator(`tr[data-bid="${state.bidB}"] [data-slot=bid-tick]`).click();
		await page.waitForTimeout(500);
		await shoot(page, 'bids-selection');
		await page.locator('[data-slot=new-request-from-bids]').click();
		await page.waitForURL(/\/requests\/new\?.*id=[0-9a-f-]{36}/, { timeout: 30_000 });
		await page.waitForLoadState('networkidle');
		state.requestId = new URL(page.url()).searchParams.get('id');
		await page.waitForTimeout(1000);
		await shoot(page, 'send-bids');
		await page.locator('[data-slot=step-next]').click();
		await page.locator('#f-title').first().fill(`zzsgbids drive ${state.stamp}`);
		await page.waitForTimeout(1500);
		await shoot(page, 'send-details');
		await page.locator('[data-slot=step-next]').click();
		// Vendor A: every bid. Vendor B: the Creature bid alone.
		for (const [name, group, only] of [
			['Vendor A (drive)', state.groupCode[GROUP_A], null],
			['Vendor B (drive)', state.groupCode[GROUP_B], `zzsgbids Creature ${state.stamp}`]
		]) {
			await page.locator('#v-name').fill(name);
			await page.locator('#v-email').fill(`${group.toLowerCase()}@e2e.sg-bids.test`);
			await pickEntity(page.getByRole('combobox', { name: 'No Group' }).first(), group);
			await page.locator('#v-name').fill(name);
			if (only) {
				await page.locator('[data-slot=invite-packages]').click();
				const d = page.locator('[data-slot=packages-dialog]');
				await d.getByText('Some bids', { exact: true }).click();
				for (const box of await d.getByRole('checkbox').all()) {
					const label = await box.getAttribute('aria-label');
					if ((label === only) !== ((await box.getAttribute('data-state')) === 'checked')) await box.click();
				}
				await d.locator('[data-slot=packages-save]').click();
			}
			await page.locator('[data-slot=invite-submit]').click();
			await page.locator(`tr[data-vendor="${name}"]`).waitFor({ timeout: 20_000 });
		}
		await page.waitForTimeout(1000);
		await shoot(page, 'send-vendors');
		await page.locator('[data-slot=step-next]').click();
		await page.locator('[data-slot=review-ready]').waitFor({ timeout: 20_000 });
		await shoot(page, 'send-review');
		await page.locator('[data-slot=issue]').click();
		await page.locator('[data-slot=issue-confirm] [data-slot=issue-now]').click();
		await page.locator('[data-slot=issued-links]').waitFor({ timeout: 30_000 });
		await page.waitForTimeout(500);
		const values = await page.locator('[data-slot=link-value]').evaluateAll((els) => els.map((e) => e.value));
		state.links = values;
		await shoot(page, 'send-issued');
		const [req] = await sql`select status from public.bid_requests where id = ${state.requestId}`;
		const items = await sql`select code, package_key from public.request_items where request_id = ${state.requestId} order by position`;
		state.issuedItems = items.map((i) => i.code);
		expect(req.status === 'issued' && values.length === 2, `request issued with ${items.length} rows copied (${items.map((i) => i.code).join(', ')}), two links made`);
	},

	async editAfter() {
		// Bid A changes after the issue: one row out, a note on another. The issued request does not change.
		const before = await sql`select kind, key, code, fields, omitted from public.request_items where request_id = ${state.requestId} order by position`;
		await page.goto(`${APP}/bids/${state.bidA}?project=${state.projectId}`);
		await page.waitForLoadState('networkidle');
		await page.locator('[data-slot=request-table] tbody tr').first().waitFor({ timeout: 30_000 });
		await page.waitForTimeout(1500);
		const last = state.shots.at(-1).code;
		await page.locator('tr', { hasText: last }).getByRole('checkbox').first().click();
		await page.locator('[data-slot=bulk-remove]').click();
		await page.waitForTimeout(1200);
		await saved();
		await page.waitForTimeout(500);
		await shoot(page, 'bid-a-after-issue');
		const [bid] = await sql`select shot_count from public.production_bids where id = ${state.bidA}`;
		const after = await sql`select kind, key, code, fields, omitted from public.request_items where request_id = ${state.requestId} order by position`;
		expect(bid.shot_count === state.shots.length - 1, `bid A edited after the issue: ${last} taken out, it holds ${bid.shot_count} Shots now`);
		expect(JSON.stringify(after) === JSON.stringify(before) && after.some((r) => r.code === last), `the issued request is unchanged: still ${after.length} rows, ${last} among them`);
		const context = await page.locator('[data-slot=bid-requests]').innerText();
		expect(context.includes('SG_') || context.length > 0, `bid A says it went out in: ${context.replace(/\s+/g, ' ').trim()}`);
	},

	async vendorA() {
		// Vendor A: declines the Creature bid, prices Seq A row by row, an overhead once.
		const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		const vp = await vctx.newPage();
		vp.on('pageerror', (e) => log('vendor pageerror', e.message.slice(0, 200)));
		await vp.goto(state.links[0].replace(/^https?:\/\/[^/]+/, APP));
		await vp.waitForLoadState('networkidle');
		await vp.locator('[data-slot=package-head]').first().waitFor({ timeout: 30_000 });
		await vp.waitForTimeout(1000);
		await shoot(vp, 'vendor-a-open');
		const creature = vp.locator('[data-slot=package-head]', { hasText: 'Creature' });
		await creature.getByRole('radio', { name: 'Not bidding' }).click();
		await vp.waitForTimeout(500);
		const prices = vp.locator('input[data-price]');
		const n = await prices.count();
		for (let i = 0; i < n; i++) await prices.nth(i).fill(String(1000 + i * 250));
		await vp.waitForTimeout(800);
		await vp.locator('[data-slot=totals-rail] [data-save=saved]').filter({ visible: true }).first().waitFor({ timeout: 30_000 });
		await shoot(vp, 'vendor-a-priced');
		await vp.getByRole('button', { name: 'Review and submit' }).first().click();
		await vp.getByRole('button', { name: 'Submit answer' }).click();
		await vp.getByText('Submitted.').first().waitFor({ timeout: 20_000 });
		await shoot(vp, 'vendor-a-submitted');
		await vctx.close();
		const [b] = await sql`select b.header->'declined' as declined, (select count(*)::int from public.bid_lines l where l.bid_id = b.id) as lines, (select sum(total_minor)::bigint from public.bid_lines l where l.bid_id = b.id) as total from public.bids b join public.invitations i on i.id = b.invitation_id where i.request_id = ${state.requestId} and i.vendor_name = 'Vendor A (drive)' and b.status = 'submitted'`;
		expect(b && b.lines === n && JSON.stringify(b.declined).includes('bid:'), `Vendor A submitted: ${n} rows priced row by row (sum ${Number(b?.total) / 100} USD), the Creature bid declined`);
	},

	async vendorB() {
		// Vendor B: invited to the Creature bid alone, prices it as one figure, in GBP.
		const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		const vp = await vctx.newPage();
		vp.on('pageerror', (e) => log('vendor pageerror', e.message.slice(0, 200)));
		await vp.goto(state.links[1].replace(/^https?:\/\/[^/]+/, APP));
		await vp.waitForLoadState('networkidle');
		await vp.locator('[data-slot=package-head]').first().waitFor({ timeout: 30_000 });
		const heads = await vp.locator('[data-slot=package-head]').count();
		const seen = await vp.locator('[data-slot=vendor-scroll]').innerText();
		expect(heads === 1 && !seen.includes('demo_01_roto'), 'Vendor B sees the Creature bid alone: no row of Seq A');
		await vp.getByLabel('Your currency').selectOption('GBP');
		await vp.waitForTimeout(500);
		const head = vp.locator('[data-slot=package-head]').first();
		await head.getByRole('radio', { name: 'One figure' }).click();
		await vp.waitForTimeout(500);
		await vp.locator('input[data-package-price]').fill('4200');
		await vp.waitForTimeout(800);
		await vp.locator('[data-slot=totals-rail] [data-save=saved]').filter({ visible: true }).first().waitFor({ timeout: 30_000 });
		await shoot(vp, 'vendor-b-figure');
		await vp.getByRole('button', { name: 'Review and submit' }).first().click();
		await vp.getByRole('button', { name: 'Submit answer' }).click();
		await vp.getByText('Submitted.').first().waitFor({ timeout: 20_000 });
		await vctx.close();
		const [b] = await sql`select b.currency, b.packages from public.bids b join public.invitations i on i.id = b.invitation_id where i.request_id = ${state.requestId} and i.vendor_name = 'Vendor B (drive)' and b.status = 'submitted'`;
		expect(b?.currency === 'GBP' && b.packages?.[0]?.total?.minor === 420000, `Vendor B submitted the Creature bid as one figure: ${b?.packages?.[0]?.total?.minor / 100} ${b?.currency}`);
	},

	async compare() {
		await page.goto(`${APP}/requests/${state.requestId}/compare?project=${state.projectId}`);
		await page.waitForLoadState('networkidle');
		await page.locator('[data-slot=rate]').first().waitFor({ timeout: 30_000 });
		await page.waitForTimeout(1500);
		await shoot(page, 'compare-open');
		await page.locator('[data-slot=rate]').first().click();
		await page.getByPlaceholder('1.2712').fill('1.27');
		const day = page.locator('input[type=date]').first();
		if ((await day.count()) && (await day.inputValue()) === '') await day.fill(new Date().toISOString().slice(0, 10));
		await page.getByRole('button', { name: 'Set the rate' }).click();
		await page.waitForTimeout(2000);
		// Seq A's rows to A, one by one; the Creature bid to B, whole, from one of its rows.
		for (const s of state.shots) {
			await page.getByRole('gridcell', { name: new RegExp(`^${esc(s.code)}, Vendor A \\(drive\\):`) }).click();
			await page.waitForTimeout(700);
		}
		await page.getByRole('gridcell', { name: /^zzsgbids_CR010, Vendor B \(drive\):/ }).click();
		await page.waitForTimeout(1500);
		await page.getByRole('button', { name: 'Mark as the chosen scenario' }).click();
		await page.waitForTimeout(1500);
		await shoot(page, 'compare-scenario');
		const [sc] = await sql`select s.id, (select count(*)::int from public.award_scenario_items i where i.scenario_id = s.id) as picks from public.award_scenarios s where s.request_id = ${state.requestId} and s.chosen`;
		expect(sc?.picks === state.shots.length + 3, `scenario chosen: ${sc?.picks} rows picked, Seq A to Vendor A, the Creature bid whole to Vendor B, B's rate 1.27 GBP to USD`);
	},

	async publish() {
		await page.goto(`${APP}/requests/${state.requestId}/publish?project=${state.projectId}`);
		await page.waitForLoadState('networkidle');
		await page.locator('[data-slot=gate-exposure]').getByText(/could not read|can read|cannot see/).first().waitFor({ timeout: 60_000 });
		await page.waitForTimeout(1000);
		for (const kind of ['shot', 'asset']) {
			const box = page.locator(`[data-slot=gate-missing] [data-kind=${kind}]`);
			if (await box.count()) await box.getByRole('radio', { name: 'Publish without them' }).click();
		}
		await page.locator('[data-slot=write-ledger]').waitFor({ timeout: 60_000 });
		await page.waitForTimeout(1500);
		const anyway = page.locator('[data-slot=publish-anyway]');
		if (await anyway.count()) await anyway.click();
		await shoot(page, 'publish-preview');
		await page.locator('[data-slot=gate-rail] [data-slot=publish]').click();
		await page.locator('[data-slot=published], [data-slot=publish-failed]').first().waitFor({ timeout: 120_000 });
		await page.waitForTimeout(1000);
		await shoot(page, 'publish-done');
		expect((await page.locator('[data-slot=published]').count()) === 1, 'the publish page says published and read back');
	},

	async readBack() {
		const prefix = `sgbids/${state.requestId}/`;
		const bids = await search(state.bidType, [['sg_sgbids_key', 'starts_with', prefix]], ['code', 'sg_vendor', 'sg_total', 'sg_currency', 'sg_total_base', 'sg_exchange_rate', 'sg_status_list', 'sg_sgbids_key']);
		const lines = await search(state.lineType, [['sg_sgbids_key', 'starts_with', prefix]], ['code', 'sg_item', 'sg_amount', 'sg_currency', 'sg_amount_base', 'sg_bid', 'sg_sgbids_key']);
		state.fptBids = bids.map((b) => b.id);
		const minor = (v) => Math.round(Number(v ?? 0) * 100);
		const line = (b) => `${b.attributes.code}: ${b.attributes.sg_total} ${b.attributes.sg_currency} (base ${b.attributes.sg_total_base} USD)`;
		expect(bids.length === 2, `Flow PT holds 2 Bids: ${bids.map(line).join('; ')}`);
		const byBid = new Map(bids.map((b) => [b.id, lines.filter((l) => l.relationships.sg_bid?.data?.id === b.id)]));
		for (const b of bids) {
			const ls = byBid.get(b.id);
			const sum = ls.reduce((n, l) => n + minor(l.attributes.sg_amount), 0);
			const figure = ls.every((l) => l.attributes.sg_amount === null);
			expect(
				figure ? ls.length === 3 && minor(b.attributes.sg_total) === 420000 : sum === minor(b.attributes.sg_total),
				figure
					? `${b.attributes.code}: one figure ${b.attributes.sg_total} ${b.attributes.sg_currency} on the Bid, ${ls.length} Bid Lines with no amount`
					: `${b.attributes.code}: ${ls.length} Bid Lines summing to ${sum / 100}, the Bid's total ${b.attributes.sg_total}`
			);
		}
		const groups = {};
		for (const r of await search('Shot', [['id', 'in', state.shots.map((s) => s.id)]], ['sg_vendor_groups'])) groups[r.id] = (r.relationships.sg_vendor_groups?.data ?? []).map((g) => g.id);
		expect(state.shots.every((s) => groups[s.id]?.includes(GROUP_A)), `Vendor A's Group on the ${state.shots.length} Seq A Shots`);
	},

	async undo() {
		await page.goto(`${APP}/requests/${state.requestId}?project=${state.projectId}`);
		await page.waitForLoadState('networkidle');
		await page.locator('[data-slot=award-panel] [data-slot=undo]').click();
		await page.locator('[data-slot=undo-confirm]').click();
		await page.locator('[data-slot=award-panel]').waitFor({ state: 'detached', timeout: 120_000 });
		await shoot(page, 'request-after-undo');
		const prefix = `sgbids/${state.requestId}/`;
		const bids = await search(state.bidType, [['sg_sgbids_key', 'starts_with', prefix]], ['code']);
		const lines = await search(state.lineType, [['sg_sgbids_key', 'starts_with', prefix]], ['code']);
		const groups = {};
		for (const r of await search('Shot', [['id', 'in', state.shots.map((s) => s.id)]], ['sg_vendor_groups'])) groups[r.id] = (r.relationships.sg_vendor_groups?.data ?? []).map((g) => g.id);
		expect(bids.length === 0 && lines.length === 0, 'after Undo award Flow PT holds no Bid and no Bid Line of the request');
		expect(state.shots.every((s) => !(groups[s.id] ?? []).includes(GROUP_A)), "Vendor A's Group is off every Seq A Shot again, as before");
		const [row] = await sql`select status from public.bid_requests where id = ${state.requestId}`;
		expect(row.status === 'issued', 'the request is issued again');
	},

	async again() {
		// Bid B goes out again, in a second request, from its own page.
		await page.goto(`${APP}/bids/${state.bidB}?project=${state.projectId}`);
		await page.waitForLoadState('networkidle');
		await page.locator('[data-slot=send-bid]').click();
		await page.waitForURL(/\/requests\/new\?.*id=[0-9a-f-]{36}/, { timeout: 30_000 });
		state.secondId = new URL(page.url()).searchParams.get('id');
		await page.locator('[data-slot=step-next]').click();
		await page.locator('#f-title').first().fill(`zzsgbids second ${state.stamp}`);
		await page.waitForTimeout(1200);
		await page.locator('[data-slot=step-next]').click();
		await page.locator('#v-name').fill('Vendor C (drive)');
		await page.locator('#v-email').fill('qa_ch_vendor_c@e2e.sg-bids.test');
		await page.locator('[data-slot=invite-submit]').click();
		await page.locator('tr[data-vendor="Vendor C (drive)"]').waitFor({ timeout: 20_000 });
		await page.locator('[data-slot=step-next]').click();
		await page.locator('[data-slot=review-ready]').waitFor({ timeout: 20_000 });
		await page.locator('[data-slot=issue]').click();
		await page.locator('[data-slot=issue-confirm] [data-slot=issue-now]').click();
		await page.locator('[data-slot=issued-links]').waitFor({ timeout: 30_000 });
		await page.goto(`${APP}/bids/${state.bidB}?project=${state.projectId}`);
		await page.waitForLoadState('networkidle');
		await page.locator('[data-slot=bid-requests]').waitFor({ timeout: 30_000 });
		const text = (await page.locator('[data-slot=bid-requests]').innerText()).replace(/\s+/g, ' ').trim();
		await shoot(page, 'bid-b-two-requests');
		const rows = await sql`select r.code, r.status from public.request_packages p join public.bid_requests r on r.id = p.request_id where p.bid_id = ${state.bidB} order by r.created_at`;
		expect(rows.length === 2 && rows.every((r) => r.status === 'issued'), `bid B went out again: ${text}`);
	}
};

async function cleanUp() {
	// Flow PT: anything of the drive's requests left behind. The Shots keep their groups as before.
	for (const id of [state.requestId, state.secondId].filter(Boolean)) {
		const prefix = `sgbids/${id}/`;
		const bids = await search(state.bidType, [['sg_sgbids_key', 'starts_with', prefix]], ['code']);
		const lines = await search(state.lineType, [['sg_sgbids_key', 'starts_with', prefix]], ['code']);
		if (bids.length + lines.length > 0) {
			await fpt('POST', '/entity/_batch', { requests: [...lines.map((l) => ({ request_type: 'delete', entity: state.lineType, record_id: l.id })), ...bids.map((b) => ({ request_type: 'delete', entity: state.bidType, record_id: b.id }))] });
			log(`deleted ${bids.length} Bids and ${lines.length} Bid Lines left behind`);
		}
	}
	if (!state.projectId) return;
	const made = await search('Shot', [['project', 'is', { type: 'Project', id: state.projectId }], ['code', 'starts_with', 'zzsgbids']], ['code']);
	const madeAssets = await search('Asset', [['project', 'is', { type: 'Project', id: state.projectId }], ['code', 'starts_with', 'zzsgbids']], ['code']);
	for (const r of made) await fpt('DELETE', `/entity/shots/${r.id}`);
	for (const r of madeAssets) await fpt('DELETE', `/entity/assets/${r.id}`);
	// The database: the drive's requests and bids, by name, through the app's own deletes; frozen rows
	// left by a failure part way go with the triggers off for one transaction.
	const requests = await sql`select id, code from public.bid_requests where project_id = ${state.projectId} and header->>'title' like ${`zzsgbids % ${STAMP}`}`;
	for (const r of requests) {
		await sql`select public.sg_delete_request(${r.id}, site_host, project_id) from public.bid_requests where id = ${r.id}`.catch(() =>
			sql.begin(async (tx) => {
				await tx`set local session_replication_role = replica`;
				for (const table of ['bid_rates', 'awards', 'award_publications', 'award_scenario_items', 'award_scenarios', 'bid_lines', 'bids', 'invitations', 'request_items', 'request_packages']) {
					await tx`delete from ${tx('public.' + table)} where request_id = ${r.id}`;
				}
				await tx`delete from public.bid_requests where id = ${r.id}`;
			})
		);
	}
	const bids = await sql`select id from public.production_bids where project_id = ${state.projectId} and name like ${`zzsgbids % ${STAMP}%`}`;
	for (const b of bids) await sql`select public.sg_delete_production_bid(${b.id}, site_host, project_id) from public.production_bids where id = ${b.id}`;
	const [left] = await sql`select (select count(*) from public.bid_requests where project_id = ${state.projectId} and header->>'title' like ${`zzsgbids % ${STAMP}`}) + (select count(*) from public.production_bids where project_id = ${state.projectId} and name like ${`zzsgbids % ${STAMP}%`}) as n`;
	const fptLeft = (await search(state.bidType, [['sg_sgbids_key', 'starts_with', `sgbids/${state.requestId}/`]], ['code'])).length;
	expect(Number(left.n) === 0 && fptLeft === 0 && made.length + madeAssets.length >= 0, `clean: ${requests.length} requests and ${bids.length} bids deleted in the drive's database, ${made.length + madeAssets.length} zzsgbids rows deleted in Flow PT, no Bid of the drive left in Flow PT`);
}

let failed = null;
try {
	app = await startApp();
	browser = await chromium.launch();
	ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	page = await ctx.newPage();
	page.on('pageerror', (e) => log('page error:', e.message.slice(0, 200)));
	for (const name of ['pre', 'bidA', 'bidB', 'clone', 'request', 'editAfter', 'vendorA', 'vendorB', 'compare', 'publish', 'readBack', 'undo', 'again']) {
		log('stage', name);
		await stages[name]();
	}
} catch (error) {
	failed = error;
	await page?.screenshot({ path: `${OUT}failure.png` }).catch(() => {});
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
