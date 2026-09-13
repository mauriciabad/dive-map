#!/usr/bin/env node
/**
 * Draw the app icon and rasterise the whole set into static/.
 *
 * The icon is a piece of the map itself: a rocky cape with a cala bitten into
 * it, the seabed stepping away from the shore in painted bands, the 5 m isobath
 * running bright through the shallows, and one dive site marked the way the map
 * marks it. Nothing here is a pin or a wave. It is what the app draws, cropped
 * to a square.
 *
 * One coastline is authored. Every seabed band is an offset of it, damped
 * toward the mean shore direction as it goes deeper, because that is what
 * isobaths do: detail belongs to the rock and is lost to the water. Editing
 * COAST moves the whole seabed with it, which is the only way the bands stay
 * parallel to a shore this jagged.
 *
 * The world is authored at 160 units and cropped twice. `any` takes a tight crop
 * and fills the tile. `maskable` takes a wider one, so land and open water run
 * off every edge and a circular or squircle mask lands on paint rather than on a
 * border. The cala and the dive site sit inside the centre circle of 80% of the
 * canvas that the maskable spec guarantees. The maskable icon is not the `any`
 * icon with padding; it is a wider crop of a drawing that keeps going, and
 * `--contact` renders both against that circle so the claim can be checked.
 *
 * Usage: node pipeline/scripts/build_icons.mjs [--out static] [--contact <png>]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* src/routes/theme.css and src/lib/map/palette.ts. Nothing here is a new colour. */
const DEEP = '#03293b';
const MID = '#0d4a63';
const POSI = '#86a742';
const POSI_LO = '#6d8b34';
const SAND = '#c6bb9f';
const SAND_HI = '#ded4bc';
const LAND = '#3a342b';
const LAND_HI = '#4c4438';
const LAND_LO = '#231e18';
const MINT = '#2ad9b4';
const MINT_DEEP = '#4aa0a6';
const INK = '#1d1710';
const PAPER = '#efe4cf';

const WORLD = 160;
const BLEED = 96;

/**
 * The shore, up-left of the line, in world units. Angular on purpose: rock is
 * drawn with corners and water with curves, which is the one cue that tells a
 * reader at 32 px which side of the line is land.
 */
const COAST = [
	[128, -34],
	[110, 6],
	[92, 12],
	[56, -6],
	[72, 40],
	[92, 54],
	[64, 60],
	[40, 48],
	[36, 74],
	[10, 82],
	[-34, 128]
];

/** The mean shore, x + y = SHORE. Offsets run perpendicular to it. */
const SHORE = COAST[0][0] + COAST[0][1];
const DIAG = Math.SQRT1_2;

/** Seaward by `metres`, with `damp` of the shore's own detail smoothed out. */
const offset = (point, metres, damp) => {
	const [x, y] = point;
	const t = (x + y - SHORE) / 2;
	return [x - t * damp + metres * DIAG, y - t * damp + metres * DIAG];
};

const round = (n) => Math.round(n * 10) / 10;

const curve = (points) => {
	const at = (i) => points[Math.min(points.length - 1, Math.max(0, i))];
	let d = `M${round(points[0][0])} ${round(points[0][1])}`;
	for (let i = 0; i < points.length - 1; i += 1) {
		const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
		const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
		const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
		d += ` C${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ${round(p2[0])} ${round(p2[1])}`;
	}
	return d;
};

