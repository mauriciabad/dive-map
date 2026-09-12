#!/usr/bin/env node
/**
 * Drag the map somewhere useless and check it refuses.
 *
 * The guard has to hold two things at once and only one of them is a geometry
 * question. Data must stay on screen wherever you drag, which a layer query
 * answers. And a drag inside the valid area must still move the map the full
 * distance the mouse moved, because a guard that quietly drags its heels is
 * worse than no guard. Both are measured here from real mouse events rather
 * than from jumpTo, which skips the handlers that do the work.
 *
 * Usage: node pipeline/scripts/verify-camera.mjs <url> [--shot out.png]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5181/';
const shotAt = process.argv.indexOf('--shot');
const shot = shotAt === -1 ? undefined : process.argv[shotAt + 1];

const DRAWN = ['ground-habitats-fill', 'seabed-unmapped', 'isobath', 'land'];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(m.text().slice(0, 160));
});
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.diveMap !== undefined, undefined, { timeout: 60_000 });

await page.evaluate(async () => {
	window.diveMap.jumpTo({ center: [3.2035, 41.9155], zoom: 15 });
	await new Promise((r) => setTimeout(r, 6000));
});

const state = () =>
	page.evaluate(() => {
		const m = window.diveMap;
		const c = m.getCenter();
		return { lng: +c.lng.toFixed(4), lat: +c.lat.toFixed(4), zoom: +m.getZoom().toFixed(2) };
	});

const drawn = () =>
	page.evaluate((layers) => {
		const m = window.diveMap;
		return layers.reduce((total, id) => {
			try {
				return total + m.queryRenderedFeatures({ layers: [id] }).length;
			} catch {
				return total;
			}
		}, 0);
	}, DRAWN);

const drag = async (dx, dy) => {
	const box = { x: 640, y: 430 };
	await page.mouse.move(box.x, box.y);
	await page.mouse.down();
	for (let step = 1; step <= 12; step++) {
		await page.mouse.move(box.x + (dx * step) / 12, box.y + (dy * step) / 12);
	}
	await page.mouse.up();
	await page.waitForTimeout(1200);
};

const before = await state();
await drag(-420, -260);
const after = await state();
const moved = await page.evaluate(
	({ before, after }) => {
		const m = window.diveMap;
		const a = m.project([before.lng, before.lat]);
		const b = m.project([after.lng, after.lat]);
		return Math.round(Math.hypot(a.x - b.x, a.y - b.y));
	},
	{ before, after }
);

await page.evaluate(async () => {
	window.diveMap.jumpTo({ center: [3.2035, 41.9155], zoom: 11 });
	await new Promise((r) => setTimeout(r, 4000));
});

const trail = [];
for (let i = 0; i < 14; i++) {
	// South-east, into the empty quadrant the bounding box of the survey would allow.
	await drag(-560, -340);
	trail.push({ ...(await state()), drawn: await drawn() });
}

await page.evaluate(() => window.diveMap.setZoom(2));
await page.waitForTimeout(2500);
const zoomedOut = { ...(await state()), drawn: await drawn() };

if (shot) {
	mkdirSync(dirname(shot), { recursive: true });
	await page.screenshot({ path: shot });
}
await browser.close();

const emptyFrames = trail.filter((t) => t.drawn === 0);
const slip = Math.abs(moved - Math.round(Math.hypot(420, 260)));
const result = {
	url,
	freeDragPixels: moved,
	freeDragSlip: slip,
	framesDragged: trail.length,
	emptyFrames: emptyFrames.length,
	restingAt: trail[trail.length - 1],
	zoomedOut,
	consoleErrors: errors.slice(0, 4)
};
const pass = emptyFrames.length === 0 && slip <= 4 && zoomedOut.drawn > 0 && zoomedOut.zoom > 3;
console.log(JSON.stringify({ pass, ...result }, null, 2));
process.exit(pass ? 0 : 1);
