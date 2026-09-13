#!/usr/bin/env node
/**
 * Prove the land detail is on the screen, not merely in the style.
 *
 * `queryRenderedFeatures` answering 400 proves the tiles arrived and the filter
 * matched. It does not prove a single pixel changed, and the failure this project
 * has already paid for twice is exactly that gap: a layer that is present,
 * queryable and invisible. So the measurement here is differential. The same
 * patch of the drawing buffer is read with the land layers visible and again with
 * them hidden, and the check is how many pixels moved.
 *
 * It then rebuilds the style through a real control, because `setStyle` empties
 * the image registry and resets every source, and re-measures. A layer that only
 * survives the first style is the same bug wearing a different hat.
 *
 * Usage: node pipeline/scripts/verify-land.mjs <url> [--shots docs/shots] [--at lng,lat,zoom]
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5204/';
const flag = (name) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? undefined : process.argv[at + 1];
};
const shotDir = flag('--shots');
if (shotDir) mkdirSync(shotDir, { recursive: true });

/** The Ter mouth and the Pletera lagoons, a kilometre from Illes Medes. River, wetland and streams in one frame. */
const at = (flag('--at') ?? '3.19,42.035,13').split(',').map(Number);

const LAND_LAYERS = ['land-water', 'land-water-edge', 'land-waterway'];

const VIEWPORTS = [
	{ name: 'desktop', width: 1440, height: 900 },
	{ name: 'phone', width: 390, height: 844 }
];

const only = flag('--only');
const browser = await chromium.launch();
const report = { url, at, viewports: [] };
let failures = 0;

