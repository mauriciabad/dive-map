#!/usr/bin/env node
/**
 * Prove the two memories behave as two memories.
 *
 * The working configuration lives in sessionStorage and carries the camera, so a
 * reload comes back to the same water and a second tab does not. The named
 * configurations live in localStorage, change only when somebody presses save,
 * and carry no camera at all, so loading one never moves the boat.
 *
 * Every assertion here waits for a state it then reads. Nothing is settled by a
 * timeout: `verify-render.mjs` stops measuring once a number crosses a
 * threshold and screenshots whatever is on screen at that moment, which is how
 * a half-loaded map passes a check that says it painted.
 *
 * Usage: node pipeline/scripts/verify-config.mjs <url> [--shot dir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5198/';
const shotAt = process.argv.indexOf('--shot');
const shotDir = shotAt === -1 ? undefined : process.argv[shotAt + 1];
if (shotDir) mkdirSync(shotDir, { recursive: true });

const LIBRARY_KEY = 'dive-map:configurations';
const WORKING_KEY = 'dive-map:working';

/** Begur, where the map opens. */
const START = { lng: 3.2165, lat: 41.9275, zoom: 13.4 };

/**
 * Illes Medes, well inside the survey so the camera guard leaves it alone, and
 * over a stretch of seabed that actually paints. Half a degree of latitude from
 * where the map opens, which is what makes "the second tab did not follow" mean
 * something.
 */
const MOVED = { lng: 3.2235, lat: 42.047, zoom: 14, bearing: 24 };

const failures = [];
const notes = {};

const seen = [];

const check = (name, passed, detail) => {
	if (!passed) failures.push(detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`);
	if (detail !== undefined) seen.push({ name, ...detail });
	notes[name] = passed;
};

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

const sameCamera = (a, b) =>
	near(a.lng, b.lng, 0.0005) && near(a.lat, b.lat, 0.0005) && near(a.zoom, b.zoom, 0.02);

const browser = await chromium.launch();
const problems = [];

const watch = (page, tag) => {
	page.on('console', (m) => {
		if (m.type() === 'error') problems.push(`${tag} console: ${m.text().slice(0, 160)}`);
	});
	page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message.slice(0, 160)}`));
	return page;
};

/**
 * Loaded means the map handle exists, the shell has put the sounding line away,
 * MapLibre says it has nothing left to load, and the seabed reads the same twice
 * running out of the drawing buffer. The last one is what separates a painted map
 * from a blue rectangle.
 *
 * Waiting on the sounding line alone is a trap: `waitForSelector` with `detached`
 * is satisfied by an element that has not been rendered yet, so it passes on an
 * empty page a millisecond after the navigation.
 */
