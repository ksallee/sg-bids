#!/usr/bin/env node
// `pnpm e2e:live`: the whole product, live, in a real browser. Opt-in, never in CI. It writes to a
// real Flow PT project and a database, then takes everything back.
//
//   E2E_SANDBOX_PROJECT="<project name>" E2E_GROUP_A=<id> E2E_GROUP_B=<id> pnpm e2e:live
//
// Needs in `.env.local` (or the environment): the three `FPT_API_*` lines (the dev key: the app
// signs in with it under `vite dev`), `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `POSTGRES_URL_NON_POOLING`,
// pointing at a throwaway database, not one a running app reads. And in the environment:
// `E2E_SANDBOX_PROJECT`, the one Flow PT project it may write to, by name, and `E2E_GROUP_A`,
// `E2E_GROUP_B`, two Group ids the vendors are linked to. `E2E_SCREENS=1` also shoots the main screens
// at 1280, 1440, 1920 (light and dark) and 2560 into `shots/one-page/`, or `E2E_SCREENS_DIR` under
// `shots/`.
//
// It starts its own `vite dev` on a free port it picks, and never uses an app it did not start: two
// worktrees driving at once each talk to their own app and database (docs/development.md), then:
//   1. makes a request from the Requests list: a name and the project, in the New request dialog;
//   2. on its one page: 4 Shots of the sandbox from Flow PT (`zzsgbids_*` fixtures when it has
//      fewer) and 2 breakdown Shots with a difficulty into the first bid (the request's name and 01), renamed Seq A; a row typed by hand
//      into Seq A with Add row, its code then Tab then a count of 120, Enter adding the next row
//      (taken out again); at 1920, one click edits a breakdown row's Frames (a bare field, its value
//      selected, no steppers), Undo puts it back, one click edits a note, one click on Omit flips it
//      on and off, each read back from the database; Add bid, renamed Creature, a breakdown Shot and Asset into it; one Flow PT
//      Shot moved from Seq A to Creature; the side panel hidden and shown;
//   3. two vendors typed in their rows: Vendor A on every bid, Vendor B on Creature alone; then a
//      third row creates an empty Group `zzsgbids_grp_<stamp>` beside its Group picker, read back
//      from Flow PT, and a fourth row typing the same name is warned and offered that Group rather
//      than a second; both rows go again, and the Group is retired and read back gone;
//   4. presses Issue with the due day left blank: the list names it, a press marks the field; the
//      day set, it issues, and the page shows the links once: Copy all and Email checked;
//   5. answers as each vendor in its own browser context: A fills its rate card (a rate per
//      difficulty and one for rows with none, which prices the counted row per unit: its line is
//      the rate times 120), overrides one row, declines Creature; B prices Creature as one figure in
//      GBP;
//   6. sets B's rate, gives Seq A to A and Creature whole to B, chooses the scenario;
//   7. publishes (breakdown rows without a Shot or Asset), reads Flow PT back: the Bids, the Bid
//      Lines, their sums, the counted row's Bid Line (its amount, its count in the name, and in Count
//      when the site has the field; the drive creates no field), the Groups on the Shots; undoes from
//      the request page and reads it again;
//   8. duplicates the request from the list, without its rows, and checks the copy;
//   8b. round 1 had no Omit column and no Omit on the selection; starts round 2 from the issued
//      request, omits one Seq A row with a double click on its Omit cell, issues it, answers as
//      Vendor A (the cut row takes no price), and reads the comparison's cut mark on the row;
//   9. on the list: opens the request from its row's link; reads back its Bids, Shots and Assets
//      (both bids by name, the totals by unit, the counted row as 120) and the copy's; filters to
//      the drive's rows and ticks them with the header box; duplicates both with their rows and reads
//      back the two new drafts and their totals; Shift ticks all four and deletes them, a mix of
//      drafts and the issued request behind the typed word, and reads back that they are gone;
//  10. deletes what the drive made, in Flow PT (its Group too) and in the database, also on a
//      failure part way.
// Screenshots go to `shots/e2e-live/`. It prints ids and counts, never a token, a key or the site.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { chromium } from 'playwright';
import { loadEnv } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The app this drive starts, on a free port picked at the start. Set by `startApp`. */
let APP = '';
const OUT = `${ROOT}shots/e2e-live/`;
const SCREENS = `${ROOT}shots/${(process.env.E2E_SCREENS_DIR ?? 'one-page').replace(/^\/+|\/+$/g, '')}/`;
const env = { ...loadEnv('development', ROOT, ''), ...process.env };
for (const name of ['FPT_API_SITE_URL', 'FPT_API_SCRIPT_NAME', 'FPT_API_API_KEY', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'POSTGRES_URL_NON_POOLING', 'E2E_SANDBOX_PROJECT', 'E2E_GROUP_A', 'E2E_GROUP_B']) {
	if (!env[name]) {
		console.error(`${name} is not set. See the head of scripts/e2e-live.mjs.`);
		process.exit(1);
	}
}
mkdirSync(OUT, { recursive: true });
if (env.E2E_SCREENS) mkdirSync(SCREENS, { recursive: true });
const SANDBOX = env.E2E_SANDBOX_PROJECT;
const GROUP_A = Number(env.E2E_GROUP_A);
const GROUP_B = Number(env.E2E_GROUP_B);
const STAMP = new Date().toISOString().slice(0, 16).replace(/\D/g, '');
const NAME = `zzsgbids drive ${STAMP}`;
/** The row typed by hand, and how many shots it stands for. */
const COUNTED = { code: 'zzsgbids_SIMPLE', count: 120 };
/** The Group the drive creates from a vendor row, then retires. */
const GROUP_NAME = `zzsgbids_grp_${STAMP}`;
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
async function token() {
	bearer ??= (
		await (
			await fetch(`${SITE}/api/v1/auth/access_token`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
				body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.FPT_API_SCRIPT_NAME, client_secret: env.FPT_API_API_KEY })
			})
		).json()
	).access_token;
	return bearer;
}
async function fpt(method, path, body, type = 'application/json') {
	await token();
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
/** The status of a GET, as the script key: a retired row answers 404. */
async function fetchStatus(path) {
	const res = await fetch(`${SITE}/api/v1${path}`, { headers: { Authorization: `Bearer ${await token()}`, Accept: 'application/json' } });
	await res.text();
	return res.status;
}
// Filters in the array form, which a `_search` takes with its own content type (004).
const search = (type, filters, fields) => fpt('POST', `/entity/${type}/_search?page[size]=500`, { filters, fields }, 'application/vnd+shotgun.api3_array+json').then((r) => r.data);

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(env.POSTGRES_URL_NON_POOLING);
const sql = postgres(env.POSTGRES_URL_NON_POOLING.replace(/[?&]sslmode=[^&]*/, ''), { ...(local ? {} : { ssl: { rejectUnauthorized: false } }), max: 1, onnotice: () => {} });

/** A port nothing listens on now, from the system. */
function freePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

async function startApp() {
	const port = await freePort();
	APP = `http://localhost:${port}`;
	log('app on its own port', port);
	// `--strictPort`: if the port is taken in the meantime, vite stops, and the drive with it.
	const child = spawn('pnpm', ['exec', 'vite', 'dev', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
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

/** With `E2E_SCREENS`, the page at each width, light, and at 1920 dark too. */
async function screens(p, name) {
	if (!env.E2E_SCREENS) return;
	const was = p.viewportSize();
	// A popover near the bottom can leave the document scrolled: the screens start from the top.
	await p.evaluate(() => document.scrollingElement?.scrollTo(0, 0));
	for (const [width, height, dark] of [
		[1280, 800, false],
		[1440, 900, false],
		[1920, 1080, false],
		[1920, 1080, true],
		[2560, 1440, false]
	]) {
		await p.setViewportSize({ width, height });
		await p.evaluate((on) => {
			document.documentElement.classList.toggle('dark', on);
			document.documentElement.style.colorScheme = on ? 'dark' : 'light';
		}, dark);
		await p.waitForTimeout(400);
		await p.screenshot({ path: `${SCREENS}${name}-${width}${dark ? '-dark' : ''}.png` });
	}
	await p.evaluate(() => {
		document.documentElement.classList.remove('dark');
		document.documentElement.style.colorScheme = 'light';
	});
	await p.setViewportSize(was);
	await p.waitForTimeout(300);
}

async function pickEntity(trigger, text) {
	await trigger.click();
	await page.keyboard.type(text, { delay: 20 });
	const option = page.getByRole('option').filter({ hasText: new RegExp(`(^|\\n)\\s*${esc(text)}\\s*($|\\n)`) }).first();
	await option.waitFor({ timeout: 20_000 });
	await option.click();
}

async function saved() {
	await page.waitForTimeout(1000);
	await page.locator('[data-slot=save-line][data-state=saved]').waitFor({ timeout: 30_000 });
}

/** A breakdown pasted into the bid picked: the dialog, the columns as detected, then Add. */
async function breakdown(text) {
	await page.locator('[data-slot=breakdown-open]').click();
	const dialog = page.locator('[data-slot=breakdown-dialog]');
	await dialog.waitFor();
	await dialog.locator('[data-slot=breakdown-paste]').fill(text);
	await dialog.locator('[data-slot=breakdown-next]').click();
	await dialog.locator('[data-slot=breakdown-add]').click();
	await dialog.waitFor({ state: 'detached' });
}

async function renameBid(from, to) {
	const chip = page.locator(`[data-slot=bid-chip][data-bid="${from}"]`);
	await chip.locator('[data-slot=bid-menu]').click();
	await page.locator('[data-slot=bid-rename-open]').click();
	const input = page.locator('[data-slot=bid-rename]');
	await input.fill(to);
	await input.press('Enter');
	await page.locator(`[data-slot=bid-chip][data-bid="${to}"]`).waitFor();
}

/** A breakdown row's stored frames, note and Omit, from the database. */
async function storedItem(code) {
	const [item] = await sql`select fields->>'frames' as frames, fields->>'notes' as notes, omitted from public.production_bid_items where request_id = ${state.requestId} and code = ${code}`;
	return item;
}

/**
 * One click edits a cell, at 1920: a number is a bare field, its value selected, no steppers; a text
 * cell its field. The edit offers Undo. One click on a checkbox flips it. No row gets selected. Each
 * value is read back from the database.
 */
async function cellEdits(table) {
	const was = page.viewportSize();
	await page.setViewportSize({ width: 1920, height: 1080 });
	const row = (code) => table.locator('tr[data-row-key]', { hasText: code });
	const selected = () => page.locator('[data-slot=bulk-bar]').count();

	// Frames: one click opens the bare field with the value selected.
	const frames = row('zzsgbids_SQ900').locator('td[data-column=c_frames]');
	await frames.click();
	const framesInput = frames.locator('[data-slot=entity-table-editor] input');
	await framesInput.waitFor({ timeout: 10_000 });
	const open = await framesInput.evaluate((el) => ({ value: el.value, selected: el.value.length > 0 && el.selectionStart === 0 && el.selectionEnd === el.value.length, focused: document.activeElement === el }));
	const steppers = await frames.locator('[data-slot=entity-table-editor] button').count();
	await shoot(page, 'cell-frames-one-click-1920');
	await page.keyboard.type('75');
	await page.keyboard.press('Enter');
	await saved();
	const afterEdit = await storedItem('zzsgbids_SQ900');
	const toast = (await page.locator('[data-slot=edit-toast]').innerText()).split('\n')[0];
	expect(
		open.value === '60' && open.selected && open.focused && steppers === 0 && afterEdit?.frames === '75' && (await selected()) === 0,
		`one click on zzsgbids_SQ900's Frames opened a bare field holding ${open.value}, selected and focused, ${steppers} stepper buttons; 75 and Enter stored frames ${afterEdit?.frames}; no row selected; the line said "${toast}"`
	);
	await page.locator('[data-slot=edit-undo]').click();
	await page.locator('[data-slot=edit-toast]', { hasText: 'The old values are back.' }).waitFor({ timeout: 10_000 });
	await saved();
	const afterUndo = await storedItem('zzsgbids_SQ900');
	expect(afterUndo?.frames === '60', `Undo put zzsgbids_SQ900's frames back: stored ${afterUndo?.frames}`);

	// A text cell: one click opens its field.
	const notes = row('zzsgbids_SQ910').locator('td[data-column=c_notes]');
	await notes.click();
	const notesInput = notes.locator('[data-slot=entity-table-editor] input');
	await notesInput.waitFor({ timeout: 10_000 });
	const notesFocused = await notesInput.evaluate((el) => document.activeElement === el);
	await page.keyboard.type('Roof only');
	await shoot(page, 'cell-text-one-click-1920');
	await page.keyboard.press('Enter');
	await saved();
	const noted = await storedItem('zzsgbids_SQ910');
	expect(notesFocused && noted?.notes === 'Roof only' && (await selected()) === 0, `one click on zzsgbids_SQ910's Note to vendors opened its field, focused; typed and Enter stored "${noted?.notes}"; no row selected`);

	// Omit: one click flips it on, another off.
	const omit = row('zzsgbids_SQ910').locator('td[data-column=c_omitted]');
	const box = omit.getByRole('checkbox');
	await omit.click();
	await box.and(page.locator('[data-state=checked]')).waitFor({ timeout: 10_000 });
	await saved();
	const omitted = await storedItem('zzsgbids_SQ910');
	const omitEditor = await omit.locator('[data-slot=entity-table-editor]').count();
	const selectedOn = await selected();
	await omit.click();
	await box.and(page.locator('[data-state=unchecked]')).waitFor({ timeout: 10_000 });
	await saved();
	const included = await storedItem('zzsgbids_SQ910');
	expect(
		omitted?.omitted === true && included?.omitted === false && omitEditor === 0 && selectedOn === 0 && (await selected()) === 0,
		`one click on zzsgbids_SQ910's Omit box stored omitted ${omitted?.omitted} with no editor and no row selected; a second click stored ${included?.omitted}`
	);
	await page.setViewportSize(was);
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
		const shots = (await search('Shot', [['project', 'is', { type: 'Project', id: sb.id }]], ['code', 'sg_vendor_groups']))
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
		state.moved = shots.at(-1);
		state.seqShots = shots.slice(0, -1);
		const schema = await fpt('GET', '/schema');
		const slot = (display) => Object.entries(schema.data).find(([k, v]) => /^CustomEntity\d+$/.test(k) && String(v.name?.value).trim() === display)?.[0];
		state.bidType = slot('Bid');
		state.lineType = slot('Bid Line');
		log('sandbox', state.projectId, 'shots', state.shots.length);
	},

	async newRequest() {
		await page.goto(`${APP}/requests`);
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(1500);
		if (await page.locator('[data-slot=requests]').count()) await screens(page, 'requests-rows');
		else await screens(page, 'requests-empty');
		await page.locator('[data-slot=new-request]').first().click();
		await page.locator('[data-slot=new-request-name]').fill(NAME);
		await pickEntity(page.locator('[data-slot=new-request-project] button').first(), SANDBOX);
		await page.waitForTimeout(400);
		await shoot(page, 'new-request');
		await screens(page, 'new-request');
		await page.locator('[data-slot=new-request-create]').click();
		await page.waitForURL(/\/requests\/[0-9a-f-]{36}/, { timeout: 30_000 });
		state.requestId = new URL(page.url()).pathname.split('/').pop();
		await page.locator('[data-slot=items-panel]').waitFor({ timeout: 60_000 });
		await page.waitForTimeout(1500);
		await shoot(page, 'draft-empty');
		await screens(page, 'draft-empty');
		const [req] = await sql`select code, status, header->>'title' as title from public.bid_requests where id = ${state.requestId}`;
		const bids = await sql`select p.name from public.request_packages p where p.request_id = ${state.requestId}`;
		expect(req?.status === 'draft' && req.title === NAME && bids.map((b) => b.name).join() === `${NAME} 01`, `a draft made from the New request dialog: "${req?.title}", one bid named after it with 01, its code made from the name (${req?.code}) and shown nowhere`);
	},

	async bids() {
		await renameBid(`${NAME} 01`, 'Seq A');
		// Four Shots from Flow PT, into Seq A.
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
		await dialog.waitFor({ state: 'detached' });
		// Two breakdown Shots with a difficulty, into Seq A too.
		await breakdown(`Shot\tDescription\tFrames\tDifficulty\nzzsgbids_SQ900\tRooftop wide\t60\tHard\nzzsgbids_SQ910\tRooftop close\t40\tEasy`);
		// A row typed by hand: Add row opens its code; Tab writes it and opens the Count; Enter on the last row adds the next.
		const table = page.locator('[data-slot=request-table]');
		const before = await table.locator('tr[data-row-key]').count();
		await page.locator('[data-slot=add-row]').click();
		await table.locator('[data-slot=entity-table-editor] input').first().waitFor({ timeout: 10_000 });
		await page.keyboard.type(COUNTED.code, { delay: 15 });
		await page.keyboard.press('Tab');
		await page.waitForTimeout(500);
		const opened = await page.evaluate(() => document.activeElement?.closest('td')?.getAttribute('data-column') ?? '');
		await page.keyboard.type(String(COUNTED.count), { delay: 15 });
		await page.keyboard.press('Enter');
		// The next row comes with its code open to type in.
		await page.waitForFunction((n) => document.querySelectorAll('[data-slot=request-table] tr[data-row-key]').length === n, before + 2, { timeout: 10_000 });
		await page.waitForTimeout(500);
		const after = await table.locator('tr[data-row-key]').count();
		const nextOpen = await page.evaluate(() => document.activeElement?.closest('td')?.getAttribute('data-column') ?? '');
		const typedRow = table.locator('tr[data-row-key]', { hasText: COUNTED.code });
		const shownCount = (await typedRow.locator('[data-slot=row-count]').innerText()).replace(/\D/g, '');
		const header = await table.locator('[data-slot=bid-group-counts]').first().innerText();
		await shoot(page, 'row-typed-by-hand');
		await screens(page, 'table-counted-rows');
		expect(
			opened === 'c_count' && nextOpen === 'c_code' && after === before + 2 && shownCount === String(COUNTED.count) && / in \d+ rows/.test(header),
			`a row typed by hand: Add row opened its code, Tab wrote it and opened the Count (${opened}), Enter on the last row added the next one, its code open (${nextOpen}); the row shows ${shownCount} and its bid says "${header}"`
		);
		// The empty row goes again: a row with no code would stop the issue.
		await page.keyboard.press('Escape');
		await table.locator('[data-slot=row-no-code]').waitFor({ timeout: 10_000 });
		await table.locator('tr[data-row-key]', { has: page.locator('[data-slot=row-no-code]') }).getByRole('checkbox').first().click();
		await page.locator('[data-slot=bulk-remove]').click();
		await table.locator('[data-slot=row-no-code]').waitFor({ state: 'detached', timeout: 10_000 });
		await cellEdits(table);
		// A second bid, Creature: a breakdown Shot and an Asset.
		await page.locator('[data-slot=add-bid]').click();
		const rename = page.locator('[data-slot=bid-rename]');
		await rename.waitFor();
		await rename.fill('Creature');
		await rename.press('Enter');
		await breakdown(`Shot\tDescription\tFrames\nzzsgbids_CR010\tCreature lands\t100`);
		// No asset yet: a quiet + Assets opens the add dialog for assets; closed, the Assets tab stays.
		await page.locator('[data-slot=add-assets]').click();
		const fptDialog = page.locator('[data-slot=fpt-add-dialog]');
		await fptDialog.waitFor();
		await page.keyboard.press('Escape');
		await fptDialog.waitFor({ state: 'detached' });
		await page.locator('#tab-asset').click();
		await breakdown(`Asset\tType\nzzsgbids_Creature\tCharacter`);
		await page.locator('#tab-shot').click();
		await page.waitForTimeout(800);
		// One Flow PT Shot moves from Seq A to Creature, from the selection bar.
		await page.locator('[data-slot=request-table] tr', { hasText: state.moved.code }).getByRole('checkbox').first().click();
		// Round 1 has no Omit: removing a row does it.
		const omitCells = await page.locator('[data-slot=request-table] td[data-column=c_omitted]').count();
		const omitButton = await page.locator('[data-slot=bulk-omit]').count();
		await page.setViewportSize({ width: 1920, height: 1080 });
		await page.waitForTimeout(600);
		await shoot(page, 'round1-no-omit-1920');
		await page.setViewportSize({ width: 1440, height: 900 });
		expect(omitCells === 0 && omitButton === 0, 'a round 1 draft has no Omit column and no Omit on the selection');
		await page.locator('[data-slot=bulk-move]').click();
		await page.locator('[data-slot=bulk-move-to][data-bid="Creature"]').click();
		await saved();
		await page.waitForTimeout(800);
		await shoot(page, 'draft-two-bids');
		const rows = await sql`select b.name, i.kind, i.code from public.production_bid_items i join public.production_bids b on b.id = i.bid_id where i.request_id = ${state.requestId} order by b.name, i.kind desc, i.position`;
		const of = (name) => rows.filter((r) => r.name === name).map((r) => r.code);
		const seq = of('Seq A');
		const creature = of('Creature');
		expect(seq.length === 6 && creature.length === 3 && creature.includes(state.moved.code) && !seq.includes(state.moved.code), `two bids stored with their rows: Seq A holds ${seq.join(', ')}; Creature holds ${creature.join(', ')}, ${state.moved.code} moved in from Seq A`);
		const [counted] = await sql`select unit_count, source, fpt_id from public.production_bid_items where request_id = ${state.requestId} and code = ${COUNTED.code}`;
		expect(counted?.unit_count === COUNTED.count && counted.source === 'breakdown' && counted.fpt_id === null, `the typed row is stored in this request only with unit_count ${counted?.unit_count}`);
	},

	async vendors() {
		const rows = page.locator('[data-slot=vendor-row]');
		// Vendor A, typed into the empty row: every bid.
		await rows.nth(0).locator('[data-slot=vendor-name]').fill('Vendor A (drive)');
		await rows.nth(0).locator('[data-slot=vendor-email]').fill(`${state.groupCode[GROUP_A].toLowerCase()}@e2e.sg-bids.test`);
		await pickEntity(rows.nth(0).locator('[data-slot=vendor-group] button').first(), state.groupCode[GROUP_A]);
		// Vendor B, a second row: Creature alone.
		await page.locator('[data-slot=add-vendor]').click();
		await rows.nth(1).locator('[data-slot=vendor-name]').fill('Vendor B (drive)');
		await rows.nth(1).locator('[data-slot=vendor-email]').fill(`${state.groupCode[GROUP_B].toLowerCase()}@e2e.sg-bids.test`);
		await pickEntity(rows.nth(1).locator('[data-slot=vendor-group] button').first(), state.groupCode[GROUP_B]);
		await rows.nth(1).locator('[data-slot=vendor-bids]').click();
		await page.locator('[data-slot=vendor-bid-option][data-bid="Seq A"]').click();
		await page.keyboard.press('Escape');
		await saved();
		await page.waitForTimeout(600);
		await shoot(page, 'draft-vendors');
		await screens(page, 'draft-two-bids');
		// The side panel hides to give the table its room, and this browser keeps the choice.
		await page.locator('[data-slot=side-panel-toggle]').click();
		await page.locator('[data-slot=side-panel][data-state=closed]').waitFor();
		await page.waitForTimeout(400);
		await screens(page, 'draft-panel-hidden');
		const kept = await page.evaluate(() => localStorage.getItem('sg-bids:side-panel'));
		await page.locator('[data-slot=side-panel-toggle]').click();
		await page.locator('[data-slot=side-panel][data-state=open]').waitFor();
		expect(kept === 'closed' && (await page.evaluate(() => localStorage.getItem('sg-bids:side-panel'))) === 'open', 'the side panel hides and shows again, the choice kept in this browser');
		const inv = await sql`select vendor_name, vendor_group_id, package_keys, link_pending from public.invitations where request_id = ${state.requestId} order by vendor_name`;
		const creatureKey = (await sql`select key from public.request_packages where request_id = ${state.requestId} and name = 'Creature'`)[0]?.key;
		expect(
			inv.length === 2 && inv.every((v) => v.link_pending) && inv[0].package_keys === null && JSON.stringify(inv[1].package_keys) === JSON.stringify([creatureKey]),
			`two vendors typed in rows: ${inv[0]?.vendor_name} on every bid, ${inv[1]?.vendor_name} on Creature alone, each with its Group, links made at the issue`
		);
	},

	async groupCreate() {
		const rows = page.locator('[data-slot=vendor-row]');
		// A third row: its name, then Create Group beside the picker, shown when the caller may create one.
		await page.locator('[data-slot=add-vendor]').click();
		const third = rows.nth(2);
		await third.locator('[data-slot=vendor-name]').fill(GROUP_NAME);
		await third.locator('[data-slot=group-create-open]').click();
		const pop = page.locator('[data-slot=group-create]');
		await pop.waitFor();
		const startName = await pop.locator('[data-slot=group-create-name]').inputValue();
		const emptyLine = await pop.locator('[data-slot=group-create-empty]').innerText();
		await page.waitForTimeout(800);
		await shoot(page, 'group-create');
		await pop.locator('[data-slot=group-create-confirm]').click();
		await third.locator('[data-slot=group-created]').waitFor({ timeout: 30_000 });
		const createdLine = await third.locator('[data-slot=group-created]').innerText();
		const made = await search('Group', [['code', 'is', GROUP_NAME]], ['code', 'users', 'created_by']);
		state.groupId = made[0]?.id;
		expect(
			startName === GROUP_NAME && /starts empty/.test(emptyLine) && made.length === 1 && (made[0].relationships.users?.data ?? []).length === 0 && /empty/.test(createdLine),
			`Create Group beside the picker made one Group in Flow PT, read back: ${made[0]?.attributes.code} (id ${state.groupId}), ${made[0]?.relationships.users?.data?.length ?? '?'} members, created by ${made[0]?.relationships.created_by?.data?.type}; the row says "${createdLine}"`
		);
		// A fourth row typing the same name is warned and offered that Group, and makes no second one.
		await page.locator('[data-slot=add-vendor]').click();
		const fourth = rows.nth(3);
		await fourth.locator('[data-slot=vendor-name]').fill(GROUP_NAME);
		await fourth.locator('[data-slot=group-create-open]').click();
		await pop.waitFor();
		await pop.locator('[data-slot=group-clash]').waitFor({ timeout: 20_000 });
		const warning = await pop.locator('[data-slot=group-clash]').innerText();
		const blocked = await pop.locator('[data-slot=group-create-confirm]').isDisabled();
		await shoot(page, 'group-clash');
		await pop.locator(`[data-slot=group-use][data-group-id="${state.groupId}"]`).click();
		await pop.waitFor({ state: 'detached' });
		await saved();
		const inv = await sql`select vendor_name, vendor_group_id from public.invitations where request_id = ${state.requestId} and vendor_name = ${GROUP_NAME}`;
		const still = await search('Group', [['code', 'is', GROUP_NAME]], ['code']);
		expect(
			blocked && /already/.test(warning) && still.length === 1 && inv.length === 2 && inv.every((v) => Number(v.vendor_group_id) === state.groupId),
			`the same name typed again is warned ("${warning.trim()}"), Create Group held back, the Group offered and picked: both rows saved with Group ${state.groupId}, still one Group of the name in Flow PT`
		);
		// Both rows go again, and the Group is retired.
		await fourth.locator('[data-slot=vendor-remove]').click();
		await third.locator('[data-slot=vendor-remove]').click();
		await saved();
		const [{ n }] = await sql`select count(*)::int as n from public.invitations where request_id = ${state.requestId}`;
		await fpt('DELETE', `/entity/groups/${state.groupId}`);
		const gone = await fetchStatus(`/entity/groups/${state.groupId}`);
		const left = await search('Group', [['code', 'is', GROUP_NAME]], ['code']);
		expect(n === 2 && gone === 404 && left.length === 0, `the two rows taken off (${n} vendors left), the Group retired: GET answers ${gone}, no live Group of the name`);
		state.groupId = null;
	},

	async issue() {
		// The due day is left blank: Issue lists it, and a press on it marks the field.
		await page.locator('[data-slot=issue]').click();
		const list = page.locator('[data-slot=readiness-list]');
		await list.waitFor();
		const items = await list.locator('[data-slot=readiness-item]').allInnerTexts();
		await page.waitForTimeout(300);
		await shoot(page, 'issue-missing');
		await screens(page, 'draft-missing-list');
		expect(items.length === 1 && /Answers due/.test(items[0]), `Issue with a field missing lists it: "${items.join(' | ')}"`);
		await list.locator('[data-slot=readiness-item][data-target=dueDate]').click();
		const field = page.locator('[data-field="f-dueDate"]');
		await field.locator('[data-slot=field-problem]').waitFor();
		const marked = await field.locator('[data-slot=field-problem]').innerText();
		const focused = await page.evaluate(() => document.activeElement?.closest('[data-field]')?.getAttribute('data-field') ?? '');
		expect(focused === 'f-dueDate' && /due/.test(marked), `the list took the page to Answers due and marked it: "${marked}"`);
		// The day set, it issues.
		const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
		await field.locator('[data-slot=date-editor-trigger]').click();
		await page.locator('[data-slot=date-editor-day]').fill(due);
		await page.locator('[data-slot=date-editor-day]').press('Enter');
		await page.keyboard.press('Escape');
		await saved();
		await page.locator('[data-slot=readiness-chip]', { hasText: 'Ready to issue' }).waitFor({ timeout: 20_000 });
		await page.locator('[data-slot=issue]').click();
		await page.locator('[data-slot=issue-confirm] [data-slot=issue-now]').click();
		await page.locator('[data-slot=vendor-links]').waitFor({ timeout: 60_000 });
		await page.waitForTimeout(800);
		const links = await page.locator('[data-slot=link-value]').evaluateAll((els) => els.map((e) => e.value));
		state.links = links;
		await page.locator('[data-slot=copy-all]').click();
		const copied = await page.evaluate(() => navigator.clipboard.readText());
		const mail = await page.locator('[data-slot=email-link]').first().getAttribute('href');
		await shoot(page, 'issued-links');
		await screens(page, 'issued-links');
		const [req] = await sql`select status from public.bid_requests where id = ${state.requestId}`;
		const items2 = await sql`select code, package_key from public.request_items where request_id = ${state.requestId} order by position`;
		const [{ n }] = await sql`select count(*)::int as n from public.production_bids where request_id = ${state.requestId}`;
		const [countedItem] = await sql`select key, unit_count from public.request_items where request_id = ${state.requestId} and code = ${COUNTED.code}`;
		state.countedKey = countedItem?.key;
		expect(req.status === 'issued' && items2.length === 9 && n === 0 && countedItem?.unit_count === COUNTED.count, `issued: ${items2.length} rows copied into the request under their bids, the counted row with its count ${countedItem?.unit_count}, the draft's bids gone`);
		expect(links.length === 2 && links.every((l) => copied.includes(l)), 'one link per vendor on the page, shown once; Copy all put both on the clipboard, one per line');
		expect(mail?.startsWith('mailto:') && mail.includes(encodeURIComponent(links[0])) && mail.includes('subject='), 'Email opens a mailto with the subject and the link in the body; the app sends nothing');
	},

	async vendorA() {
		// Vendor A: its rate card fills Seq A, one row overridden; Creature declined.
		const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		const vp = await vctx.newPage();
		vp.on('pageerror', (e) => log('vendor pageerror', e.message.slice(0, 200)));
		await vp.goto(state.links[0].replace(/^https?:\/\/[^/]+/, APP));
		await vp.waitForLoadState('networkidle');
		await vp.locator('[data-slot=package-head]').first().waitFor({ timeout: 30_000 });
		await vp.waitForTimeout(800);
		const creature = vp.locator('[data-slot=package-head]', { hasText: 'Creature' });
		await creature.getByRole('radio', { name: 'Not bidding' }).click();
		await vp.waitForTimeout(400);
		// A rate for every difficulty the card offers: Hard 2,500, Easy 800, any other 1,500, none 1,000.
		const RATES = { '': 1000, Hard: 2500, Easy: 800 };
		const offered = await vp.locator('[data-slot=rate-input]').evaluateAll((els) => els.map((e) => e.getAttribute('data-difficulty') ?? ''));
		for (const d of offered) await vp.locator(`[data-slot=rate-input][data-difficulty="${d}"]`).fill(String(RATES[d] ?? 1500));
		const first = state.seqShots[0].code;
		await vp.locator('[data-row]', { hasText: first }).locator('input[data-price]').fill('1200');
		await vp.waitForTimeout(800);
		await vp.locator('[data-slot=totals-rail] [data-save=saved]').filter({ visible: true }).first().waitFor({ timeout: 30_000 });
		const useRate = await vp.locator('[data-row]', { hasText: first }).locator('[data-slot=line-use-rate]').count();
		const fromRate = await vp.locator('[data-slot=line-from-rate]').count();
		const extended = await vp.locator('[data-row]', { hasText: COUNTED.code }).locator('[data-slot=line-extended]').innerText();
		await shoot(vp, 'vendor-a-rates');
		await screens(vp, 'vendor-rate-card');
		await vp.getByRole('button', { name: 'Review and submit' }).first().click();
		await vp.getByRole('button', { name: 'Submit answer' }).click();
		await vp.getByText('Submitted.').first().waitFor({ timeout: 20_000 });
		await shoot(vp, 'vendor-a-submitted');
		await vctx.close();
		const [b] = await sql`select b.id, b.header->'declined' as declined, b.header->'rateCard' as card from public.bids b join public.invitations i on i.id = b.invitation_id where i.request_id = ${state.requestId} and i.vendor_name = 'Vendor A (drive)' and b.status = 'submitted'`;
		const lines = await sql`select l.total_minor, l.detail->>'fromRate' as from_rate, l.detail->'unit' as unit, i.code, i.unit_count, i.fields->>'difficulty' as difficulty from public.bid_lines l join public.request_items i on i.request_id = l.request_id and i.kind = l.item_kind and i.key = l.item_key where l.bid_id = ${b.id}`;
		const total = lines.reduce((n, l) => n + Number(l.total_minor), 0);
		const want = lines.reduce((n, l) => n + (l.code === first ? 120_000 : (RATES[l.difficulty ?? ''] ?? 1500) * 100 * l.unit_count), 0);
		const countedLine = lines.find((l) => l.code === COUNTED.code);
		state.totalA = total;
		state.countedMinor = Number(countedLine?.total_minor);
		expect(useRate === 1 && fromRate === 5, 'the vendor form marks 5 rows as from its rates, the counted row among them, and the typed row as its own, with Use rate');
		expect(/× 120/.test(extended), `the counted row shows its count and its line under the unit price: "${extended.replace(/\s+/g, ' ').trim()}"`);
		expect(
			!!countedLine && Number(countedLine.total_minor) === RATES[''] * 100 * COUNTED.count && countedLine.unit?.minor === RATES[''] * 100 && countedLine.from_rate === 'true',
			`the counted row's line: unit ${countedLine?.unit?.minor / 100} USD from the rate for rows with no difficulty, times ${COUNTED.count}, total ${Number(countedLine?.total_minor) / 100} USD in whole minor units`
		);
		expect(
			lines.length === 6 && total === want && lines.filter((l) => l.from_rate === 'true').length === 5 && lines.find((l) => l.code === first)?.from_rate === null && b.card && JSON.stringify(b.declined).includes('bid:'),
			`Vendor A submitted Seq A from its rate card (${offered.map((d) => `${d || 'no difficulty'} ${RATES[d] ?? 1500}`).join(', ')}), ${first} overridden at 1,200: 6 lines summing to ${total / 100} USD, 5 from the rates, the card kept with the answer; Creature declined`
		);
	},

	async vendorB() {
		// Vendor B: invited to Creature alone, prices it as one figure, in GBP.
		const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		const vp = await vctx.newPage();
		vp.on('pageerror', (e) => log('vendor pageerror', e.message.slice(0, 200)));
		await vp.goto(state.links[1].replace(/^https?:\/\/[^/]+/, APP));
		await vp.waitForLoadState('networkidle');
		await vp.locator('[data-slot=package-head]').first().waitFor({ timeout: 30_000 });
		const heads = await vp.locator('[data-slot=package-head]').count();
		const seen = await vp.locator('[data-slot=item-grid]').innerText();
		expect(heads === 1 && !seen.includes(state.seqShots[0].code), 'Vendor B sees Creature alone: no row of Seq A');
		await vp.getByLabel('Your currency').selectOption('GBP');
		await vp.waitForTimeout(500);
		await vp.locator('[data-slot=package-head]').first().getByRole('radio', { name: 'One figure' }).click();
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
		expect(b?.currency === 'GBP' && b.packages?.[0]?.total?.minor === 420000, `Vendor B submitted Creature as one figure: ${b?.packages?.[0]?.total?.minor / 100} ${b?.currency}`);
	},

	async compare() {
		await page.goto(`${APP}/requests/${state.requestId}/compare?project=${state.projectId}`);
		await page.waitForLoadState('networkidle');
		await page.locator('[data-slot=rate]').first().waitFor({ timeout: 30_000 });
		await page.waitForTimeout(1500);
		await page.locator('[data-slot=rate]').first().click();
		await page.getByPlaceholder('1.2712').fill('1.27');
		const day = page.locator('input[type=date]').first();
		if ((await day.count()) && (await day.inputValue()) === '') await day.fill(new Date().toISOString().slice(0, 10));
		await page.getByRole('button', { name: 'Set the rate' }).click();
		await page.waitForTimeout(2000);
		// Seq A's rows to A, one by one; Creature to B, whole, from one of its rows.
		for (const code of [...state.seqShots.map((s) => s.code), 'zzsgbids_SQ900', 'zzsgbids_SQ910', COUNTED.code]) {
			await page.getByRole('gridcell', { name: new RegExp(`^${esc(code)}, Vendor A \\(drive\\):`) }).click();
			await page.waitForTimeout(700);
		}
		await page.getByRole('gridcell', { name: /^zzsgbids_CR010, Vendor B \(drive\):/ }).click();
		await page.waitForTimeout(1500);
		await page.getByRole('button', { name: 'Mark as the chosen scenario' }).click();
		await page.waitForTimeout(1500);
		const cell = await page.getByRole('gridcell', { name: new RegExp(`^${esc(COUNTED.code)}, Vendor A \\(drive\\):`) }).getAttribute('aria-label');
		await shoot(page, 'compare-scenario');
		await screens(page, 'comparison');
		const [sc] = await sql`select s.id, (select count(*)::int from public.award_scenario_items i where i.scenario_id = s.id) as picks from public.award_scenarios s where s.request_id = ${state.requestId} and s.chosen`;
		expect(/each times 120/.test(cell ?? ''), `the comparison shows the counted row's line total with its unit price and count: "${cell}"`);
		expect(sc?.picks === 9, `scenario chosen: ${sc?.picks} rows picked, Seq A to Vendor A with the counted row whole, Creature whole to Vendor B, B's rate 1.27 GBP to USD`);
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
		await screens(page, 'publish-preview');
		await page.locator('[data-slot=gate-rail] [data-slot=publish]').click();
		await page.locator('[data-slot=published], [data-slot=publish-failed]').first().waitFor({ timeout: 120_000 });
		await page.waitForTimeout(1000);
		await shoot(page, 'publish-done');
		expect((await page.locator('[data-slot=published]').count()) === 1, 'the publish page says published and read back');
	},

	async readBack() {
		const prefix = `sgbids/${state.requestId}/`;
		const bids = await search(state.bidType, [['sg_sgbids_key', 'starts_with', prefix]], ['code', 'sg_vendor', 'sg_total', 'sg_currency', 'sg_total_base', 'sg_exchange_rate', 'sg_status_list', 'sg_sgbids_key']);
		// Count is optional on Bid Line: a site without it answers the read and leaves the name out (028).
		const lines = await search(state.lineType, [['sg_sgbids_key', 'starts_with', prefix]], ['code', 'sg_item', 'sg_amount', 'sg_currency', 'sg_amount_base', 'sg_bid', 'sg_sgbids_key', 'sg_count']);
		const minor = (v) => Math.round(Number(v ?? 0) * 100);
		const line = (b) => `${b.attributes.code}: ${b.attributes.sg_total} ${b.attributes.sg_currency} (base ${b.attributes.sg_total_base} USD)`;
		expect(bids.length === 2 && bids.every((b) => b.attributes.code.startsWith(NAME)), `Flow PT holds 2 Bids, named after the request: ${bids.map(line).join('; ')}`);
		const byBid = new Map(bids.map((b) => [b.id, lines.filter((l) => l.relationships.sg_bid?.data?.id === b.id)]));
		for (const b of bids) {
			const ls = byBid.get(b.id);
			const sum = ls.reduce((n, l) => n + minor(l.attributes.sg_amount), 0);
			const figure = ls.every((l) => l.attributes.sg_amount === null);
			expect(
				figure ? ls.length === 3 && minor(b.attributes.sg_total) === 420000 : ls.length === 6 && sum === minor(b.attributes.sg_total) && sum === state.totalA,
				figure
					? `${b.attributes.code}: one figure ${b.attributes.sg_total} ${b.attributes.sg_currency} on the Bid, ${ls.length} Bid Lines with no amount`
					: `${b.attributes.code}: ${ls.length} Bid Lines summing to ${sum / 100}, the Bid's total ${b.attributes.sg_total}, rate card and override as typed`
			);
		}
		const counted = lines.find((l) => l.attributes.sg_sgbids_key.endsWith(`/shot:${state.countedKey}`));
		const hasField = Object.prototype.hasOwnProperty.call(counted?.attributes ?? {}, 'sg_count');
		expect(
			!!counted &&
				minor(counted.attributes.sg_amount) === state.countedMinor &&
				counted.attributes.code.includes(`${COUNTED.code} x${COUNTED.count} `) &&
				(counted.relationships.sg_item?.data ?? null) === null &&
				(!hasField || counted.attributes.sg_count === COUNTED.count),
			`the counted row's Bid Line reads back: "${counted?.attributes.code}", amount ${counted?.attributes.sg_amount} ${counted?.attributes.sg_currency}, no Shot; its count ${hasField ? `${counted?.attributes.sg_count} in sg_count` : 'in the name alone: the site has no Count field, and the drive creates none'}`
		);
		const madeShots = await search('Shot', [['project', 'is', { type: 'Project', id: state.projectId }], ['code', 'is', COUNTED.code]], ['code']);
		expect(madeShots.length === 0, 'no Shot was created for the counted row');
		const groups = {};
		for (const r of await search('Shot', [['id', 'in', state.shots.map((s) => s.id)]], ['sg_vendor_groups'])) groups[r.id] = (r.relationships.sg_vendor_groups?.data ?? []).map((g) => g.id);
		expect(state.seqShots.every((s) => groups[s.id]?.includes(GROUP_A)) && groups[state.moved.id]?.includes(GROUP_B), `Vendor A's Group on the ${state.seqShots.length} Seq A Shots, Vendor B's on ${state.moved.code} in Creature`);
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
		expect(state.shots.every((s) => !(groups[s.id] ?? []).some((g) => g === GROUP_A || g === GROUP_B)), 'the vendor Groups are off every Shot again, as before');
		const [row] = await sql`select status from public.bid_requests where id = ${state.requestId}`;
		expect(row.status === 'issued', 'the request is issued again');
	},

	async duplicate() {
		await page.goto(`${APP}/requests`);
		await page.waitForLoadState('networkidle');
		const row = page.locator('[data-slot=requests] tr', { hasText: NAME }).first();
		await row.waitFor({ timeout: 30_000 });
		await page.waitForTimeout(800);
		await screens(page, 'requests-rows');
		await row.locator('[data-slot=row-actions]').click();
		await page.locator('[data-slot=row-duplicate]').click();
		const dialog = page.locator('[data-slot=duplicate-request]');
		await dialog.waitFor();
		const name = await dialog.locator('[data-slot=duplicate-name]').inputValue();
		await dialog.locator('[data-slot=duplicate-without-rows]').check();
		await shoot(page, 'duplicate-dialog');
		await dialog.locator('[data-slot=duplicate-now]').click();
		await page.waitForURL((url) => /\/requests\/[0-9a-f-]{36}/.test(url.pathname) && !url.pathname.includes(state.requestId), { timeout: 30_000 });
		state.copyId = new URL(page.url()).pathname.split('/').pop();
		await page.locator('[data-slot=items-panel]').waitFor({ timeout: 60_000 });
		await page.waitForTimeout(1000);
		await shoot(page, 'duplicate-draft');
		const [copy] = await sql`select status, header->>'title' as title, due_on from public.bid_requests where id = ${state.copyId}`;
		const bids = await sql`select name from public.request_packages where request_id = ${state.copyId} order by position`;
		const [{ rows }] = await sql`select count(*)::int as rows from public.production_bid_items where request_id = ${state.copyId}`;
		const inv = await sql`select vendor_name, link_pending from public.invitations where request_id = ${state.copyId} order by vendor_name`;
		expect(
			name === `${NAME} copy` && copy?.status === 'draft' && copy.title === name && bids.map((b) => b.name).join() === 'Seq A,Creature' && rows === 0 && inv.length === 2 && inv.every((v) => v.link_pending) && copy.due_on !== null,
			`duplicated without the rows: "${copy?.title}", a draft with its details, bids ${bids.map((b) => b.name).join(' and ')} empty, and ${inv.length} vendors whose links come at its issue`
		);
	},

	async nextRound() {
		await page.goto(`${APP}/requests/${state.requestId}?project=${state.projectId}`);
		await page.waitForLoadState('networkidle');
		await page.locator('[data-slot=request-more]').click();
		await page.locator('[data-slot=new-round]').click();
		await page.waitForURL((url) => /\/requests\/[0-9a-f-]{36}/.test(url.pathname) && !url.pathname.includes(state.requestId), { timeout: 30_000 });
		state.round2Id = new URL(page.url()).pathname.split('/').pop();
		await page.locator('[data-slot=items-panel]').waitFor({ timeout: 60_000 });
		await page.waitForTimeout(1500);
		// Round 2 keeps Omit. A double click opens the cell's editor, and a press on its control writes it.
		const cut = state.seqShots[0].code;
		const cell = page.locator('[data-slot=request-table] tr[data-row-key]', { hasText: cut }).locator('td[data-column=c_omitted]');
		// The switch in the cell is disabled, and Chrome drops pointer events on a disabled control, so a
		// double click on the switch itself opens nothing: the double click goes beside it.
		const box = await cell.boundingBox();
		await cell.dblclick({ position: { x: box.width - 8, y: box.height / 2 } });
		await cell.locator('[data-slot=entity-table-editor] button').first().click();
		await saved();
		const [row2] = await sql`select round from public.bid_requests where id = ${state.round2Id}`;
		const [item] = await sql`select omitted from public.production_bid_items where request_id = ${state.round2Id} and code = ${cut}`;
		await page.setViewportSize({ width: 1920, height: 1080 });
		// The editor scrolled the table to the Omit column: back to the codes for the shot.
		await page.evaluate(() => document.querySelectorAll('[data-slot=request-table] *').forEach((el) => el.scrollLeft > 0 && (el.scrollLeft = 0)));
		await page.waitForTimeout(600);
		await shoot(page, 'round2-omitted-1920');
		await page.setViewportSize({ width: 1440, height: 900 });
		expect(Number(row2?.round) === 2 && item?.omitted === true, `round ${row2?.round} started from the issued request; a double click on ${cut}'s Omit cell and a press omitted it, saved in the draft (omitted ${item?.omitted})`);
		// Issued, Vendor A answers: the cut row takes no price.
		await page.locator('[data-slot=issue]').click();
		await page.locator('[data-slot=issue-confirm] [data-slot=issue-now]').click();
		await page.locator('[data-slot=vendor-links]').waitFor({ timeout: 60_000 });
		const links = await page.locator('[data-slot=link-value]').evaluateAll((els) => els.map((e) => e.value));
		const vctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
		const vp = await vctx.newPage();
		await vp.goto(links[0].replace(/^https?:\/\/[^/]+/, APP));
		await vp.waitForLoadState('networkidle');
		await vp.locator('[data-slot=package-head]').first().waitFor({ timeout: 30_000 });
		await vp.locator('[data-slot=package-head]', { hasText: 'Creature' }).getByRole('radio', { name: 'Not bidding' }).click();
		const offered = await vp.locator('[data-slot=rate-input]').evaluateAll((els) => els.map((e) => e.getAttribute('data-difficulty') ?? ''));
		for (const d of offered) await vp.locator(`[data-slot=rate-input][data-difficulty="${d}"]`).fill('1000');
		const cutRow = vp.locator('[data-row]', { hasText: cut });
		const cutWords = await cutRow.locator('[data-slot=line-omitted]').innerText();
		const cutInputs = await cutRow.locator('input[data-price]').count();
		await vp.waitForTimeout(800);
		await vp.locator('[data-slot=totals-rail] [data-save=saved]').filter({ visible: true }).first().waitFor({ timeout: 30_000 });
		await cutRow.scrollIntoViewIfNeeded();
		await shoot(vp, 'round2-vendor-cut-row-1920');
		await vp.getByRole('button', { name: 'Review and submit' }).first().click();
		await vp.getByRole('button', { name: 'Submit answer' }).click();
		await vp.getByText('Submitted.').first().waitFor({ timeout: 20_000 });
		await vctx.close();
		const lines = await sql`select i.code from public.bid_lines l join public.bids b on b.id = l.bid_id join public.request_items i on i.request_id = l.request_id and i.kind = l.item_kind and i.key = l.item_key where l.request_id = ${state.round2Id} and b.status = 'submitted'`;
		expect(
			/Cut this round/.test(cutWords) && cutInputs === 0 && lines.length === 5 && !lines.some((l) => l.code === cut),
			`round 2's vendor form shows ${cut} as "${cutWords.trim()}" with no price field; Vendor A submitted ${lines.length} lines, none for the cut row`
		);
		// The comparison hides cut rows by default; shown, it marks the row cut.
		await page.goto(`${APP}/requests/${state.round2Id}/compare?project=${state.projectId}`);
		await page.waitForLoadState('networkidle');
		const hide = page.getByRole('checkbox', { name: 'Hide cut rows' });
		await hide.waitFor({ timeout: 30_000 });
		await page.locator('[data-slot=item-row]').first().waitFor({ timeout: 30_000 });
		const hiddenFirst = (await page.locator('[data-slot=item-row]', { hasText: cut }).count()) === 0;
		await hide.uncheck();
		const compareRow = page.locator('[data-slot=item-row]', { hasText: cut }).first();
		await compareRow.waitFor({ timeout: 30_000 });
		const compareText = (await compareRow.locator('[role=rowheader]').innerText()).replace(/\s+/g, ' ').trim();
		await shoot(page, 'round2-compare');
		const tag = await compareRow.locator('[data-slot=row-cut]').innerText();
		expect(hiddenFirst && tag.trim() === 'cut', `round 2's comparison hides ${cut} under Hide cut rows; shown, it is tagged "${tag.trim()}": "${compareText}"`);
	},

	async bulk() {
		const rows = page.locator('[data-slot=requests] tbody tr');
		const rowOf = (title) => rows.filter({ has: page.locator('a', { hasText: new RegExp(`^${esc(title)}$`) }) });
		const cells = async (row) => ({
			bids: (await row.locator('[data-slot=row-bids]').getAttribute('title')) ?? '',
			shots: Number((await row.locator('[data-slot=row-shots]').innerText()).replace(/,/g, '')),
			assets: Number((await row.locator('[data-slot=row-assets]').innerText()).replace(/,/g, ''))
		});
		const units = async (table, id) =>
			(
				await sql`select coalesce(sum(unit_count) filter (where kind = 'shot' and not omitted), 0)::int as shots, coalesce(sum(unit_count) filter (where kind = 'asset' and not omitted), 0)::int as assets,
					count(*) filter (where kind = 'shot' and not omitted)::int as "shotRows", count(*) filter (where unit_count > 1 and not omitted)::int as counted
					from ${sql('public.' + table)} where request_id = ${id}`
			)[0];
		const mine = async () => (await sql`select id, status, header->>'title' as title from public.bid_requests where project_id = ${state.projectId} and header->>'title' like ${`zzsgbids drive ${STAMP}%`}`).map((r) => ({ ...r }));

		await page.goto(`${APP}/requests`);
		await page.waitForLoadState('networkidle');
		await rowOf(NAME).waitFor({ timeout: 30_000 });
		// The row's link still opens the request, the box beside it aside.
		await rowOf(NAME).locator('a').click();
		await page.waitForURL((url) => url.pathname.endsWith(`/requests/${state.requestId}`), { timeout: 30_000 });
		prove('the row link opens the request, beside its box');
		await page.goto(`${APP}/requests`);
		await page.waitForLoadState('networkidle');
		await rowOf(NAME).waitFor({ timeout: 30_000 });

		const issued = await cells(rowOf(NAME));
		const issuedUnits = await units('request_items', state.requestId);
		expect(
			issued.bids === 'Seq A, Creature' && issued.shots === issuedUnits.shots && issued.assets === issuedUnits.assets && issuedUnits.counted === 1 && issued.shots === issuedUnits.shotRows - 1 + COUNTED.count,
			`the list names the issued request's bids "${issued.bids}" and counts ${issued.shots} shots by unit (${issuedUnits.shotRows} rows, one standing for ${COUNTED.count}) and ${issued.assets} asset`
		);
		const copy = await cells(rowOf(`${NAME} copy`));
		expect(copy.bids === 'Seq A, Creature' && copy.shots === 0 && copy.assets === 0, `the draft copy without rows lists "${copy.bids}", 0 shots and 0 assets`);

		// The header box ticks what the filters show, and only that.
		await page.getByLabel('Find a request').fill(`zzsgbids drive ${STAMP}`);
		await page.waitForFunction((n) => document.querySelectorAll('[data-slot=requests] tbody tr').length === n, 2, { timeout: 10_000 });
		const before = await page.locator('[data-slot=requests]').boundingBox();
		await page.locator('[data-slot=requests-select-all]').click();
		const count = await page.locator('[data-slot=requests-bulk-count]').innerText();
		const after = await page.locator('[data-slot=requests]').boundingBox();
		const ticked = await page.locator('[data-slot=row-select][aria-checked=true]').count();
		expect(count === '2 selected' && ticked === 2 && before.y === after.y, `the header box ticks the 2 rows the search shows, the bar says "${count}", and the table does not move`);
		await shoot(page, 'requests-two-selected');

		// Duplicate both, with their rows.
		const known = new Set((await mine()).map((r) => r.id));
		await page.locator('[data-slot=requests-bulk-duplicate]').click();
		const dup = page.locator('[data-slot=bulk-duplicate]');
		await dup.waitFor();
		await dup.locator('[data-slot=duplicate-with-rows]').check();
		await shoot(page, 'bulk-duplicate');
		await dup.locator('[data-slot=bulk-duplicate-now]').click();
		const dupLine = await page.locator('[data-slot=bulk-result]', { hasText: /Made \d+ draft cop|Nothing duplicated/ }).innerText({ timeout: 60_000 });
		await page.waitForFunction((n) => document.querySelectorAll('[data-slot=requests] tbody tr').length === n, 4, { timeout: 30_000 });
		const made = (await mine()).filter((r) => !known.has(r.id));
		const copyOfIssued = made.find((r) => r.title === `${NAME} copy`);
		const copyOfCopy = made.find((r) => r.title === `${NAME} copy copy`);
		const draftUnits = copyOfIssued ? await units('production_bid_items', copyOfIssued.id) : null;
		const copyBids = copyOfIssued ? (await sql`select name from public.request_packages where request_id = ${copyOfIssued.id} order by position`).map((b) => b.name).join() : '';
		expect(
			dupLine.startsWith('Made 2 draft copies.') && made.length === 2 && made.every((r) => r.status === 'draft') && copyOfIssued && copyOfCopy && copyBids === 'Seq A,Creature' && draftUnits.shots === issuedUnits.shots && draftUnits.assets === issuedUnits.assets,
			`duplicated two at once with their rows: "${dupLine.split('\n')[0]}", 2 new drafts "${copyOfIssued?.title}" and "${copyOfCopy?.title}", the first with bids ${copyBids} and ${draftUnits?.shots} shots and ${draftUnits?.assets} asset as the issued request`
		);
		const copies = await rows.filter({ has: page.locator('a', { hasText: new RegExp(`^${esc(`${NAME} copy`)}$`) }) }).all();
		const totals = await Promise.all(copies.map(cells));
		expect(
			totals.length === 2 && totals.some((t) => t.shots === issuedUnits.shots && t.assets === issuedUnits.assets && t.bids === 'Seq A, Creature'),
			`the list counts the new draft with its rows as the issued request: ${issuedUnits.shots} shots and ${issuedUnits.assets} asset, by unit`
		);
		await shoot(page, 'bulk-duplicate-result');

		// Shift ticks all four; delete them: drafts and the issued request, behind the typed word.
		const boxes = page.locator('[data-slot=row-select]');
		await boxes.first().click();
		await boxes.last().click({ modifiers: ['Shift'] });
		const four = await page.locator('[data-slot=requests-bulk-count]').innerText();
		await page.locator('[data-slot=requests-bulk-delete]').click();
		const del = page.locator('[data-slot=bulk-delete]');
		await del.locator('[data-slot=bulk-delete-lines]').waitFor({ timeout: 30_000 });
		const lines = await del.locator('[data-slot=bulk-delete-lines]').innerText();
		const disabled = await del.locator('[data-slot=bulk-delete-now]').isDisabled();
		await del.locator('[data-slot=bulk-delete-word]').fill('delete');
		await shoot(page, 'bulk-delete');
		expect(
			four === '4 selected' && disabled && lines.includes('3 drafts') && lines.includes('1 request sent to vendors') && (await del.getAttribute('data-typed')) === 'true',
			`Shift ticks all 4; the one confirm names 3 drafts and 1 request sent to vendors, and stays shut until the word is typed`
		);
		await del.locator('[data-slot=bulk-delete-now]').click();
		const delLine = await page.locator('[data-slot=bulk-result]', { hasText: /Deleted \d+ request|Nothing deleted/ }).innerText({ timeout: 60_000 });
		await page.locator('[data-slot=requests]').waitFor({ state: 'detached', timeout: 30_000 });
		await shoot(page, 'bulk-delete-result');
		const left = await mine();
		expect(delLine.startsWith('Deleted 4 requests.') && left.length === 0, `deleted 4 at once: "${delLine.split('\n')[0]}", and the database holds none of the drive's requests`);
	}
};

async function cleanUp() {
	// Flow PT: anything of the drive's request left behind. The Shots keep their groups as before.
	if (state.requestId && state.bidType) {
		const prefix = `sgbids/${state.requestId}/`;
		const bids = await search(state.bidType, [['sg_sgbids_key', 'starts_with', prefix]], ['code']);
		const lines = await search(state.lineType, [['sg_sgbids_key', 'starts_with', prefix]], ['code']);
		if (bids.length + lines.length > 0) {
			await fpt('POST', '/entity/_batch', { requests: [...lines.map((l) => ({ request_type: 'delete', entity: state.lineType, record_id: l.id })), ...bids.map((b) => ({ request_type: 'delete', entity: state.bidType, record_id: b.id }))] });
			log(`deleted ${bids.length} Bids and ${lines.length} Bid Lines left behind`);
		}
	}
	// The drive's Group, if a failure left it.
	const groups = await search('Group', [['code', 'starts_with', GROUP_NAME]], ['code']);
	for (const g of groups) await fpt('DELETE', `/entity/groups/${g.id}`);
	if (groups.length > 0) log(`retired ${groups.length} Group left behind`);
	if (!state.projectId) return;
	const made = await search('Shot', [['project', 'is', { type: 'Project', id: state.projectId }], ['code', 'starts_with', 'zzsgbids']], ['code']);
	const madeAssets = await search('Asset', [['project', 'is', { type: 'Project', id: state.projectId }], ['code', 'starts_with', 'zzsgbids']], ['code']);
	for (const r of made) await fpt('DELETE', `/entity/shots/${r.id}`);
	for (const r of madeAssets) await fpt('DELETE', `/entity/assets/${r.id}`);
	// The database: the drive's requests, by name, through the app's own delete; frozen rows left by
	// a failure part way go with the triggers off for one transaction.
	const requests = await sql`select id from public.bid_requests where project_id = ${state.projectId} and header->>'title' like ${`zzsgbids drive ${STAMP}%`}`;
	for (const r of requests) {
		await sql`select public.sg_delete_request(${r.id}, site_host, project_id) from public.bid_requests where id = ${r.id}`.catch(() =>
			sql.begin(async (tx) => {
				await tx`set local session_replication_role = replica`;
				for (const table of ['bid_rates', 'awards', 'award_publications', 'award_scenario_items', 'award_scenarios', 'bid_lines', 'bids', 'invitations', 'request_items', 'request_packages', 'production_bid_items', 'production_bids']) {
					await tx`delete from ${tx('public.' + table)} where request_id = ${r.id}`;
				}
				await tx`delete from public.bid_requests where id = ${r.id}`;
			})
		);
	}
	const [left] = await sql`select (select count(*) from public.bid_requests where project_id = ${state.projectId} and header->>'title' like ${`zzsgbids drive ${STAMP}%`}) + (select count(*) from public.production_bids where project_id = ${state.projectId} and request_id is null) as n`;
	const fptLeft = state.requestId && state.bidType ? (await search(state.bidType, [['sg_sgbids_key', 'starts_with', `sgbids/${state.requestId}/`]], ['code'])).length : 0;
	const groupsLeft = (await search('Group', [['code', 'starts_with', GROUP_NAME]], ['code'])).length;
	expect(
		Number(left.n) === 0 && fptLeft === 0 && groupsLeft === 0,
		`clean: ${requests.length} requests deleted in the drive's database, ${made.length + madeAssets.length} zzsgbids rows deleted in Flow PT, no Bid and no Group of the drive left in Flow PT`
	);
}

let failed = null;
try {
	app = await startApp();
	browser = await chromium.launch();
	ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
	page = await ctx.newPage();
	page.on('pageerror', (e) => log('page error:', e.message.slice(0, 200)));
	for (const name of ['pre', 'newRequest', 'bids', 'vendors', 'groupCreate', 'issue', 'vendorA', 'vendorB', 'compare', 'publish', 'readBack', 'undo', 'duplicate', 'nextRound', 'bulk']) {
		log('stage', name);
		await stages[name]();
	}
} catch (error) {
	failed = error;
	await page?.screenshot({ path: `${OUT}failure.png` }).catch(() => {});
	console.error('[e2e] FAILED:', error.message);
} finally {
	try {
		if (!env.E2E_KEEP) await cleanUp();
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
