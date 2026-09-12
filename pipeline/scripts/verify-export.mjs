#!/usr/bin/env node
/**
 * Drive the real print path and check the PDF that falls out.
 *
 * Everything about this feature can look fine and still produce an A3 sheet that
 * is blank, the wrong size, or silently downscaled: MapLibre clamps an oversized
 * canvas without telling you, and `getPixelRatio()` keeps reporting the value you
 * asked for. So this opens the page, frames a sheet, exports it, and reads the
 * bytes back.
 *
 * Usage: node pipeline/scripts/verify-export.mjs <url> [--out dir]
 */
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5179/';
const outAt = process.argv.indexOf('--out');
const outDir = outAt === -1 ? '/tmp/dive-export' : process.argv[outAt + 1];
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
	acceptDownloads: true
});
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(22_000);

const framed = await page.evaluate(() => {
	const m = window.diveMap;
	if (!m) return { error: 'no map handle' };
	m.jumpTo({ center: [3.2147, 41.9083], zoom: 15.5 });
	return { ok: true };
});
if (framed.error) {
	console.log(JSON.stringify({ url, ok: false, ...framed }, null, 2));
	await browser.close();
	process.exit(1);
}
await page.waitForTimeout(8000);

// Open the print section and turn framing on through the real controls.
await page.getByRole('button', { name: /print|imprimir/i }).first().click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: /frame a sheet|enquadrar|encuadrar/i }).first().click();
await page.waitForTimeout(1500);

const download = page.waitForEvent('download', { timeout: 180_000 });
await page.getByRole('button', { name: /export pdf|exportar pdf/i }).first().click();

let saved;
try {
	const file = await download;
	saved = join(outDir, file.suggestedFilename());
	await file.saveAs(saved);
} catch (e) {
	console.log(JSON.stringify({ url, ok: false, stage: 'download', error: String(e).slice(0, 200), consoleErrors: errors.slice(0, 6) }, null, 2));
	await browser.close();
	process.exit(1);
}

const diag = await page.evaluate(() => window.lastRender ?? null);
await browser.close();

const bytes = statSync(saved).size;
const { readFileSync } = await import('node:fs');
const head = readFileSync(saved).subarray(0, 2048).toString('latin1');
const mediaBox = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(head);
const mm = (pt) => +(Number(pt) * 25.4 / 72).toFixed(1);
const size = mediaBox ? { widthMm: mm(mediaBox[3]), heightMm: mm(mediaBox[4]) } : undefined;

// A3 portrait is 297 x 420 mm.
const isA3 = size !== undefined && Math.abs(size.widthMm - 297) < 2 && Math.abs(size.heightMm - 420) < 2;
const ok = bytes > 200_000 && isA3 && head.startsWith('%PDF');

console.log(JSON.stringify({ url, ok, file: saved, bytes, size, isA3, isPdf: head.startsWith('%PDF'), render: diag, consoleErrors: errors.slice(0, 6) }, null, 2));
process.exit(ok ? 0 : 1);
