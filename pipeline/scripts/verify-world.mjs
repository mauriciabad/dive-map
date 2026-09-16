#!/usr/bin/env node
/**
 * Prove the map no longer ends in a straight line.
 *
 * Since the map started opening fully zoomed out, the first thing anyone sees is
 * the whole survey, and Catalonia was a grey rectangle with three ruler-straight
 * edges on it: the cuts at the French and Valencian borders and the synthetic
 * inland closure that shuts the mainland polygon. A feature count cannot tell you
 * those are gone. Reading the pixel where Mallorca should be can.
 *
 * Every probe is a real place, projected to its own screen position and read out
 * of the drawing buffer, in the fully zoomed-out frame people actually meet the
 * map in. Land probes have to come back warm and sea probes cool, and it is the
 * pair that separates "the basemap drew" from "everything drew land".
 *
 * Usage: node pipeline/scripts/verify-world.mjs <url> [--shots docs/shots]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5204/';
const flag = (name) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? undefined : process.argv[at + 1];
};
const shotDir = flag('--shots');
if (shotDir) mkdirSync(shotDir, { recursive: true });

/**
 * The opening view, and the places that have to be in it.
 *
 * Each land probe is on the far side of one of the three straight edges, and the
 * sea probes are the control: without them a style that painted the whole frame
 * brown would pass.
 *
 * Which probes run depends on the viewport, because the minimum zoom is whatever
 * fits the survey and that is a different frame on each. A laptop lands at about
 * z7.7 and gets a wide, shallow band that reaches Aragon and stops short of
 * France; a phone lands at about z6.4 and gets a tall, narrow one that reaches
 * Narbonne and Mallorca and stops short of Aragon. The report carries the bounds
 * so a probe that falls out of frame later says why.
 */
const PROBES = [
	{ name: 'Castello, past the Valencian cut', at: [0.32, 40.45], want: 'land' },
	{ name: 'open sea off the Costa Brava', at: [3.4, 41.6], want: 'sea' },
	{ name: 'open sea south of the Ebre', at: [1.2, 40.5], want: 'sea' },
	{ name: 'Narbonne, past the French cut', at: [3.0, 43.0], want: 'land', on: 'phone' },
	{ name: 'Mallorca', at: [2.9, 39.6], want: 'land', on: 'phone' },
	{ name: 'Eivissa', at: [1.43, 38.95], want: 'land', on: 'phone' },
	{ name: 'Aragon, past the inland closure', at: [-0.2, 41.5], want: 'land', on: 'desktop' }
];

const VIEWPORTS = [
	{ name: 'desktop', width: 1440, height: 900 },
	{ name: 'phone', width: 390, height: 844 }
];

const browser = await chromium.launch();
const report = { url, viewports: [] };
let failures = 0;

