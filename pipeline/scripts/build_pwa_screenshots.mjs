#!/usr/bin/env node
/**
 * Shoot the two screenshots Chrome's richer install UI wants, off the real app.
 *
 * A manifest with no `screenshots` key gets a plainer install prompt: Chrome
 * warns for `form_factor: "wide"` (desktop) and for narrow (mobile, the default
 * when `form_factor` is unset) separately, so both have to be present. Hand
 * cropping a screenshot goes stale the moment the map's look changes, so this
 * drives a real browser to the real app instead, the way
 * `pipeline/scripts/build_og_image.mjs` already does for the share card.
 *
 * Unlike the share card, these are meant to show the app as installed, controls
 * and all, so the page is screenshotted whole rather than lifted off the map
 * canvas. The camera is zoomed in from the start so the first-run hints, which
 * only show at a wide-open zoom, never enter the shot.
 *
 * Needs the frozen dev server: readiness is read off `window.diveMap`, which
 * only exists under `import.meta.env.DEV`.
 *
 *     pnpm exec vite dev --config pipeline/config/vite-frozen.js --port 5220
 *     node pipeline/scripts/build_pwa_screenshots.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const flag = (name, fallback) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? fallback : process.argv[at + 1];
};

const url = flag('--url', 'http://localhost:5220/');
const at = flag('--at', '14.68/42.045/3.2155');
const outDir = flag('--out', 'static/screenshots');

/** Chrome's richer install UI, one shot per form factor it asks for. */
const SHOTS = [
	{ file: 'wide.jpg', formFactor: 'wide', width: 1280, height: 800 },
	{ file: 'narrow.jpg', formFactor: null, width: 720, height: 1280 }
];

const settle = async (page) => {
	await page.waitForFunction(
		() => document.querySelector('.maplibregl-canvas') !== null && window.diveMap !== undefined,
		null,
		{ timeout: 90_000 }
	);
	await page.waitForFunction(
		() => {
			const map = window.diveMap;
			return map.loaded() && map.areTilesLoaded();
		},
		null,
		{ timeout: 90_000, polling: 400 }
	);
	// A few settled frames in a row, same threshold build_og_image.mjs uses, so a
	// tile that finishes loading and immediately triggers another paint is not
	// mistaken for done.
	await page.evaluate(async () => {
		const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		let steady = 0;
		while (steady < 4) {
			await wait(400);
			steady = window.diveMap.loaded() && window.diveMap.areTilesLoaded() ? steady + 1 : 0;
		}
	});
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
	);
};

const browser = await chromium.launch();
const results = [];

for (const shot of SHOTS) {
	const context = await browser.newContext({
		viewport: { width: shot.width, height: shot.height }
	});
	const page = await context.newPage();
	const problems = [];
	page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 160)}`));
	page.on('response', (r) => {
		if (r.status() >= 400) problems.push(`${r.status()} ${r.url().slice(0, 110)}`);
	});

	await page.goto(`${url}?map=${at}`, { waitUntil: 'domcontentloaded' });
	await settle(page);

	const dest = `${outDir}/${shot.file}`;
	mkdirSync(dirname(dest), { recursive: true });
	await page.screenshot({ path: dest, type: 'jpeg', quality: 85 });

	results.push({ ...shot, path: dest, bytes: statSync(dest).size, problems: problems.slice(0, 4) });
	await context.close();
}

await browser.close();

console.log(JSON.stringify({ url, at, shots: results }, null, 2));

const failed = results.some((r) => r.problems.length > 0);
process.exit(failed ? 1 : 0);
