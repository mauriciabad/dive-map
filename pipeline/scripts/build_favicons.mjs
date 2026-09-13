#!/usr/bin/env node
/**
 * Optimise the owner's three drawings and cut every served icon out of them.
 *
 * `pipeline/icons/` is the artwork, unoptimised, exactly as it was exported, and
 * nothing here ever writes to it. It sits under `pipeline/` rather than next to
 * `static/` so that the one directory a reader can mistake for served files is
 * the one that actually is served. Each file is a separate composition rather
 * than one drawing at three paddings, and which one feeds which asset is the
 * whole point of this script:
 *
 *   full      a square that bleeds to all four edges. Apple rounds
 *             apple-touch-icon itself, so handing it the pre-rounded drawing
 *             rounds it twice and bites a crescent out of the paint.
 *   rounded   carries its own corner radius, for the surfaces that composite an
 *             icon without shaping it: a browser tab, a desktop shortcut, the
 *             `purpose: any` manifest entries.
 *   maskable  the same scene pulled back so the subject sits inside the centre
 *             circle of 80% of the canvas that the spec guarantees, with paint
 *             running off every edge. Android crops this to whatever shape it
 *             likes and lands on sea rather than on a border.
 *
 * svgo is held to renders, not to bytes. Every optimisation is rasterised
 * against its own source at every size this script ships and compared pixel by
 * pixel before anything is written.
 *
 * Three plugins were measured moving paint and are configured off or exact.
 * `mergePaths` shifted ~240 pixels per drawing to save 57 bytes. Rounding
 * attribute values through `cleanupNumericValues` moved an edge for 37 bytes.
 * `convertPathData` is where the 4.5 KB actually is, so it is kept with the
 * transforms that only approximate a curve turned off; what is left of it is
 * exact at 16, 32, 48 and 180, and moves a handful of antialiased pixels along
 * one diagonal at 192 and 512. `removeViewBox` is not in svgo 4's default
 * preset and needs no override, but the viewBox does have to survive, because
 * every raster below sets its own width and height and scales to it.
 *
 * Usage: node pipeline/scripts/build_favicons.mjs [--src pipeline/icons] [--out static]
 *        node pipeline/scripts/build_favicons.mjs --contact <png>
 */
import { chromium } from 'playwright';
import { optimize } from 'svgo';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCES = {
	full: 'favicon-full.svg',
	rounded: 'favicon-rounded.svg',
	maskable: 'favicon-maskable.svg'
};

/**
 * The tab, the .ico and the desktop shortcut all composite the icon unshaped,
 * so they take the drawing that brings its own corners. Checked at 16 px rather
 * than assumed: `--contact` renders that column at actual size beside a 4x
 * blow-up, and the full-bleed square loses its silhouette against a dark tab
 * strip where the rounded one keeps it.
 */
const UNSHAPED = 'rounded';

const OUTPUTS = [
	{ file: 'apple-touch-icon.png', source: 'full', size: 180 },
	{ file: 'icons/icon-192.png', source: UNSHAPED, size: 192 },
	{ file: 'icons/icon-512.png', source: UNSHAPED, size: 512 },
	{ file: 'icons/icon-maskable-192.png', source: 'maskable', size: 192 },
	{ file: 'icons/icon-maskable-512.png', source: 'maskable', size: 512 }
];

const ICO_SIZES = [16, 32, 48];

/** A channel step this small is invisible on any screen. */
const TOLERANCE = 2;

const SVGO = {
	multipass: true,
	plugins: [
		{
			name: 'preset-default',
			params: {
				overrides: {
					mergePaths: false,
					cleanupNumericValues: { floatPrecision: 6 },
					convertPathData: {
						floatPrecision: 3,
						makeArcs: false,
						straightCurves: false,
						convertToQ: false,
						curveSmoothShorthands: false,
						smartArcRounding: false
					}
				}
			}
		},
		'removeDimensions'
	]
};

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : process.argv[i + 1];
};

const dataUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * ICO with PNG payloads. The BMP form needs a doubled-height AND mask and
 * bottom-up rows; every browser since IE11 reads the PNG form and the file is a
 * third of the size.
 */
const encodeIco = (entries) => {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(entries.length, 4);

	const directory = Buffer.alloc(16 * entries.length);
	let at = header.length + directory.length;
	entries.forEach(({ size, png }, i) => {
		const e = i * 16;
		directory.writeUInt8(size >= 256 ? 0 : size, e);
		directory.writeUInt8(size >= 256 ? 0 : size, e + 1);
		directory.writeUInt16LE(1, e + 4);
		directory.writeUInt16LE(32, e + 6);
		directory.writeUInt32LE(png.length, e + 8);
		directory.writeUInt32LE(at, e + 12);
		at += png.length;
	});

	return Buffer.concat([header, directory, ...entries.map((e) => e.png)]);
};

const src = resolve(arg('src', 'pipeline/icons'));
const out = resolve(arg('out', 'static'));
const contact = arg('contact', null);

const art = Object.fromEntries(
	Object.entries(SOURCES).map(([name, file]) => {
		const original = readFileSync(`${src}/${file}`, 'utf8');
		const optimised = optimize(original, { ...SVGO, path: `${src}/${file}` }).data;
		return [name, { file, original, optimised }];
	})
);

/** Every size this run will actually write, each drawing measured at each. */
const SHIPPED = [...new Set([...ICO_SIZES, ...OUTPUTS.map((o) => o.size)])].sort((a, b) => a - b);

