// The share image and the icons, drawn by headless Chromium.
//
//   pnpm og            the icons, then the share image
//   pnpm og --icons    the icons only
//
// The share image is the page `/dev/og` (dev only), a 1200 by 630 card in the default theme: the
// name, one line, and the real comparison grid on demo data. This starts `vite dev` on port 5188
// for it, or uses the app at OG_BASE when set. It writes static/og.png, and the same card at 400
// wide to shots/og-400.png (gitignored), to check it reads at the size of a chat preview.
//
// The icons come from static/favicon.svg with the light palette pinned: apple-touch-icon.png (180,
// on the light ground, as iOS shows no transparency) and favicon.ico (16, 32 and 48 PNGs).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const ICONS_ONLY = process.argv.includes('--icons');
const PORT = 5188;

const svg = readFileSync('static/favicon.svg', 'utf8');
// The light values only: a PNG holds one scheme, and the light one reads on both.
const lightSvg = svg.replace(/@media \(prefers-color-scheme:dark\)\{(?:[^{}]*\{[^}]*\})*\}/, '');

const browser = await chromium.launch();

async function draw(size, { ground = 'transparent', inset = 0 } = {}) {
	const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
	const pad = Math.round(size * inset);
	await page.setContent(
		`<html><body style="margin:0;background:${ground}"><div style="width:${size}px;height:${size}px;box-sizing:border-box;padding:${pad}px">${lightSvg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`
	);
	const png = await page.screenshot({ omitBackground: ground === 'transparent' });
	await page.close();
	return png;
}

/** An .ico holding PNG images, as every browser since IE Vista reads it. */
function ico(images) {
	const header = Buffer.alloc(6 + images.length * 16);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);
	let offset = header.length;
	images.forEach(({ size, png }, i) => {
		const at = 6 + i * 16;
		header.writeUInt8(size >= 256 ? 0 : size, at);
		header.writeUInt8(size >= 256 ? 0 : size, at + 1);
		header.writeUInt8(0, at + 2);
		header.writeUInt8(0, at + 3);
		header.writeUInt16LE(1, at + 4);
		header.writeUInt16LE(32, at + 6);
		header.writeUInt32LE(png.length, at + 8);
		header.writeUInt32LE(offset, at + 12);
		offset += png.length;
	});
	return Buffer.concat([header, ...images.map((image) => image.png)]);
}

writeFileSync('static/apple-touch-icon.png', await draw(180, { ground: '#f5f5f5', inset: 0.14 }));
const sizes = [16, 32, 48];
writeFileSync('static/favicon.ico', ico(await Promise.all(sizes.map(async (size) => ({ size, png: await draw(size) })))));
console.log('static/apple-touch-icon.png static/favicon.ico');

if (!ICONS_ONLY) {
	let server = null;
	let base = process.env.OG_BASE;
	if (!base) {
		base = `http://localhost:${PORT}`;
		server = spawn('node_modules/.bin/vite', ['dev', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'ignore', 'inherit'] });
		let stopped = null;
		server.on('exit', (code) => (stopped = code));
		// Up when it answers; a minute at most.
		for (let i = 0; ; i++) {
			if (stopped !== null) throw new Error(`vite dev stopped (${stopped})`);
			if (i > 120) throw new Error('vite dev did not answer in a minute');
			const up = await fetch(base).then(() => true, () => false);
			if (up) break;
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}
	try {
		const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: 'light' });
		const errors = [];
		page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
		page.on('pageerror', (e) => errors.push(String(e)));
		await page.goto(`${base}/dev/og`, { waitUntil: 'networkidle' });
		await page.evaluate(() => document.fonts.ready);
		await page.locator('[data-slot="og-card"]').waitFor();
		await page.waitForTimeout(500);
		const card = page.locator('[data-slot="og-card"]');
		await card.screenshot({ path: 'static/og.png' });
		console.log('static/og.png');
		// How it reads in a chat preview: the same card at a third of its size.
		mkdirSync('shots', { recursive: true });
		const small = await browser.newPage({ viewport: { width: 400, height: 210 }, deviceScaleFactor: 1 });
		const data = readFileSync('static/og.png').toString('base64');
		await small.setContent(`<html><body style="margin:0"><img src="data:image/png;base64,${data}" width="400" height="210"></body></html>`);
		await small.screenshot({ path: 'shots/og-400.png' });
		console.log('shots/og-400.png');
		if (errors.length) {
			console.error(errors.join('\n'));
			process.exitCode = 1;
		}
	} finally {
		server?.kill();
	}
}

await browser.close();