const polyline = (points) =>
	points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`).join(' ');

const far = -BLEED;
const wide = WORLD + BLEED;

/** Everything landward of a contour, so the bands stack deepest first. */
const landwardOf = (d) => `${d} L${far} ${wide} L${far} ${far} L${wide} ${far} Z`;

const contour = (metres, damp) => curve(COAST.map((p) => offset(p, metres, damp)));

const LAND_EDGE = polyline(COAST);
const LAND_SHAPE = landwardOf(LAND_EDGE);

/**
 * Depth, colour, and how much of the shore's detail survives at that depth.
 *
 * Three fills, not five. The seabed ramps sand to blue the way the map ramps it,
 * and a fourth parallel band only repeats the shore's zigzag a fourth time until
 * the whole tile reads as chevrons rather than as a coast.
 */
const BANDS = [
	[50, 0.75, MID],
	[18, 0.34, SAND],
	[7, 0.12, SAND_HI]
];

/** Every-metre contours are the map's texture. They die below 48 px, correctly. */
const HAIRLINES = [
	[11, 0.2],
	[26, 0.46],
	[38, 0.6],
	[64, 0.82],
	[82, 0.9]
];

/**
 * Posidonia grows in patches between about 10 and 25 m, never in a ring, and the
 * survey only claims 40% accuracy per class anyway. Each is an ellipse laid along
 * the shore, because a meadow follows the depth it can live at.
 */
const MEADOWS = [
	[104, 62, 30, 15],
	[58, 96, 22, 11],
	[136, 26, 15, 8],
	[80, 62, 13, 7]
];

const SITE = [82, 22];

const body = `
<rect x="${far}" y="${far}" width="${wide - far}" height="${wide - far}" fill="${DEEP}"/>
${BANDS.map(([m, damp, fill]) => `<path d="${landwardOf(contour(m, damp))}" fill="${fill}"/>`).join('\n')}
${MEADOWS.map(
	([cx, cy, rx, ry], i) =>
		`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${i % 2 === 0 ? POSI : POSI_LO}"
			opacity="${i === 0 ? 0.92 : 0.7}" transform="rotate(-45 ${cx} ${cy})"/>`
).join('\n')}
${HAIRLINES.map(
	([m, damp]) =>
		`<path d="${contour(m, damp)}" fill="none" stroke="${INK}" stroke-width="0.8" opacity="0.3"/>`
).join('\n')}
${BANDS.map(
	([m, damp]) =>
		`<path d="${contour(m, damp)}" fill="none" stroke="${INK}" stroke-width="0.9" opacity="0.26"/>`
).join('\n')}
<path d="${contour(38, 0.6)}" fill="none" stroke="${MINT_DEEP}" stroke-width="2.8" opacity="0.85"/>
<path d="${contour(13, 0.24)}" fill="none" stroke="${MINT}" stroke-width="5" stroke-linecap="round"/>
<path d="${LAND_EDGE}" fill="none" stroke="${INK}" stroke-width="9" stroke-linejoin="round" opacity="0.38"/>
<path d="${LAND_SHAPE}" fill="${LAND}"/>
<path d="M6 -6 C30 4 48 20 56 44 M84 -30 C90 -8 100 4 116 10 M-10 40 C12 48 26 58 34 72
	M-16 84 C0 86 12 92 18 100 M30 4 C42 14 50 26 54 38"
	stroke="${LAND_HI}" stroke-width="3.4" stroke-linecap="round" fill="none" opacity="0.75"/>
<path d="M100 -22 C104 -6 112 2 124 6 M16 20 C28 32 34 44 34 60 M-12 64 C2 68 12 76 18 86"
	stroke="${LAND_LO}" stroke-width="3.4" stroke-linecap="round" fill="none" opacity="0.45"/>
<circle cx="${SITE[0]}" cy="${SITE[1] + 1.5}" r="9.4" fill="${INK}" opacity="0.45"/>
<circle cx="${SITE[0]}" cy="${SITE[1]}" r="7.8" fill="${PAPER}" stroke="${INK}" stroke-width="2.1"/>`;

/** `any` crops in on the cala. `maskable` shows the world and lets it run off. */
const CROP = {
	any: '18 -22 124 124',
	maskable: '-6 -46 172 172'
};

const iconSvg = (purpose, size) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${CROP[purpose]}">${body}</svg>`;

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CROP.any}">${body}</svg>\n`;

/** `file: null` is rasterised for the .ico and never written on its own. */
const RASTERS = [
	{ file: null, purpose: 'any', size: 16 },
	{ file: null, purpose: 'any', size: 32 },
	{ file: null, purpose: 'any', size: 48 },
	{ file: 'apple-touch-icon.png', purpose: 'any', size: 180 },
	{ file: 'icons/icon-192.png', purpose: 'any', size: 192 },
	{ file: 'icons/icon-512.png', purpose: 'any', size: 512 },
	{ file: 'icons/icon-maskable-192.png', purpose: 'maskable', size: 192 },
	{ file: 'icons/icon-maskable-512.png', purpose: 'maskable', size: 512 }
];