const browser = await chromium.launch();
const page = await browser.newPage();

const parity = [];
for (const [name, drawing] of Object.entries(art)) {
	for (const size of SHIPPED) {
		const measured = await page.evaluate(
			async ([before, after, size, tolerance]) => {
				const pixels = async (svg) => {
					const img = new Image(size, size);
					img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
					await img.decode();
					const canvas = new OffscreenCanvas(size, size);
					const context = canvas.getContext('2d', { willReadFrequently: true });
					context.clearRect(0, 0, size, size);
					context.drawImage(img, 0, 0, size, size);
					return context.getImageData(0, 0, size, size).data;
				};
				const a = await pixels(before);
				const b = await pixels(after);
				let worst = 0;
				let over = 0;
				for (let i = 0; i < a.length; i += 4) {
					let here = 0;
					for (let c = 0; c < 4; c += 1) here = Math.max(here, Math.abs(a[i + c] - b[i + c]));
					worst = Math.max(worst, here);
					if (here > tolerance) over += 1;
				}
				return { worst, over };
			},
			[drawing.original, drawing.optimised, size, TOLERANCE]
		);
		/*
		 * An edge that moved by a fraction of a pixel touches at most a pixel or
		 * two per row, so it scales with the side of the canvas. Anything
		 * structural — a dropped shape, a flipped fill rule, two paths merged —
		 * paints an area and scales with the square of it. One pixel per row is
		 * the line between those two, and it is 8x above anything measured here.
		 */
		parity.push({ name, size, ...measured, allowed: size, ok: measured.over <= size });
	}
}

const drifted = parity.filter((p) => !p.ok);

const shoot = async (svg, size) => {
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<style>html,body{margin:0}img{display:block}</style>
		<img src="${dataUri(svg)}" width="${size}" height="${size}">`
	);
	return page.locator('img').screenshot({ omitBackground: true });
};

if (contact !== null) {
	const plate = (name, label) => {
		const uri = dataUri(art[name].optimised);
		const shaped = (kind) =>
			`<div class="cell"><div class="${kind}"><img src="${uri}" width="150" height="150"></div><span>${kind}</span></div>`;
		return `<div class="col"><div class="row">
			<div class="cell"><img src="${uri}" width="150" height="150"><span>as drawn</span></div>
			${shaped('circle')}${shaped('squircle')}
			<div class="cell"><div class="safe"><img src="${uri}" width="150" height="150"></div><span>safe zone</span></div>
			${ICO_SIZES.map(
				(
					s
				) => `<div class="cell"><div class="tab"><img src="${uri}" width="${s}" height="${s}"></div>
					<img class="zoom" src="${uri}" width="${s * 4}" height="${s * 4}"><span>${s} px, and 4x</span></div>`
			).join('')}
			</div><b>${label}</b></div>`;
	};
	await page.setViewportSize({ width: 1220, height: 1000 });
	await page.setContent(`<style>
		body{margin:0;background:#efe4cf;font:12px system-ui;padding:16px}
		.col{margin-bottom:20px}
		.row{display:flex;gap:22px;align-items:flex-start}
		.cell{display:flex;flex-direction:column;align-items:center;gap:6px}
		.tab{background:#2b2b2b;padding:9px;border-radius:8px 8px 0 0;display:flex}
		.zoom{image-rendering:pixelated;border:1px solid #8a8073}
		.circle{clip-path:circle(50%);display:flex}
		.squircle{clip-path:inset(0 round 34px);display:flex}
		.safe{position:relative;display:flex}
		.safe::after{content:'';position:absolute;inset:10%;border:2px dashed #d4553f;border-radius:50%}
		b{display:block;margin-top:8px;font-size:13px}
		</style>
		${plate('full', 'full &rarr; apple-touch-icon')}
		${plate('rounded', 'rounded &rarr; favicon.svg, favicon.ico, purpose: any')}
		${plate('maskable', 'maskable &rarr; purpose: maskable')}`);
	await page.screenshot({ path: resolve(contact), fullPage: true });
	await browser.close();
	console.log(JSON.stringify({ contact: resolve(contact), parity }, null, 2));
	process.exit(0);
}

if (drifted.length > 0) {
	await browser.close();
	console.error(
		`svgo changed the render:\n  ${drifted
			.map(
				(d) =>
					`${d.name} at ${d.size}: ${d.over} pixels over ${d.allowed}, worst channel ${d.worst}`
			)
			.join('\n  ')}`
	);
	process.exit(1);
}

mkdirSync(`${out}/icons`, { recursive: true });
writeFileSync(`${out}/favicon.svg`, `${art[UNSHAPED].optimised}\n`);

const rasters = [];
for (const { file, source, size } of OUTPUTS) {
	writeFileSync(`${out}/${file}`, await shoot(art[source].optimised, size));
	rasters.push({ file, source, size });
}

const ico = [];
for (const size of ICO_SIZES) ico.push({ size, png: await shoot(art[UNSHAPED].optimised, size) });
writeFileSync(`${out}/favicon.ico`, encodeIco(ico));

await browser.close();

console.log(
	JSON.stringify(
		{
			svg: Object.entries(art).map(([name, a]) => ({
				name,
				file: a.file,
				before: Buffer.byteLength(a.original),
				after: Buffer.byteLength(a.optimised)
			})),
			parity,
			favicon: { file: 'favicon.svg', source: UNSHAPED },
			ico: { file: 'favicon.ico', source: UNSHAPED, sizes: ICO_SIZES },
			rasters
		},
		null,
		2
	)
);
