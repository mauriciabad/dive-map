#!/usr/bin/env node
/**
 * Prove what a diver sees the first time they open this, and where a tab opens.
 *
 * Four claims, none of which the unit tests can reach. The map opens as far out
 * as the camera guard allows rather than already zoomed in. The opening hints
 * are there on a first visit, survive being dragged around, go away when the
 * diver zooms in, and never come back. A new tab opens on the last camera any
 * tab wrote, and stops following that tab afterwards. A tab that already has
 * permission and is near this coast opens on the diver instead.
 *
 * The pan is a real mouse drag that starts inside one of the hints, because the
 * rule the issue is explicit about is that moving the map does not dismiss them,
 * and a drag driven through `map.panBy` would prove nothing about whether the
 * overlay swallows the gesture.
 *
 * Every wait here waits for a state it then reads. `waitForSelector` with
 * `detached` is not one of those: it is satisfied by an element that has not
 * rendered yet, so it passes on an empty page a millisecond after a navigation
 * and everything measured afterwards measures nothing.
 *
 * Usage: node pipeline/scripts/verify-firstrun.mjs <url> [--shot dir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5198/';
const shotAt = process.argv.indexOf('--shot');
const shotDir = shotAt === -1 ? undefined : process.argv[shotAt + 1];
if (shotDir) mkdirSync(shotDir, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** Illes Medes, well inside the survey and over seabed that paints. */
const MOVED = { lng: 3.2235, lat: 42.047, zoom: 14, bearing: 0 };

/** Begur, the other end of the same stretch. Somewhere a tab can be moved to twice. */
const BEGUR = { lng: 3.2165, lat: 41.9275, zoom: 13.4, bearing: 0 };

/** Off Palamós, close enough to the coast that a tab should open on it. */
const ABOARD = { latitude: 41.8355, longitude: 3.1512 };

/** Somebody planning the trip from home. The map must open where it was going to. */
const AWAY = { latitude: 52.52, longitude: 13.405 };

const failures = [];
const notes = {};
const seen = [];
const problems = [];