const settle = async (page) => {
	await page.waitForFunction(() => window.diveMap !== undefined, null, { timeout: 90_000 });
	await page.waitForFunction(
		() => document.querySelector('.booting') === null && window.diveMap.loaded(),
		null,
		{ timeout: 90_000 }
	);
	return page.waitForFunction(
		() => {
			const map = window.diveMap;
			const canvas = map.getCanvas();
			const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
			const width = 240;
			const height = 240;
			const pixels = new Uint8Array(width * height * 4);
			gl.readPixels(
				Math.floor(canvas.width * 0.35),
				Math.floor(canvas.height * 0.45),
				width,
				height,
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
			return previous !== undefined && Math.abs(previous - spread) < 0.05 && spread > 6;
		},
		null,
		{ timeout: 90_000, polling: 700 }
	);
};

const look = (page) =>
	page.evaluate(() => {
		const map = window.diveMap;
		const centre = map.getCenter();
		const layer = (id) => {
			try {
				return map.getLayoutProperty(id, 'visibility') ?? 'visible';
			} catch {
				return 'missing';
			}
		};
		const drawn = (id) => {
			try {
				return map.queryRenderedFeatures({ layers: [id] }).length;
			} catch {
				return -1;
			}
		};
		return {
			failure: document.querySelector('.failure')?.textContent?.slice(0, 80),
			lng: +centre.lng.toFixed(5),
			lat: +centre.lat.toFixed(5),
			zoom: +map.getZoom().toFixed(3),
			bearing: Math.round(map.getBearing()),
			hillshade: layer('hillshade'),
			habitats: drawn('ground-habitats-fill'),
			substrate: drawn('ground-substrate-fill')
		};
	});

const stored = (page, key, area) =>
	page.evaluate(
		([k, a]) => {
			try {
				return (a === 'local' ? localStorage : sessionStorage).getItem(k);
			} catch {
				return null;
			}
		},
		[key, area]
	);

const panel = (page) => page.locator('#dive-settings-panel');

/**
 * The name field, found by its placeholder. `getByLabel` with a regex misses it:
 * the label wraps the input, so its text carries the whitespace around the field
 * and an anchored pattern never matches.
 */
const nameField = (page) => panel(page).getByPlaceholder(/night dive|nit a|noche en/i);

const saveButton = (page) =>
	panel(page)
		.getByRole('button', { name: /^save$|^desar$|^guardar$|save over|desar-hi|guardar encima/i })
		.first();

const rowNamed = (page, name) => panel(page).getByRole('button', { name, exact: true });

/** Always ends with that row showing its actions, whatever it was showing before. */
const openRow = async (page, name) => {
	const chevron = panel(page).getByRole('button', {
		name: new RegExp(`(more|més|más) .*${name}`, 'i')
	});
	if ((await chevron.getAttribute('aria-expanded')) === 'true') await chevron.click();
	await chevron.click();
	await panel(page).locator('.open').waitFor({ state: 'visible', timeout: 5000 });
};

const openSection = async (page, name) => {
	await page.getByRole('button', { name }).first().click();
	await panel(page).waitFor({ state: 'visible' });
};

const closePanel = async (page) => {
	await page.keyboard.press('Escape');
	await panel(page).waitFor({ state: 'detached' });
};

const jumpTo = async (page, camera) => {
	await page.evaluate((to) => {
		window.diveMap.jumpTo({ center: [to.lng, to.lat], zoom: to.zoom, bearing: to.bearing });
	}, camera);
	await page.waitForFunction((to) => Math.abs(window.diveMap.getZoom() - to.zoom) < 0.01, camera, {
		timeout: 10_000
	});
};

/** The working configuration trails the map by 400 ms, so wait for the write, not for the clock. */
const waitForWorkingWrite = (page, zoom) =>
	page.waitForFunction(
		(want) => {
			const raw = sessionStorage.getItem('dive-map:working');
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

const seeded = async (entries) => {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	await context.addInitScript((seed) => {
		for (const [area, key, value] of seed) {
			try {
				(area === 'local' ? localStorage : sessionStorage).setItem(key, value);
			} catch {
				/* the point of the guard is that this can throw */
			}
		}
	}, entries);
	return context;
};

// A tab of its own, moved and set up by hand.
const first = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const a = watch(await first.newPage(), 'tab A');
await a.goto(url, { waitUntil: 'domcontentloaded' });
await settle(a);

const opened = await look(a);
check(
	'opens on the shipped defaults',
	opened.hillshade === 'visible' && opened.habitats > 0 && opened.failure === undefined,
	opened
);

await openSection(a, /layers|capes|capas/i);
await panel(a)
	.getByRole('button', { name: /seafloor type|tipus de fons|tipo de fondo/i })
	.first()
	.click();
await panel(a)
	.getByRole('button', { name: /relief shading|ombrejat|sombreado/i })
	.first()
	.click();
await closePanel(a);
await jumpTo(a, MOVED);
await settle(a);

const changed = await look(a);
check(
	'the settings and the camera both took',
	changed.hillshade === 'none' && changed.substrate > 0 && changed.habitats === 0,
	changed
);
await waitForWorkingWrite(a, changed.zoom);
check(
	'nothing was written to the shared library',
	(await stored(a, LIBRARY_KEY, 'local')) === null
);

await a.reload({ waitUntil: 'domcontentloaded' });
await settle(a);
const reloaded = await look(a);
check('a reload comes back to the same water', sameCamera(reloaded, changed), {
	before: changed,
	after: reloaded
});
check(
	'a reload comes back to the same settings',
	reloaded.hillshade === 'none' && reloaded.substrate > 0,
	reloaded
);
check('the bearing survives the reload too', near(reloaded.bearing, changed.bearing, 1), reloaded);
if (shotDir) await a.screenshot({ path: `${shotDir}/config-restored.png` });

// A second tab in the same browser, which must not inherit any of it.
const b = watch(await first.newPage(), 'tab B');
await b.goto(url, { waitUntil: 'domcontentloaded' });
await settle(b);
const second = await look(b);
check(
	'a second tab opens where the map opens, not where the first tab is',
	sameCamera(second, START),
	second
);
check(
	'a second tab opens on the shipped settings',
	second.hillshade === 'visible' && second.habitats > 0,
	second
);
const stillA = await look(a);
check('the first tab stayed where it was', sameCamera(stillA, changed), { a: stillA, b: second });
if (shotDir) await b.screenshot({ path: `${shotDir}/config-second-tab.png` });
await b.close();

// Saved by hand, which is the only thing that writes to the shared library.
const NAME = 'Fons i relleu';
await openSection(a, /configurations|configuracions|configuraciones/i);
await nameField(a).fill(NAME);
await saveButton(a).click();
await a.waitForFunction((key) => localStorage.getItem(key) !== null, LIBRARY_KEY, {
	timeout: 5000
});
notes.library = JSON.parse(await stored(a, LIBRARY_KEY, 'local'));
check(
	'the saved configuration carries the settings and no camera',
	notes.library.saved[0]?.name === NAME &&
		notes.library.saved[0]?.configuration.ground === 'substrate' &&
		!('camera' in notes.library.saved[0].configuration),
	notes.library
);
if (shotDir) await a.screenshot({ path: `${shotDir}/config-panel.png` });
await a.setViewportSize({ width: 390, height: 844 });
await a.waitForTimeout(400);
if (shotDir) await a.screenshot({ path: `${shotDir}/config-panel-phone.png` });

// A whole new session: localStorage carried over the way a browser carries it,
// sessionStorage gone the way a closed tab loses it.
const carried = await first.storageState();
await first.close();

const later = await browser.newContext({
	viewport: { width: 1440, height: 900 },
	storageState: carried
});
const c = watch(await later.newPage(), 'new session');
await c.goto(url, { waitUntil: 'domcontentloaded' });
await settle(c);
const fresh = await look(c);
check(
	'a new session opens on the shipped defaults, not on the last tab',
	sameCamera(fresh, START) && fresh.habitats > 0,
	fresh
);

await openSection(c, /configurations|configuracions|configuraciones/i);
const row = rowNamed(c, NAME);
check('the saved configuration is still listed a session later', (await row.count()) === 1);
await row.click();
await c.waitForFunction(
	() => window.diveMap.getLayoutProperty('hillshade', 'visibility') === 'none',
	null,
	{ timeout: 10_000 }
);
await settle(c);
const loaded = await look(c);
check(
	'loading it changed the map',
	loaded.substrate > 0 && loaded.habitats === 0 && loaded.hillshade === 'none',
	loaded
);
check('and nothing failed to load along the way', loaded.failure === undefined, loaded);
check('loading it did not move the map', sameCamera(loaded, START), loaded);
if (shotDir) await c.screenshot({ path: `${shotDir}/config-loaded.png` });

// Renaming keeps the configuration and its place; deleting asks first.
const RENAMED = 'Fons i relleu, nit';
await openRow(c, NAME);
await panel(c)
	.getByRole('button', { name: /^rename$|canviar el nom|cambiar el nombre/i })
	.click();
await panel(c).locator('.open input[type=text]').fill(RENAMED);
await panel(c)
	.getByRole('button', { name: /^rename$|canviar el nom|cambiar el nombre/i })
	.click();
await rowNamed(c, RENAMED).waitFor({ timeout: 5000 });
check(
	'renaming keeps the configuration under its new name',
	(await rowNamed(c, NAME).count()) === 0
);
check(
	'renaming rewrote the stored library rather than adding a second entry',
	JSON.parse(await stored(c, LIBRARY_KEY, 'local')).saved.length === 1
);

await openRow(c, RENAMED);
await panel(c)
	.getByRole('button', { name: /^delete$|^esborrar$|^borrar$/i })
	.click();
check(
	'deleting asks before it happens',
	(await panel(c)
		.getByRole('button', { name: /yes, delete|de debò|de verdad/i })
		.count()) === 1
);
await panel(c)
	.getByRole('button', { name: /leave it|deixar-ho|dejarlo/i })
	.click();
check('and leaves it alone when told to', (await rowNamed(c, RENAMED).count()) === 1);

// Chosen as the default, which is the only thing a brand new tab inherits.
await openRow(c, RENAMED);
await panel(c)
	.getByRole('button', { name: /open new tabs|obrir les pestanyes|abrir las pestañas/i })
	.click();
await c.waitForFunction(
	(key) => JSON.parse(localStorage.getItem(key) ?? '{}').openWith !== undefined,
	LIBRARY_KEY,
	{ timeout: 5000 }
);

const d = watch(await later.newPage(), 'tab from default');
await d.goto(url, { waitUntil: 'domcontentloaded' });
await settle(d);
const fromDefault = await look(d);
check(
	'a new tab opens on the default configuration',
	fromDefault.substrate > 0 && fromDefault.hillshade === 'none',
	fromDefault
);
check(
	'and still opens where the map opens, because a configuration has no camera',
	sameCamera(fromDefault, START),
	fromDefault
);
await d.close();
await later.close();

// Blobs no version of this app wrote: hand-edited, half-written, or from a build
// that has not shipped yet. None of them may stop the map opening.
const broken = [
	['damaged library', [['local', LIBRARY_KEY, '{ not json']]],
	[
		'library from a newer version',
		[
			[
				'local',
				LIBRARY_KEY,
				JSON.stringify({ version: 999, saved: [{ name: 'Future', configuration: {} }] })
			]
		]
	],
	['damaged working configuration', [['session', WORKING_KEY, '{"version":1,"configuration":']]],
	[
		'an entry written by an older shape',
		[
			[
				'local',
				LIBRARY_KEY,
				JSON.stringify({
					version: 1,
					saved: [
						{
							name: 'Old',
							configuration: {
								layers: ['hillshade', 'marker-cave', 'habitats'],
								ground: 'seagrass',
								isobaths: { intervalM: 'five', emphasised: 'all' }
							}
						}
					]
				})
			]
		]
	]
];

for (const [name, entries] of broken) {
	const context = await seeded(entries);
	const page = watch(await context.newPage(), name);
	await page.goto(url, { waitUntil: 'domcontentloaded' });
	await settle(page);
	const state = await look(page);
	check(
		`the map still opens with a ${name}`,
		sameCamera(state, START) && state.habitats + state.substrate > 0 && state.failure === undefined,
		state
	);

	if (name === 'library from a newer version') {
		const before = await stored(page, LIBRARY_KEY, 'local');
		await openSection(page, /configurations|configuracions|configuraciones/i);
		check(
			'a library from a newer version cannot be saved over',
			await saveButton(page).isDisabled()
		);
		await nameField(page).fill('Should not land');
		check(
			'and the blob is exactly as it was found',
			(await stored(page, LIBRARY_KEY, 'local')) === before
		);
		if (shotDir) await page.screenshot({ path: `${shotDir}/config-unreadable.png` });
	}

	if (name === 'entry written by an older shape') {
		await openSection(page, /configurations|configuracions|configuraciones/i);
		const old = rowNamed(page, 'Old');
		check('an entry from an older shape is offered rather than dropped', (await old.count()) === 1);
		await old.click();
		await settle(page);
		const after = await look(page);
		check(
			'loading it leaves a map that still draws',
			after.habitats > 0 && after.hillshade === 'visible',
			after
		);
	}

	await context.close();
}

await browser.close();

const ok = failures.length === 0 && problems.length === 0;
console.log(JSON.stringify({ url, ok, checks: notes, failures, problems, seen }, null, 2));
process.exit(ok ? 0 : 1);