for (const viewport of only === 'a3' ? [] : VIEWPORTS) {
	const context = await browser.newContext({
		viewport: { width: viewport.width, height: viewport.height }
	});
	// The page reloads itself when a new worker claims it, which lands mid-measure
	// as a destroyed execution context. The land tiles are read over ranges from the
	// same origin either way, so the worker has nothing to contribute to this check.
	await context.addInitScript(() => {
		Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined });
	});
	const page = await context.newPage();
	const errors = [];
	const failed = [];
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text().slice(0, 160));
	});
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
	page.on('response', (r) => {
		if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 110)}`);
	});

	await page.goto(url, { waitUntil: 'domcontentloaded' });

	const measure = async (label) =>
		page.evaluate(
			async ({ camera, layers, settle }) => {
				const wait = (ms) => new Promise((r) => setTimeout(r, ms));
				const deadline = Date.now() + 45_000;
				let canvas = null;
				while (Date.now() < deadline) {
					canvas = document.querySelector('.maplibregl-canvas');
					if (canvas && window.diveMap) break;
					await wait(300);
				}
				const map = window.diveMap;
				const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
				if (!map || !gl) return { error: 'no map handle or no gl context' };
				const read = () => {
					const w = Math.min(640, canvas.width);
					const h = Math.min(640, canvas.height);
					const x = Math.floor((canvas.width - w) / 2);
					const y = Math.floor((canvas.height - h) / 2);
					const px = new Uint8Array(w * h * 4);
					gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
					return px;
				};

				if (camera) {
					map.jumpTo({ center: [camera[0], camera[1]], zoom: camera[2] });
					await wait(settle);
				}
				await wait(1500);

				const present = layers.filter((id) => map.getLayer(id) !== undefined);
				const counts = {};
				for (const id of present) counts[id] = map.queryRenderedFeatures({ layers: [id] }).length;

				const shown = read();
				for (const id of present) map.setLayoutProperty(id, 'visibility', 'none');
				map.triggerRepaint();
				await wait(1200);
				const hidden = read();
				for (const id of present) map.setLayoutProperty(id, 'visibility', 'visible');
				map.triggerRepaint();
				await wait(1200);

				let moved = 0;
				for (let i = 0; i < shown.length; i += 4) {
					const d =
						Math.abs(shown[i] - hidden[i]) +
						Math.abs(shown[i + 1] - hidden[i + 1]) +
						Math.abs(shown[i + 2] - hidden[i + 2]);
					if (d > 12) moved++;
				}
				return { missing: layers.filter((id) => !present.includes(id)), counts, movedPixels: moved, samples: shown.length / 4 };
			},
			{ camera: at, layers: LAND_LAYERS, settle: label === 'initial' ? 20_000 : 6000 }
		);

	const initial = await measure('initial');

	// The real control, not a style call: this is the path the user reported
	// breaking, and it is the one that empties the image registry.
	await page.getByRole('button', { name: /layers|capes|capas/i }).first().click();
	await page.waitForTimeout(600);
	await page.getByRole('button', { name: /relief|ombrejat|sombreado/i }).first().click();
	await page.waitForTimeout(2500);
	const rebuilt = await measure('rebuilt');

	if (shotDir) {
		// Put the map back the way a reader would see it. A shot with the panel over
		// half the frame and the relief switched off is evidence of the test, not of
		// the map.
		await page.getByRole('button', { name: /relief|ombrejat|sombreado/i }).first().click();
		await page.waitForTimeout(2500);
		await page.keyboard.press('Escape');
		await page.waitForTimeout(2500);
		await page.screenshot({ path: `${shotDir}/land-${viewport.name}.png` });
	}

	const ok =
		initial.movedPixels > 400 &&
		rebuilt.movedPixels > 400 &&
		(initial.missing ?? []).length === 0 &&
		errors.length === 0 &&
		failed.length === 0;
	if (!ok) failures++;
	report.viewports.push({ ...viewport, ok, initial, rebuilt, errors: errors.slice(0, 6), failed: failed.slice(0, 6) });
	await context.close();
}

/**
 * And the same thing on an A3 sheet, which is the artefact this map exists to
 * produce. The print path opens a second map offscreen at pixelRatio 2 and
 * re-registers every image, so it is an entirely separate chance for a layer to
 * go missing, and nothing on screen would say so.
 *
 * The measurement is hue, not colour matching. The sheet is a JPEG inside a PDF
 * and then a `sips` raster, so exact values do not survive. What does survive is
 * that painted land is warm and every drop of water on it is cool: the land fill
 * composites to a green a few points under its red, inland water to a green ten
 * points over it. Counting that one inequality catches open water and marsh
 * alike and rejects the land, the chrome, the brass and the paper.
 *
 * The camera is chosen so an A3 at 1:2000 lands entirely inland, which is what
 * makes a whole-sheet count meaningful. Move it over water and this fails loudly
 * rather than passing on the sea.
 */
const exportSheet = async () => {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	await context.addInitScript(() => {
		Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined });
	});
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
	await page.goto(url, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => Boolean(window.diveMap), undefined, { timeout: 90_000 });
	await page.evaluate((camera) => {
		window.diveMap.jumpTo({ center: [camera[0], camera[1]], zoom: camera[2] });
	}, at);
	await page.waitForTimeout(9000);

	await page.getByRole('button', { name: /^Print$/ }).first().click();
	await page.waitForTimeout(500);
	const download = page.waitForEvent('download', { timeout: 260_000 }).catch(() => undefined);
	await page.getByRole('button', { name: /^Export PDF$/ }).first().click();
	const file = await download;
	if (file === undefined) {
		await context.close();
		return { ok: false, error: 'the A3 export produced no file' };
	}
	const saved = join(tmpdir(), `land-${Date.now()}.pdf`);
	await file.saveAs(saved);
	const png = `${saved}.png`;
	execFileSync('sips', ['-s', 'format', 'png', '--resampleHeightWidthMax', '2000', saved, '--out', png]);

	const share = await page.evaluate(async (src) => {
		const image = new Image();
		await new Promise((resolve, reject) => {
			image.onload = resolve;
			image.onerror = reject;
			image.src = src;
		});
		// The map area, less the strip along the foot where the scale bar, the
		// disclaimer and the attribution sit.
		const w = image.width;
		const h = Math.round(image.height * 0.86);
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const context2d = canvas.getContext('2d');
		context2d.drawImage(image, 0, 0, w, h, 0, 0, w, h);
		const { data } = context2d.getImageData(0, 0, w, h);
		let cool = 0;
		for (let i = 0; i < data.length; i += 4) if (data[i + 1] - data[i] > 6) cool++;
		return { crop: [w, h], cool, of: data.length / 4 };
	}, `data:image/png;base64,${readFileSync(png).toString('base64')}`);

	await context.close();
	const fraction = share.cool / share.of;
	return {
		// Bare painted land measures well under a percent. A sheet that had drifted
		// onto the sea would measure most of itself, which is the other failure.
		ok: fraction > 0.02 && fraction < 0.6 && errors.length === 0,
		pdf: saved,
		coolFraction: Number(fraction.toFixed(4)),
		...share,
		errors
	};
};

if (only !== 'screen') {
	report.a3 = await exportSheet();
	if (!report.a3.ok) failures++;
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
process.exit(failures === 0 ? 0 : 1);
