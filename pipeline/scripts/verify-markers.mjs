#!/usr/bin/env node
/**
 * Prove the OSM markers are registered, painted, and still there after the style
 * has been rebuilt.
 *
 * The bug this exists to catch: every setStyle empties MapLibre's image registry,
 * so an icon that is not reinstalled leaves the markers silently gone. The style
 * still validates, the layers still exist, and queryRenderedFeatures still
 * answers, because a symbol whose image is missing is a placed symbol that paints
 * nothing at all. Only the pixels know, so this reads the drawing buffer.
 *
 * Usage: node pipeline/scripts/verify-markers.mjs <url> [--shot dir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5193/';
const shotAt = process.argv.indexOf('--shot');
const shotDir = shotAt === -1 ? undefined : process.argv[shotAt + 1];
if (shotDir) mkdirSync(shotDir, { recursive: true });

/** Illes Medes: a dozen dive sites, a marina, lights and swimming zones in one frame. */
const MEDES = [3.2235, 42.047, 14];

/** Begur: the coast's one charted rock, with the Aiguablava wrecks below it. */
const HAZARDS = [3.2234, 41.9498, 13];

const KINDS = [
	'dive-site',
	'wreck',
	'rock',
	'restricted-area',
	'mooring',
	'light',
	'dive-centre',
	'slipway',
	'ladder',
	'harbour'
];

/** Harbour is the one kind with no glyph, which is the design and not a gap. */
const DRAWN = KINDS.filter((kind) => kind !== 'harbour');