for (const viewport of VIEWPORTS) {
	const context = await browser.newContext({
		viewport: { width: viewport.width, height: viewport.height }
	});
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
	await page.waitForFunction(() => Boolean(window.diveMap), undefined, { timeout: 90_000 });

	const result = await page.evaluate(
		async ({ probes, viewport }) => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const map = window.diveMap;
			const canvas = document.querySelector('.maplibregl-canvas');
			const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
			map.jumpTo({ center: [1.9, 41.4], zoom: map.getMinZoom() });
			await wait(16_000);

			// project() answers in CSS pixels from the top left; readPixels counts
			// device pixels from the bottom left.
			const ratio = canvas.width / canvas.clientWidth;
			const read = (point) => {
				const x = Math.round(point.x * ratio);
				const y = Math.round(canvas.height - point.y * ratio);
				if (x < 5 || y < 5 || x > canvas.width - 5 || y > canvas.height - 5) return undefined;
				const px = new Uint8Array(9 * 9 * 4);
				gl.readPixels(x - 4, y - 4, 9, 9, gl.RGBA, gl.UNSIGNED_BYTE, px);
				const sum = [0, 0, 0];
				for (let i = 0; i < px.length; i += 4) {
					sum[0] += px[i];
					sum[1] += px[i + 1];
					sum[2] += px[i + 2];
				}
				const n = px.length / 4;
				return sum.map((v) => Math.round(v / n));
			};

			const measured = probes.map((probe) => {
				if (probe.on !== undefined && probe.on !== viewport)
					return { ...probe, reads: 'n/a', ok: true };
				const point = map.project(probe.at);
				const rgb = read(point);
				// Painted land is warm, red over blue. Every sea on this map is the other
				// way round, void and veiled seabed alike.
				const reads = rgb === undefined ? 'offscreen' : rgb[0] > rgb[2] ? 'land' : 'sea';
				return { ...probe, rgb, reads, ok: reads === probe.want };
			});

			// A straight edge across the land is what this whole layer exists to remove,
			// and it is not something a feature count can see. So walk the painted land
			// looking for a pixel that disagrees with what sits three along from it on
			// both sides while those two agree with each other. Painted rock varies by a
			// point or two; an outline pass or a clipped polygon edge jumps by twenty.
			//
			// Isolated hits are not the thing: a harbour mole, a river mouth and the
			// shoreline stroke all produce them and all of them are real. What makes a
			// seam a seam is that it is straight and long, so the hits are counted per
			// column and per row and the verdict is the tallest stack. The rectangle
			// this replaced stacked a hundred rows deep at one longitude.
			const seams = [];
			{
				const w = canvas.width;
				const h = canvas.height;
				const band = new Uint8Array(w * 4);
				for (let row = Math.round(h * 0.12); row < h * 0.92; row += 7) {
					gl.readPixels(0, row, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, band);
					for (let x = 4; x < w - 4; x++) {
						const here = band[x * 4];
						const before = band[(x - 3) * 4];
						const after = band[(x + 3) * 4];
						// Both sides have to be flat painted land. That rules out the sea,
						// which is full of legitimate hard edges, and the one-pixel spits of
						// the Ebre delta, which are a real coast and not a seam.
						const land = (v) => v > 60 && v < 110;
						if (!land(before) || !land(after) || Math.abs(before - after) > 6) continue;
						if (Math.abs(here - (before + after) / 2) > 12) {
							seams.push({ x, y: canvas.height - row, here, before, after });
						}
					}
				}
			}

			const stack = (key) => {
				const counts = new Map();
				for (const seam of seams) counts.set(seam[key], (counts.get(seam[key]) ?? 0) + 1);
				let worst = { at: 0, hits: 0 };
				for (const [at, hits] of counts) if (hits > worst.hits) worst = { at, hits };
				return worst;
			};

			const bounds = map.getBounds();
			return {
				seamPixels: seams.length,
				tallestColumn: stack('x'),
				tallestRow: stack('y'),
				zoom: Number(map.getZoom().toFixed(2)),
				bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].map(
					(v) => Number(v.toFixed(2))
				),
				worldLand: map.queryRenderedFeatures({ layers: ['world-land'] }).length,
				worldCoast: map.queryRenderedFeatures({ layers: ['world-coast'] }).length,
				probes: measured
			};
		},
		{ probes: PROBES, viewport: viewport.name }
	);

	if (shotDir) await page.screenshot({ path: `${shotDir}/world-${viewport.name}.png` });

	const ok =
		result.worldLand > 0 &&
		result.worldCoast > 0 &&
		// Sized against what the artefact actually produced. Its vertical segment ran
		// 757 px down one longitude, which at a seven-row stride is about a hundred
		// hits in one column; its horizontal segments ran 170 px along one latitude.
		// A row that merely crosses the coast at a diagonal collects a handful, and a
		// column almost never collects more than two.
		result.tallestColumn.hits < 8 &&
		result.tallestRow.hits < 40 &&
		result.probes.every((probe) => probe.ok) &&
		errors.length === 0 &&
		failed.length === 0;
	if (!ok) failures++;
	report.viewports.push({
		...viewport,
		ok,
		...result,
		errors: errors.slice(0, 6),
		failed: failed.slice(0, 6)
	});
	await context.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
process.exit(failures === 0 ? 0 : 1);