const ICO_SIZES = [16, 32, 48];

/**
 * ICO with PNG payloads. The BMP form needs a doubled-height AND mask and a
 * bottom-up row order; every browser since IE11 reads the PNG form, and the
 * files are a third of the size.
 */
const encodeIco = (entries) => {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(entries.length, 4);

	const directory = Buffer.alloc(16 * entries.length);
	let at = header.length + directory.length;
	entries.forEach(({ size, png }, i) => {
		const e = i * 16;
		directory.writeUInt8(size >= 256 ? 0 : size, e);
		directory.writeUInt8(size >= 256 ? 0 : size, e + 1);
		directory.writeUInt8(0, e + 2);
		directory.writeUInt8(0, e + 3);
		directory.writeUInt16LE(1, e + 4);
		directory.writeUInt16LE(32, e + 6);
		directory.writeUInt32LE(png.length, e + 8);
		directory.writeUInt32LE(at, e + 12);
		at += png.length;
	});

	return Buffer.concat([header, directory, ...entries.map((e) => e.png)]);
};

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : process.argv[i + 1];
};

const contactSheet = () => {
	const cell = (purpose, size) => `<div class="c">
		<img src="data:image/svg+xml;utf8,${encodeURIComponent(iconSvg(purpose, size))}"
			width="${size * 5}" height="${size * 5}" class="zoom">
		<span>${size}</span></div>`;
	const row = (purpose) => `<div class="r">
		<div class="c">${iconSvg(purpose, 190)}<span>${purpose}</span></div>
		<div class="c"><div class="circ">${iconSvg(purpose, 190)}</div><span>circle</span></div>
		<div class="c"><div class="sq">${iconSvg(purpose, 190)}</div><span>squircle</span></div>
		<div class="c"><div class="safe">${iconSvg(purpose, 190)}</div><span>safe zone</span></div>
		${[16, 32, 48].map((s) => cell(purpose, s)).join('')}</div>`;
	return `<!doctype html><meta charset="utf-8"><style>
		body{margin:0;background:#efe4cf;font:12px system-ui;padding:14px}
		.r{display:flex;gap:18px;align-items:flex-start;margin-bottom:16px}
		.c{display:flex;flex-direction:column;align-items:center;gap:5px}
		.zoom{image-rendering:pixelated;border:1px solid #999}
		.circ{clip-path:circle(50%);display:flex}
		.sq{clip-path:inset(0 round 42px);display:flex}
		.safe{position:relative;display:flex}
		.safe::after{content:'';position:absolute;inset:10%;border:2px dashed #d4553f;border-radius:50%}
		span{font-weight:600}
		</style>${row('any')}${row('maskable')}`;
};

const out = resolve(arg('out', 'static'));
const contact = arg('contact', null);

const browser = await chromium.launch();
const page = await browser.newPage();

if (contact !== null) {
	await page.setViewportSize({ width: 1480, height: 900 });
	await page.setContent(contactSheet());
	await page.screenshot({ path: resolve(contact), fullPage: true });
	await browser.close();
	console.log(JSON.stringify({ contact: resolve(contact) }));
	process.exit(0);
}

mkdirSync(`${out}/icons`, { recursive: true });
writeFileSync(`${out}/favicon.svg`, FAVICON_SVG);

const rendered = new Map();
for (const { file, purpose, size } of RASTERS) {
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style>${iconSvg(purpose, size)}`
	);
	const png = await page.locator('svg').screenshot(file === null ? {} : { path: `${out}/${file}` });
	rendered.set(`${purpose}-${size}`, png);
}
await browser.close();

writeFileSync(
	`${out}/favicon.ico`,
	encodeIco(ICO_SIZES.map((size) => ({ size, png: rendered.get(`any-${size}`) })))
);

console.log(
	JSON.stringify({
		out,
		svg: `${out}/favicon.svg`,
		ico: ICO_SIZES,
		rasters: RASTERS.flatMap(({ file }) => (file === null ? [] : [file]))
	})
);
