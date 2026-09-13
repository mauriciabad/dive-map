#!/usr/bin/env node
/**
 * Hover the seabed and check the readout says what the contours say.
 *
 * Two things to prove. The number has to match the isobaths drawn under the
 * cursor, because a depth that disagrees with the lines on screen is worse than
 * no depth at all. And it must not exist on touch, where there is no hover and
 * the readout would sit over the seabed the finger is covering.
 *
 * Usage: node pipeline/scripts/verify-depth.mjs <url> [--shot out.png]
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5181/';
const shotAt = process.argv.indexOf('--shot');
const shot = shotAt === -1 ? undefined : process.argv[shotAt + 1];
const SEABED = [3.213, 41.906, 16];

const browser = await chromium.launch();

const errors = [];

const settle = async (page, centre) => {
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text().slice(0, 160));
	});
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
	await page.goto(url, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.diveMap !== undefined, undefined, { timeout: 60_000 });
	await page.evaluate(async ([lng, lat, zoom]) => {
		window.diveMap.jumpTo({ center: [lng, lat], zoom });
		await new Promise((r) => setTimeout(r, 8000));
	}, centre);
};

const fine = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await settle(fine, SEABED);

const samples = [];
for (const [x, y] of [
	[640, 430],
	[500, 300],
	[900, 600]
]) {
	await fine.mouse.move(x, y);
	await fine.waitForTimeout(700);
	const sample = await fine.evaluate(
		([x, y]) => {
			const readout = document.querySelector('.maplibregl-ctrl-bottom-left .maplibregl-ctrl');
			const within = (r) =>
				window.diveMap
					.queryRenderedFeatures(
						[
							[x - r, y - r],
							[x + r, y + r]
						],
						{ layers: ['isobath'] }
					)
					.map((f) => Number(f.properties.depth))
					.filter(Number.isFinite);
			const drawn = [16, 48, 128].map(within).find((d) => d.length > 0) ?? [];
			return {
				shown: readout?.textContent ?? null,
				visible: readout instanceof HTMLElement ? readout.style.display !== 'none' : false,
				contours: drawn.length === 0 ? [] : [Math.min(...drawn), Math.max(...drawn)]
			};
		},
		[x, y]
	);
	samples.push({ at: [x, y], ...sample });
}

if (shot) {
	mkdirSync(dirname(shot), { recursive: true });
	await fine.screenshot({ path: shot });
}

const touch = await browser.newPage({ ...devices['iPhone 15'] });
await settle(touch, SEABED);
await touch.touchscreen.tap(180, 380);
await touch.waitForTimeout(700);
const onTouch = await touch.evaluate(() => ({
	pointerFine: window.matchMedia('(pointer: fine)').matches,
	readouts: document.querySelectorAll('.maplibregl-ctrl-bottom-left .maplibregl-ctrl').length
}));

await browser.close();

const agrees = samples.every((s) => {
	if (s.contours.length === 0) return s.visible === false;
	const expected =
		s.contours[0] === s.contours[1] ? `${s.contours[0]} m` : `${s.contours[0]}–${s.contours[1]} m`;
	return s.visible && s.shown === expected;
});
const pass =
	agrees && onTouch.pointerFine === false && onTouch.readouts === 0 && errors.length === 0;
console.log(JSON.stringify({ pass, samples, onTouch, errors: errors.slice(0, 6) }, null, 2));
process.exit(pass ? 0 : 1);
