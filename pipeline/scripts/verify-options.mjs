#!/usr/bin/env node
/**
 * Exercise the settings the user reported broken, through the real controls.
 *
 * The bug this caught: switching the ground layer swapped a layer's `source`,
 * which MapLibre's style diff cannot express, so the switch silently did nothing
 * while every other check stayed green.
 *
 * Usage: node pipeline/scripts/verify-options.mjs <url> [--shot dir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5179/';
const shotAt = process.argv.indexOf('--shot');
const shotDir = shotAt === -1 ? undefined : process.argv[shotAt + 1];
if (shotDir) mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 140)}`));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(22_000);

const counts = async () =>
	page.evaluate(async () => {
		await new Promise((r) => setTimeout(r, 3500));
		const m = window.diveMap;
		const at = (id) => {
			try { return m.queryRenderedFeatures({ layers: [id] }).length; } catch { return -1; }
		};
		const label = m.queryRenderedFeatures({ layers: ['osm-dive-site-label'] })[0];
		return {
			habitats: at('ground-habitats-fill'),
			substrate: at('ground-substrate-fill'),
			isobath: at('isobath'),
			sampleLabel: label?.properties?.name ?? null
		};
	});

const open = async (name) => {
	await page.getByRole('button', { name }).first().click();
	await page.waitForTimeout(500);
};

const result = { steps: [] };

result.steps.push({ step: 'initial', ...(await counts()) });

await open(/layers|capes|capas/i);
await page.getByRole('button', { name: /seafloor type|tipus de fons|tipo de fondo/i }).first().click();
result.steps.push({ step: 'switched to seafloor type', ...(await counts()) });

await page.getByRole('button', { name: /^habitats$|hàbitats|hábitats/i }).first().click();
result.steps.push({ step: 'switched back to habitats', ...(await counts()) });

await open(/language|idioma/i);
await page.getByRole('button', { name: 'English' }).first().click();
result.steps.push({ step: 'locale English', ...(await counts()) });

/*
 * The bug this exists to catch: every setStyle empties MapLibre's image registry,
 * so a pattern that is not put back leaves the seabed flat. It only showed on the
 * second change, which is why toggling once looked fine.
 */
result.textures = await page.evaluate(async () => {
	const m = window.diveMap;
	const spread = () => {
		const c = m.getCanvas();
		const gl = c.getContext('webgl2') ?? c.getContext('webgl');
		const w = 240, h = 240;
		const px = new Uint8Array(w * h * 4);
		gl.readPixels(Math.floor(c.width * 0.35), Math.floor(c.height * 0.45), w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
		let sum = 0, sumSq = 0, n = 0;
		for (let i = 0; i < px.length; i += 4) {
			const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
			sum += l; sumSq += l * l; n++;
		}
		const mean = sum / n;
		return +Math.sqrt(sumSq / n - mean * mean).toFixed(2);
	};
	const seen = [];
	for (let i = 0; i < 6; i++) {
		m.setLayoutProperty('hillshade', 'visibility', i % 2 === 0 ? 'none' : 'visible');
		m.setLayoutProperty('isobath', 'visibility', i % 3 === 0 ? 'none' : 'visible');
		await new Promise((r) => setTimeout(r, 1800));
		seen.push({ round: i, hasPattern: m.hasImage('ch_grass'), spread: spread() });
	}
	return seen;
});

result.attribution = await page.evaluate(() => {
	const el = document.querySelector('.maplibregl-ctrl-attrib');
	const btn = document.querySelector('.maplibregl-ctrl-attrib-button');
	return {
		links: [...(el?.querySelectorAll('a') ?? [])].map((a) => a.textContent?.trim()).slice(0, 6),
		buttonVisible: btn ? getComputedStyle(btn).backgroundImage === 'none' : null
	};
});

if (shotDir) await page.screenshot({ path: `${shotDir}/options.png` });
await browser.close();

const grounds = result.steps;
const switched = (grounds[1]?.substrate ?? 0) > 0 && (grounds[1]?.habitats ?? -1) === 0;
const switchedBack = (grounds[2]?.habitats ?? 0) > 0 && (grounds[2]?.substrate ?? -1) === 0;
const patternsHeld = result.textures.every((r) => r.hasPattern && r.spread > 8);
const ok =
	switched && switchedBack && patternsHeld && result.attribution.links.length >= 3 && errors.length === 0;

console.log(JSON.stringify({ url, ok, switched, switchedBack, patternsHeld, ...result, consoleErrors: errors.slice(0, 5) }, null, 2));
process.exit(ok ? 0 : 1);