/** The colours markers.ts assigns, repeated so this check does not read its own answer. */
const COLOURS = {
	cream: '#efe4cf',
	amber: '#e8a92f',
	hazard: '#ef6f43',
	regulation: '#ec6faa',
	beacon: '#f5dd93',
	shore: '#4ecfae'
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

const errors = [];
page.on('console', (m) => {
	const text = m.text();
	// static/ belongs to the PWA work; a missing favicon is not this map failing.
	if (m.type() === 'error' && !text.includes('favicon')) errors.push(text.slice(0, 160));
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.diveMap !== undefined, { timeout: 60_000 });

const flyTo = async ([lng, lat, zoom], ms = 5000) => {
	await page.evaluate(
		([lng, lat, zoom]) => window.diveMap.jumpTo({ center: [lng, lat], zoom }),
		[lng, lat, zoom]
	);
	await page.waitForTimeout(ms);
};

const openPanel = async (name) => {
	await page.getByRole('button', { name }).first().click();
	await page.waitForTimeout(600);
};

const closePanel = async () => {
	await page
		.getByRole('button', { name: /^(Close|Tanca|Cerrar)$/i })
		.first()
		.click();
	await page.waitForTimeout(400);
};

/** Image registry, layer occupancy, and the camera, which must not move by itself. */
const state = () =>
	page.evaluate((drawn) => {
		const m = window.diveMap;
		const count = (layer) => {
			try {
				return m.queryRenderedFeatures({ layers: [layer] }).length;
			} catch {
				return -1;
			}
		};
		return {
			registered: Object.fromEntries(
				['marker-disc', ...drawn.map((k) => `marker-${k}`)].map((id) => [id, m.hasImage(id)])
			),
			key: count('osm-marker-key'),
			minor: count('osm-marker-minor'),
			disc: count('osm-marker-disc'),
			harbourLabel: count('osm-harbour-label'),
			zoom: Number(m.getZoom().toFixed(2)),
			lng: Number(m.getCenter().lng.toFixed(4))
		};
	}, DRAWN);

/** Pixels within tolerance of each family colour, straight off the drawing buffer. */
const pixels = (colours) =>
	page.evaluate((colours) => {
		const canvas = window.diveMap.getCanvas();
		const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
		const px = new Uint8Array(canvas.width * canvas.height * 4);
		gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
		const hits = {};
		for (const [name, hex] of Object.entries(colours)) {
			const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
			let n = 0;
			for (let i = 0; i < px.length; i += 4) {
				if (
					Math.abs(px[i] - want[0]) <= 10 &&
					Math.abs(px[i + 1] - want[1]) <= 10 &&
					Math.abs(px[i + 2] - want[2]) <= 10
				) {
					n++;
				}
			}
			hits[name] = n;
		}
		return hits;
	}, colours);

const result = { url, rounds: [] };

await flyTo(MEDES, 9000);
result.rounds.push({ round: 'initial', ...(await state()), pixels: await pixels(COLOURS) });

/*
 * Four style rebuilds through the real control, which is what a diver does when
 * they poke at the panel. Each one empties the image registry.
 */
await openPanel(/^Layers$/);
for (const round of [1, 2, 3, 4]) {
	await page
		.getByRole('button', { name: /Relief shading/i })
		.first()
		.click();
	await page.waitForTimeout(2500);
	result.rounds.push({
		round: `relief toggle ${round}`,
		...(await state()),
		pixels: await pixels(COLOURS)
	});
}
await closePanel();

/** The rock and the wrecks live south of Medes, so their colours are checked there. */
await flyTo(HAZARDS, 7000);
result.hazards = { ...(await state()), pixels: await pixels(COLOURS) };
if (shotDir) await page.screenshot({ path: `${shotDir}/markers-hazards-1440x900.png` });

/*
 * Chromium reports en-US, so the app negotiates English on load. Every locale is
 * chosen explicitly and the panel opened by that locale's own word for it.
 */
const LOCALES = [
	{ code: 'ca', name: 'Català', legend: /^Llegenda$/, marks: /Marques del mapa/ },
	{ code: 'es', name: 'Español', legend: /^Leyenda$/, marks: /Marcas del mapa/ },
	{ code: 'en', name: 'English', legend: /^Legend$/, marks: /Map marks/ }
];

await flyTo(MEDES, 5000);
result.legend = {};
for (const locale of LOCALES) {
	await openPanel(/^(Language|Idioma)$/);
	await page.getByRole('button', { name: locale.name, exact: true }).first().click();
	await page.waitForTimeout(1500);
	await openPanel(locale.legend);
	result.legend[locale.code] = {
		sectionVisible: await page
			.getByText(locale.marks)
			.first()
			.isVisible()
			.catch(() => false),
		rows: await page.locator('.marks button[aria-pressed]').count(),
		// A row has to say what the kind is called, not just show a picture.
		named: await page
			.locator('.marks button[aria-pressed]')
			.evaluateAll((rows) => rows.filter((r) => (r.textContent ?? '').trim().length > 0).length)
	};
	if (shotDir) {
		await page.getByText(locale.marks).first().scrollIntoViewIfNeeded();
		await page.waitForTimeout(300);
		await page.screenshot({ path: `${shotDir}/markers-legend-${locale.code}.png` });
	}
	await closePanel();
}

// One kind off and on again, through the legend's own switch. Still in English.
await openPanel(/^Legend$/);
const mooring = page.getByRole('button', { name: /^Mooring$/ }).first();
const before = await pixels({ amber: COLOURS.amber });
await mooring.click();
await page.waitForTimeout(2500);
const off = await pixels({ amber: COLOURS.amber });
await mooring.click();
await page.waitForTimeout(2500);
const on = await pixels({ amber: COLOURS.amber });
result.mooringSwitch = { before: before.amber, off: off.amber, on: on.amber };
await closePanel();

if (shotDir) {
	await flyTo(MEDES, 3500);
	await page.screenshot({ path: `${shotDir}/markers-desktop-1440x900.png` });
	await page.setViewportSize({ width: 390, height: 844 });
	await flyTo(MEDES, 3500);
	await page.screenshot({ path: `${shotDir}/markers-phone-390x844.png` });
	await openPanel(/^Legend$/);
	await page
		.getByText(/Map marks/)
		.first()
		.scrollIntoViewIfNeeded();
	await page.waitForTimeout(300);
	await page.screenshot({ path: `${shotDir}/markers-legend-phone-390x844.png` });
}

await browser.close();

const registered = result.rounds.every((r) => Object.values(r.registered).every(Boolean));
const painted = result.rounds.every((r) => r.key > 0 && r.minor > 0 && r.disc > 0);
const cameraHeld = result.rounds.every((r) => r.zoom === MEDES[2] && r.lng === MEDES[0]);
/*
 * Five of the six families paint at Medes. Rock is the sixth and there is exactly
 * one charted rock on this coast, so it gets its own frame. Slipway shares the
 * shore teal and OSM has no slipway on this coast at all, so no pixel check can
 * prove it: its image being registered is as far as the data goes.
 */
const AT_MEDES = ['cream', 'amber', 'regulation', 'beacon', 'shore'];
const familiesPainted = result.rounds.every((r) => AT_MEDES.every((name) => r.pixels[name] > 20));
const hazardPainted = result.hazards.pixels.hazard > 20 && result.hazards.pixels.cream > 20;
const switched =
	result.mooringSwitch.off < result.mooringSwitch.before * 0.3 &&
	result.mooringSwitch.on > result.mooringSwitch.off;
const legendEverywhere = Object.values(result.legend).every(
	(l) => l.sectionVisible && l.rows === KINDS.length && l.named === KINDS.length
);

const ok =
	registered &&
	painted &&
	cameraHeld &&
	familiesPainted &&
	hazardPainted &&
	switched &&
	legendEverywhere &&
	errors.length === 0;

console.log(
	JSON.stringify(
		{
			ok,
			registered,
			painted,
			cameraHeld,
			familiesPainted,
			hazardPainted,
			switched,
			legendEverywhere,
			errors,
			...result
		},
		null,
		2
	)
);
process.exit(ok ? 0 : 1);