const check = (name, passed, detail) => {
	if (!passed) failures.push(detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`);
	if (detail !== undefined) seen.push({ name, ...detail });
	notes[name] = passed;
};

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

const sameCamera = (a, b) =>
	near(a.lng, b.lng, 0.0005) && near(a.lat, b.lat, 0.0005) && near(a.zoom, b.zoom, 0.02);

const browser = await chromium.launch();

const watch = (page, tag) => {
	page.on('console', (m) => {
		if (m.type() === 'error') problems.push(`${tag} console: ${m.text().slice(0, 160)}`);
	});
	page.on('pageerror', (e) =>
		problems.push(`${tag} pageerror: ${(e.stack ?? e.message).slice(0, 400)}`)
	);
	return page;
};

/**
 * Loaded means the handle exists, the sounding line is gone, MapLibre says it has
 * nothing left to load, and the drawing buffer reads the same twice running. The
 * spread floor is the part that separates a painted map from a flat rectangle,
 * and it is low here on purpose: the whole survey at once is coast and open sea,
 * not the textured seabed a check at diving zoom can demand.
 */
const settle = async (page, floor = 0.4) => {
	await page
		.waitForFunction(() => window.diveMap !== undefined, null, { timeout: 90_000 })
		.catch(() => {
			throw new Error(
				`No map handle at ${url}. This needs a dev server: a production build does not expose window.diveMap.`
			);
		});
	await page.waitForFunction(
		() => document.querySelector('.booting') === null && window.diveMap.loaded(),
		null,
		{ timeout: 90_000 }
	);
	return page.waitForFunction(
		(want) => {
			const canvas = window.diveMap.getCanvas();
			const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
			const side = 240;
			const pixels = new Uint8Array(side * side * 4);
			gl.readPixels(
				Math.floor(canvas.width * 0.35),
				Math.floor(canvas.height * 0.45),
				side,
				side,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				pixels
			);
			let sum = 0;
			let sumSquares = 0;
			for (let i = 0; i < pixels.length; i += 4) {
				const luminance = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
				sum += luminance;
				sumSquares += luminance * luminance;
			}
			const n = pixels.length / 4;
			const spread = Math.sqrt(sumSquares / n - (sum / n) ** 2);
			const previous = window.__spread;
			window.__spread = spread;
			return previous !== undefined && Math.abs(previous - spread) < 0.05 && spread > want;
		},
		floor,
		{ timeout: 90_000, polling: 700 }
	);
};

const look = (page) =>
	page.evaluate(() => {
		const map = window.diveMap;
		const centre = map.getCenter();
		const plaques = [...document.querySelectorAll('.hints p')];
		return {
			failure: document.querySelector('.failure')?.textContent?.slice(0, 80),
			lng: +centre.lng.toFixed(5),
			lat: +centre.lat.toFixed(5),
			zoom: +map.getZoom().toFixed(3),
			minZoom: +map.getMinZoom().toFixed(3),
			hints: plaques.length,
			// Leaders and arrowheads. Two of each when both hints have something to
			// point at, and none of them is allowed to be an empty path.
			strokes: document.querySelectorAll('.hints path[d]:not([d=""])').length,
			text: plaques.map((p) => p.textContent.trim()),
			boxes: plaques.map((p) => {
				const box = p.getBoundingClientRect();
				return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
			}),
			tip: document.querySelector('.hints path.head')?.getAttribute('d')
		};
	});

/** The whole survey fitted to this screen, which is what the camera guard's floor is. */
const zoomedOut = (state) => near(state.zoom, state.minZoom, 0.02);

const overlap = ([a, b]) =>
	a !== undefined && b !== undefined && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;

const inside = (boxes, viewport) =>
	boxes.length > 0 &&
	boxes.every((b) => b.x >= 0 && b.y >= 0 && b.right <= viewport.width && b.bottom <= viewport.height);

const jumpTo = async (page, camera) => {
	await page.evaluate((to) => {
		window.diveMap.jumpTo({ center: [to.lng, to.lat], zoom: to.zoom, bearing: to.bearing });
	}, camera);
	await page.waitForFunction((to) => Math.abs(window.diveMap.getZoom() - to.zoom) < 0.01, camera, {
		timeout: 10_000
	});
};

/** The camera trails the map by 400 ms, so wait for the write rather than for a clock. */
const waitForShared = (page, zoom) =>
	page.waitForFunction(
		(want) => {
			const raw = localStorage.getItem('dive-map:recent');
			if (raw === null) return false;
			try {
				return Math.abs(JSON.parse(raw).camera?.zoom - want) < 0.01;
			} catch {
				return false;
			}
		},
		zoom,
		{ timeout: 10_000 }
	);

const open = async (context, tag, viewport) => {
	const page = watch(await context.newPage(), tag);
	if (viewport) await page.setViewportSize(viewport);
	await page.goto(url, { waitUntil: 'domcontentloaded' });
	await settle(page);
	return page;
};

// A browser that has never seen this map.
const first = await browser.newContext({ viewport: DESKTOP });
const a = await open(first, 'first visit');

const opened = await look(a);
check('the map opens as far out as the camera guard allows', zoomedOut(opened), opened);
check('and nothing failed to load getting there', opened.failure === undefined, opened);
check(
	'both hints are on screen, each with a line and an arrowhead',
	opened.hints === 2 && opened.strokes === 4,
	{ hints: opened.hints, strokes: opened.strokes, text: opened.text }
);
check(
	'and neither of them is sitting on the other',
	!overlap(opened.boxes) && inside(opened.boxes, DESKTOP),
	opened.boxes
);
if (shotDir) await a.screenshot({ path: `${shotDir}/firstrun-desktop-1440x900.png` });

// A real drag, started inside a hint. The overlay takes no pointer events, so
// this has to reach the map underneath and must not put the hints away.
const grab = opened.boxes[0];
await a.mouse.move(grab.x + 40, grab.y + 20);
await a.mouse.down();
await a.mouse.move(grab.x + 40 - 130, grab.y + 20 + 70, { steps: 12 });
await a.mouse.up();
await settle(a);
const dragged = await look(a);
check(
	'dragging the map through a hint moves the map',
	!sameCamera(dragged, opened),
	{ before: { lng: opened.lng, lat: opened.lat }, after: { lng: dragged.lng, lat: dragged.lat } }
);
check('and does not put the hints away', dragged.hints === 2 && dragged.strokes === 4, {
	hints: dragged.hints,
	strokes: dragged.strokes
});
check(
	'and the arrow follows the coast it is pointing at',
	dragged.tip !== opened.tip,
	{ before: opened.tip, after: dragged.tip }
);
if (shotDir) await a.screenshot({ path: `${shotDir}/firstrun-desktop-1440x900-dragged.png` });

// Zooming in is the thing the hints exist to ask for, so it is what finishes them.
await a.locator('.maplibregl-ctrl-zoom-in').click();
await a.waitForFunction(() => document.querySelectorAll('.hints p').length === 0, null, {
	timeout: 10_000
});
const zoomed = await look(a);
check('zooming in takes the hints away', zoomed.hints === 0, zoomed);
check('and leaves the map deeper than it opened', zoomed.zoom > zoomed.minZoom + 0.25, zoomed);
await settle(a);
if (shotDir) await a.screenshot({ path: `${shotDir}/firstrun-desktop-1440x900-zoomed.png` });

await a.reload({ waitUntil: 'domcontentloaded' });
await settle(a);
const reloaded = await look(a);
check('a reload does not bring them back', reloaded.hints === 0, reloaded);

// Somewhere with seabed under it, so the shared camera means something later.
await jumpTo(a, MOVED);
await settle(a);
await waitForShared(a, MOVED.zoom);

const b = await open(first, 'second tab');
const second = await look(b);
check('a second tab does not get the hints either', second.hints === 0, second);
check(
	'a second tab opens on the last camera any tab wrote',
	sameCamera(second, MOVED),
	second
);

// Picking a camera up once is not following it about.
await jumpTo(a, BEGUR);
await settle(a);
await waitForShared(a, BEGUR.zoom);
const held = await look(b);
check('and then keeps its own water while the first tab moves on', sameCamera(held, MOVED), {
	a: BEGUR,
	b: held
});

await b.reload({ waitUntil: 'domcontentloaded' });
await settle(b);
const refreshed = await look(b);
check('a refresh brings that tab back to its own camera', sameCamera(refreshed, MOVED), {
	before: held,
	after: refreshed
});
await b.close();
await a.close();
await first.close();

// A phone, where the hints have a quarter of the room and no mouse.
const pocket = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true });
const p = await open(pocket, 'phone', PHONE);
const phone = await look(p);
check('the map opens as far out as the guard allows on a phone too', zoomedOut(phone), phone);
check('both hints fit on a phone without touching each other', phone.hints === 2 && !overlap(phone.boxes) && inside(phone.boxes, PHONE), {
	boxes: phone.boxes,
	hints: phone.hints
});
if (shotDir) await p.screenshot({ path: `${shotDir}/firstrun-phone-390x844.png` });
await p.close();
await pocket.close();

/**
 * Somebody who has already said yes to sharing their position, which is the only
 * case that opens the map on them. Nothing anywhere asks for the permission, so
 * a browser that has not granted it never sees a prompt and never gets moved.
 */
const withPosition = async (tag, at, shot) => {
	const context = await browser.newContext({
		viewport: DESKTOP,
		permissions: ['geolocation'],
		geolocation: at
	});
	const page = await open(context, tag);
	/*
	 * The fix lands after the first paint, and the opening is settled the moment it
	 * has been answered either way: the map is on the diver, or the hints are up
	 * because it is not going to be. Waiting for one of those two beats a timeout,
	 * which would pass just as happily on a page where nothing ever happened.
	 */
	await page.waitForFunction(
		() => window.diveMap.getZoom() >= 15 || document.querySelector('.hints p') !== null,
		null,
		{ timeout: 20_000 }
	);
	await settle(page);
	const state = await look(page);
	if (shotDir && shot) await page.screenshot({ path: `${shotDir}/${shot}` });
	await page.close();
	await context.close();
	return state;
};

const aboard = await withPosition('granted, on the coast', ABOARD, 'firstrun-desktop-1440x900-aboard.png');
check(
	'a tab opens on the diver when the browser already knows where they are',
	near(aboard.lng, ABOARD.longitude, 0.01) &&
		near(aboard.lat, ABOARD.latitude, 0.01) &&
		aboard.zoom >= 15,
	aboard
);
check('and the hints stay out of the way of a map that is already where it should be', aboard.hints === 0, aboard);

const away = await withPosition('granted, far from the coast', AWAY);
check(
	'a diver nowhere near this coast still opens on the whole survey',
	zoomedOut(away) && away.hints === 2,
	away
);

await browser.close();

check('nothing logged an error and nothing threw', problems.length === 0, undefined);

const ok = failures.length === 0 && problems.length === 0;
console.log(JSON.stringify({ url, ok, checks: notes, failures, problems, seen }, null, 2));
process.exit(ok ? 0 : 1);
