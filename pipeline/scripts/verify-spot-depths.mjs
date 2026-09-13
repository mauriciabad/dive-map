#!/usr/bin/env node
/**
 * Look at the spot depths at every zoom they draw at, and count what lands.
 *
 * Issue #48. The thing being judged here is density and repetition, and neither
 * shows up in a typecheck or in the archive: what matters is how many numbers
 * are in a frame, whether two of them say the same thing next to each other, and
 * whether they are sitting on top of the chart marks. So this drives the real map
 * and reads the placed symbols back out of MapLibre, which knows which ones
 * survived collision and which were dropped.
 *
 * Usage: node pipeline/scripts/verify-spot-depths.mjs <url> [--shots docs/shots]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt === -1 ? undefined : process.argv[shotsAt + 1];

/** The Medes, which is the densest rock on this coast and so the worst case. */
const MEDES = [3.2235, 42.0465];
/** Open shelf off Palamós, where the ground is mostly flat and mostly canyon. */
const PALAMOS = [3.16, 41.83];

const PLACES = [
	['medes', MEDES],
	['palamos', PALAMOS]
];
const ZOOMS = [11, 13, 14.5, 16, 17.5];

if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));

/**
 * One load per view, through the app's own `?map=` link rather than `jumpTo`.
 * Driving the live camera works until the service worker swaps itself under the
 * page, and then the evaluate lands in a context that has been navigated away.
 * A fresh load per view is a few seconds slower and is the same arrival a diver
 * following a link gets.
 */
let worst = 0;
for (const [name, centre] of PLACES) {
	for (const zoom of ZOOMS) {
		const [lng, lat] = centre;
		const link = new URL(url);
		link.searchParams.set('map', `${zoom}/${lat}/${lng}`);
		await page.goto(link.href, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(() => window.diveMap !== undefined, undefined, { timeout: 60_000 });
		const seen = await page.evaluate(async () => {
			await new Promise((r) => setTimeout(r, 6000));
			// Only what is in frame. `querySourceFeatures` answers for every loaded
			// tile, which reaches well past the edges, so counting all of it makes
			// the collision look far worse than it is.
			const bounds = window.diveMap.getBounds();
			const held = window.diveMap
				.querySourceFeatures('spot-depths', { sourceLayer: 'spots' })
				.filter(({ geometry }) => {
					const [lng, lat] = geometry.coordinates;
					return (
						lng >= bounds.getWest() &&
						lng <= bounds.getEast() &&
						lat >= bounds.getSouth() &&
						lat <= bounds.getNorth()
					);
				}).length;
			const drawn = window.diveMap
				.queryRenderedFeatures(undefined, { layers: ['spot-depth'] })
				.map((f) => ({
					d: f.properties.d,
					k: f.properties.k,
					at: window.diveMap.project(f.geometry.coordinates)
				}));
			const marks = window.diveMap.queryRenderedFeatures(undefined, {
				layers: ['osm-marker-plate', 'osm-marker-key', 'osm-marker-minor']
			}).length;
			return { drawn, marks, held };
		});

		// Two numbers reading the same depth within one label width of each other is
		// the failure that makes a spot depth worse than nothing: it says the reader
		// found two features where there is one.
		let doubled = 0;
		for (let i = 0; i < seen.drawn.length; i++) {
			for (let j = i + 1; j < seen.drawn.length; j++) {
				const a = seen.drawn[i];
				const b = seen.drawn[j];
				const away = Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y);
				if (a.d === b.d && away < 60) doubled++;
			}
		}
		worst = Math.max(worst, doubled);

		const kinds = {};
		for (const f of seen.drawn) kinds[f.k] = (kinds[f.k] ?? 0) + 1;
		const depths = seen.drawn.map((f) => f.d);
		console.log(
			`${name} z${zoom}: ${seen.drawn.length} of ${seen.held} spot depths ` +
				`${JSON.stringify(kinds)} over ${seen.marks} chart marks, ` +
				`${doubled} repeated pairs, ` +
				`${depths.length ? `${Math.min(...depths)}-${Math.max(...depths)} m` : 'none'}`
		);
		if (shots) {
			await page.screenshot({ path: `${shots}/spot-${name}-z${zoom}.png` });
		}
	}
}

for (const e of errors) console.error(`console: ${e}`);
console.log(errors.length === 0 ? 'no console errors' : `${errors.length} console errors`);
await browser.close();
process.exit(worst > 0 || errors.length > 0 ? 1 : 0);
