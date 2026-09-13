#!/usr/bin/env node
/**
 * Drive the real print path and check the artefacts that fall out.
 *
 * Everything about this feature can look fine and still produce a sheet that is
 * blank, the wrong size, silently downscaled, or printed at a scale it does not
 * claim: MapLibre clamps an oversized canvas without telling you, and
 * `getPixelRatio()` keeps reporting the value you asked for. So this opens the
 * page, frames a sheet through the real controls, exports it, and reads the
 * bytes back.
 *
 * Usage: node pipeline/scripts/verify-export.mjs <url> [--out dir] [--case name]
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5179/';
const arg = (name, fallback) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? fallback : process.argv[at + 1];
};
const outDir = arg('--out', '/tmp/dive-export');
const only = arg('--case', undefined);
mkdirSync(outDir, { recursive: true });

/** Seabed, not open water: a blank sheet and a broken sheet look the same. */
const CENTRE = [3.2136, 41.9087];
const ZOOM = 15.2;

const byName = (page, name) => page.getByRole('button', { name }).first();

const setNumber = async (page, label, value) => {
	const field = page.getByLabel(label).first();
	await field.fill(String(value));
	await field.blur();
};

const CASES = [
	{
		name: 'a3-portrait-pdf',
		format: 'pdf',
		setUp: async (page) => {
			await page.waitForTimeout(1);
		},
		expect: { kind: 'pdf', widthMm: 297, heightMm: 420 }
	},
	{
		name: 'a4-landscape-pdf',
		format: 'pdf',
		setUp: async (page) => {
			await byName(page, 'A4').click();
			await byName(page, /^Landscape$/).click();
		},
		expect: { kind: 'pdf', widthMm: 297, heightMm: 210 }
	},
	{
		name: 'custom-mm-pdf',
		format: 'pdf',
		setUp: async (page) => {
			await byName(page, /^Custom$/).click();
			await setNumber(page, 'Width', 500);
			await setNumber(page, 'Height', 250);
		},
		expect: { kind: 'pdf', widthMm: 500, heightMm: 250 }
	},
	{
		name: 'custom-px-png',
		format: 'png',
		setUp: async (page) => {
			await byName(page, /^Pixels$/).click();
			await setNumber(page, 'Width', 1600);
			await setNumber(page, 'Height', 1200);
		},
		expect: { kind: 'png', widthPx: 1600, heightPx: 1200 }
	},
	{
		name: 'a3-png',
		format: 'png',
		setUp: async (page) => {
			await byName(page, /^PNG$/).click();
		},
		expect: { kind: 'png', widthPx: 2339, heightPx: 3307 }
	},
	{
		name: 'zoom-framed-pdf',
		format: 'pdf',
		setUp: async (page) => {
			await byName(page, 'By zoom').click();
			await page.getByRole('slider', { name: 'Zoom' }).first().fill('17');
		},
		expect: { kind: 'pdf', widthMm: 297, heightMm: 420 }
	},
	{
		name: 'a2-portrait-pdf',
		format: 'pdf',
		setUp: async (page) => {
			await byName(page, 'A2').click();
		},
		expect: { kind: 'pdf', widthMm: 420, heightMm: 594 }
	},
	{
		name: 'a5-portrait-pdf',
		format: 'pdf',
		setUp: async (page) => {
			await byName(page, 'A5').click();
		},
		expect: { kind: 'pdf', widthMm: 148, heightMm: 210 }
	},
	{
		// The one that matters for the arrow. A card framed at a bearing is the whole
		// reason north has to be drawn rather than assumed to be up.
		name: 'rotated-pdf',
		bearing: 52,
		format: 'pdf',
		setUp: async (page) => {
			await page.waitForTimeout(1);
		},
		expect: { kind: 'pdf', widthMm: 297, heightMm: 420 }
	},
	{
		name: 'bleed-3mm-rotated-pdf',
		bearing: 305,
		format: 'pdf',
		setUp: async (page) => {
			await byName(page, /^3 mm$/).click();
		},
		// Paper grows by the bleed on all four sides; the card inside stays A3.
		expect: { kind: 'pdf', widthMm: 303, heightMm: 426, trimMm: { widthMm: 297, heightMm: 420 } }
	},
	{
		// A3 at 300 dpi is past the canvas ceiling, so A4 is the biggest sheet that
		// prints at the density a print shop asks for. Every element is switched off,
		// which leaves the raster the renderer produced and nothing drawn over it, so
		// `straightEdge` below can read the map rather than the furniture.
		name: 'bare-300dpi-png',
		format: 'png',
		bare: true,
		setUp: async (page) => {
			await byName(page, 'A4').click();
			await byName(page, /^300$/).click();
			await byName(page, /^None$/).click();
			await byName(page, /^PNG$/).click();
		},
		expect: { kind: 'png', widthPx: 2480, heightPx: 3508 }
	}
];

const mm = (pt) => +((Number(pt) * 25.4) / 72).toFixed(1);

/** Within a quarter of a percent of what the sheet says it covers. */
const scaleHonest = (render, measured) =>
	render != null && Math.abs(measured - render.groundWidthM) / render.groundWidthM < 0.0025;

const pdfSize = (file) => {
	const text = readFileSync(file).toString('latin1');
	const box = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(text);
	if (!box) return undefined;
	return { widthMm: mm(box[3]), heightMm: mm(box[4]) };
};

/**
 * The rectangle a guillotine is told to cut to. A bleed without this is a page a
 * few millimetres too big and nothing to say by how much, so it is checked rather
 * than assumed.
 */
const pdfTrim = (file) => {
	const text = readFileSync(file).toString('latin1');
	const box = /\/TrimBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(text);
	if (!box) return undefined;
	return {
		widthMm: mm(Number(box[3]) - Number(box[1])),
		heightMm: mm(Number(box[4]) - Number(box[2]))
	};
};

const pngSize = (file) => {
	const head = readFileSync(file).subarray(0, 24);
	if (head.subarray(1, 4).toString('latin1') !== 'PNG') return undefined;
	return { widthPx: head.readUInt32BE(16), heightPx: head.readUInt32BE(20) };
};

/**
 * The sheet as pixels, whatever it was written as. PDFs rasterise big enough that
 * the N in the north arrow survives: at 72 dpi it comes out eight pixels tall and
 * there is nothing left to take a centroid of.
 */
const rasterise = (file) => {
	if (!file.endsWith('.pdf')) return file;
	const png = `${file}.png`;
	execFileSync('sips', [
		'-s',
		'format',
		'png',
		'--resampleHeightWidthMax',
		'2400',
		file,
		'--out',
		png
	]);
	return png;
};

/**
 * Luminance spread over the finished artefact, not over the map canvas that went
 * into it. Near zero means a flat sheet: empty water, a clamped buffer, or
 * furniture drawn on nothing.
 */
const spreadOf = async (page, file) => {
	const png = rasterise(file);
	const dataUrl = `data:image/png;base64,${readFileSync(png).toString('base64')}`;
	return page.evaluate(async (src) => {
		const image = new Image();
		await new Promise((resolve, reject) => {
			image.onload = resolve;
			image.onerror = reject;
			image.src = src;
		});
		const side = 400;
		const scale = Math.min(1, side / Math.max(image.width, image.height));
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(image.width * scale));
		canvas.height = Math.max(1, Math.round(image.height * scale));
		const ctx = canvas.getContext('2d');
		ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
		const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
		let sum = 0;
		let sumSq = 0;
		const n = data.length / 4;
		for (let i = 0; i < data.length; i += 4) {
			const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
			sum += l;
			sumSq += l * l;
		}
		const mean = sum / n;
		return Math.round(Math.sqrt(sumSq / n - mean * mean) * 100) / 100;
	}, dataUrl);
};

/** Below this the two pixels are the same seabed; above it a person sees a line. */
const HARD_STEP = 10;

/**
 * The longest hard straight edge on the sheet, as the fraction of the sheet it
 * runs across.
 *
 * A seabed is mottled, so neighbouring pixels differ by ones and twos and a run of
 * one column stepping hard against the next is not something the map draws. What
 * does draw one is a tile: whatever a tile fails to paint, it fails to paint right
 * up to its own edge, and that edge is straight, one pixel wide and hundreds of
 * millimetres long. That is how a whole quarter of a printed card came back with no
 * seabed on it while every check the renderer had said the sheet was finished.
 *
 * Reported as a fraction rather than a pixel count so one number compares sheets of
 * any size, against the median of the same measurement as the floor.
 */
const straightEdge = async (page, file) => {
	const dataUrl = `data:image/png;base64,${readFileSync(rasterise(file)).toString('base64')}`;
	return page.evaluate(
		async ([src, step]) => {
			const image = new Image();
			await new Promise((resolve, reject) => {
				image.onload = resolve;
				image.onerror = reject;
				image.src = src;
			});
			const canvas = document.createElement('canvas');
			canvas.width = image.width;
			canvas.height = image.height;
			const ctx = canvas.getContext('2d', { willReadFrequently: true });
			ctx.drawImage(image, 0, 0);
			const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const lum = new Float32Array(width * height);
			for (let i = 0; i < width * height; i++) {
				lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
			}
			// A sheet that bleeds has a hard edge where the paper ends, and a PDF
			// rasterises with a pixel of white on the outside. Neither is the map.
			const inset = Math.round(Math.min(width, height) * 0.02);
			const runs = (count, along, at) => {
				const scores = [];
				for (let i = inset; i < count - inset - 1; i++) {
					let hits = 0;
					let n = 0;
					for (let j = inset; j < along - inset; j++) {
						if (Math.abs(lum[at(i + 1, j)] - lum[at(i, j)]) > step) hits++;
						n++;
					}
					scores.push({ at: i, cover: hits / n });
				}
				return scores;
			};
			const best = (scores) =>
				scores.reduce((top, one) => (one.cover > top.cover ? one : top), { at: -1, cover: 0 });
			const median = (scores) => {
				const sorted = scores.map((one) => one.cover).sort((a, b) => a - b);
				return sorted[Math.floor(sorted.length / 2)] ?? 0;
			};
			const columns = runs(width, height, (x, y) => y * width + x);
			const rows = runs(height, width, (y, x) => y * width + x);
			const round = (value) => Math.round(value * 1000) / 1000;
			return {
				width,
				height,
				column: { at: best(columns).at, cover: round(best(columns).cover) },
				row: { at: best(rows).at, cover: round(best(rows).cover) },
				median: round(Math.max(median(columns), median(rows)))
			};
		},
		[dataUrl, HARD_STEP]
	);
};

/**
 * What a seabed alone produces. Measured at 0.09 on a healthy 300 dpi A4; the sheet
 * that carried the seam measured 0.95 on the same scan, so anything in between is a
 * line somebody drew rather than ground somebody surveyed.
 */
const EDGE_LIMIT = 0.35;

/**
 * Waits until the export button has stopped working, and reports what the panel is
 * warning about once it has.
 *
 * A refused export never produces a file, so waiting only on a download spent four
 * minutes to report a bare timeout while the panel had been showing the reason the
 * whole time. That is how the By zoom case sat undiagnosed. Nothing here rejects:
 * a loser that rejects after the winner has been read takes the whole script down
 * with an unhandled rejection, which is a worse way to learn nothing.
 */
const exportFinished = async (page) => {
	let started = false;
	for (let waited = 0; waited < 260_000; waited += 500) {
		await page.waitForTimeout(500);
		const working = await page
			.locator('.action[data-busy="true"]')
			.count()
			.catch(() => 0);
		if (working > 0) started = true;
		else if (started) break;
	}
	if (!started) return 'the export button never started working';
	const notes = await page
		.locator('.note[data-tone="warn"]')
		.allTextContents()
		.catch(() => []);
	return notes.join(' | ').slice(0, 220) || 'nothing at all';
};

const after = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Which way north actually lies on the sheet, asked of the projection rather than
 * worked out again. A bearing's sign is the easiest thing in the print path to get
 * backwards while every piece of arithmetic agrees with itself.
 */
const northFromProjection = (page, centre, zoom, bearing) =>
	page.evaluate(
		([lng, lat, z, b]) => {
			const m = window.diveMap;
			m.jumpTo({ center: [lng, lat], zoom: z, bearing: b });
			const here = m.project([lng, lat]);
			const up = m.project([lng, lat + 0.002]);
			const dx = up.x - here.x;
			const dy = up.y - here.y;
			const length = Math.hypot(dx, dy);
			return { x: dx / length, y: dy / length };
		},
		[centre[0], centre[1], zoom, bearing]
	);

/**
 * Which way the printed arrow says north is.
 *
 * The N is the only brass ink inside the arrow's plate once the plate's own border
 * is masked off, so the centroid of the brass pixels is the direction the needle
 * points. This reads the finished file: a check that recomputed the rotation from
 * the bearing would agree with the code that drew it however wrong both were.
 */
const northFromSheet = async (page, file, plate) => {
	const dataUrl = `data:image/png;base64,${readFileSync(rasterise(file)).toString('base64')}`;
	return page.evaluate(
		async ([src, box]) => {
			const image = new Image();
			await new Promise((resolve, reject) => {
				image.onload = resolve;
				image.onerror = reject;
				image.src = src;
			});
			// The rendered page may be at any density; the plate is in sheet pixels.
			const k = image.width / box.sheetWidth;
			const x0 = Math.round(box.x * k);
			const y0 = Math.round(box.y * k);
			const side = Math.round(box.w * k);
			const canvas = document.createElement('canvas');
			canvas.width = side;
			canvas.height = side;
			const ctx = canvas.getContext('2d');
			ctx.drawImage(image, x0, y0, side, side, 0, 0, side, side);
			const { data } = ctx.getImageData(0, 0, side, side);
			const half = side / 2;
			// Inside the plate border, which is brass too, and outside the needle.
			const keep = half * (11 / 12);
			let sx = 0;
			let sy = 0;
			let n = 0;
			for (let y = 0; y < side; y++) {
				for (let x = 0; x < side; x++) {
					const dx = x - half;
					const dy = y - half;
					if (Math.hypot(dx, dy) > keep) continue;
					const i = (y * side + x) * 4;
					const r = data[i];
					const g = data[i + 1];
					const b = data[i + 2];
					if (r > 120 && r - b > 55 && g > b && g < r) {
						sx += dx;
						sy += dy;
						n++;
					}
				}
			}
			if (n < 20) return { x: 0, y: 0, pixels: n };
			const length = Math.hypot(sx, sy);
			return { x: sx / length, y: sy / length, pixels: n };
		},
		[dataUrl, plate]
	);
};

/** Degrees between two unit vectors, for reporting rather than for deciding. */
const apart = (a, b) => Math.round((Math.acos(Math.min(1, a.x * b.x + a.y * b.y)) * 180) / Math.PI);

const runCase = async (context, testCase) => {
	const page = await context.newPage();
	const errors = [];
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text().slice(0, 160));
	});
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));

	await page.goto(url, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => Boolean(window.diveMap), undefined, { timeout: 90_000 });
	await page.evaluate(
		([centre, zoom, bearing]) => {
			window.diveMap.jumpTo({ center: centre, zoom, bearing });
		},
		[CENTRE, ZOOM, testCase.bearing ?? 0]
	);
	await page.waitForTimeout(9000);

	// The panel is the whole interface: opening it frames the sheet, closing it
	// unframes it, and there is no separate toggle to click any more.
	await byName(page, /^Print$/).click();
	await page.waitForTimeout(400);
	await testCase.setUp(page);
	await page.waitForTimeout(400);

	const framed = await page.evaluate(() => {
		const stage = document.querySelector('.stage');
		const crop = stage?.firstElementChild;
		const box = crop?.getBoundingClientRect();
		const zIndex = stage ? getComputedStyle(stage).zIndex : null;
		const ctrl = document.querySelector('.maplibregl-ctrl-top-right');
		return {
			cropVisible: Boolean(box && box.width > 1),
			cropWidthCss: box ? Math.round(box.width) : 0,
			cropHeightCss: box ? Math.round(box.height) : 0,
			backdropZIndex: zIndex,
			controlZIndex: ctrl ? getComputedStyle(ctrl).zIndex : null
		};
	});

	const wanted = testCase.format === 'pdf' ? /^Export PDF$/ : /^Export PNG$/;
	const download = page.waitForEvent('download', { timeout: 260_000 }).catch(() => undefined);
	await byName(page, wanted).click();
	const panel = await exportFinished(page);

	// The button is back, so a file that was going to arrive already has.
	const file = await Promise.race([download, after(5_000)]);
	if (file === undefined) {
		await page.close();
		return {
			case: testCase.name,
			ok: false,
			stage: 'download',
			error: `the export ended without a file. The panel says: ${panel}`,
			consoleErrors: errors.slice(0, 6)
		};
	}
	const saved = join(outDir, `${testCase.name}-${file.suggestedFilename()}`);
	await file.saveAs(saved);

	const render = await page.evaluate(() => window.lastRender ?? null);

	// The sheet's claimed ground width against MapLibre's own projection at the
	// zoom the sheet was drawn at. This is the check the old code would have
	// failed by a factor of four while looking perfectly fine.
	const measured = await page.evaluate(
		([lat, lng, zoom, widthPx, pixelRatio]) => {
			const m = window.diveMap;
			m.jumpTo({ center: [lng, lat], zoom, bearing: 0 });
			const a = m.unproject([100, 450]);
			const b = m.unproject([600, 450]);
			const R = 6378137;
			const metresPerCssPixel =
				(Math.abs(b.lng - a.lng) * (Math.PI / 180) * R * Math.cos((lat * Math.PI) / 180)) / 500;
			return Math.round((widthPx / pixelRatio) * metresPerCssPixel * 10) / 10;
		},
		[
			CENTRE[1],
			CENTRE[0],
			render?.renderZoom ?? 0,
			render?.width ?? 0,
			// The sheet is drawn one zoom level down at twice the pixel ratio, so the
			// ratio is whatever that gap says it is rather than a constant.
			render === undefined ? 2 : 2 ** (render.zoom - render.renderZoom)
		]
	);
	const bytes = statSync(saved).size;
	const size = testCase.expect.kind === 'pdf' ? pdfSize(saved) : pngSize(saved);
	const spread = await spreadOf(page, saved);
	// Only on a sheet with the furniture switched off. A legend plate has hard
	// straight sides of its own, and they are supposed to be there.
	const edge = testCase.bare === true ? await straightEdge(page, saved) : undefined;
	const edgeOk = edge === undefined || Math.max(edge.column.cover, edge.row.cover) < EDGE_LIMIT;

	// Where the printed arrow says north is, against where the projection puts it.
	const bearing = testCase.bearing ?? 0;
	const wantedNorth = await northFromProjection(page, CENTRE, render?.renderZoom ?? 0, bearing);
	const drawnNorth =
		render?.northPlate === undefined
			? { x: 0, y: 0, pixels: 0 }
			: await northFromSheet(page, saved, { ...render.northPlate, sheetWidth: render.width });
	const northOffBy = apart(drawnNorth, wantedNorth);
	// Four degrees: the N is a glyph, not a point, so its centroid sits a little off
	// the axis. Anything that misreads the bearing is out by tens of degrees. A bare
	// sheet has no arrow, and brass ink where the plate would be would mean the
	// element toggles never reached the file.
	const northOk =
		testCase.bare === true ? drawnNorth.pixels < 20 : drawnNorth.pixels > 20 && northOffBy <= 4;

	const trim = testCase.expect.trimMm === undefined ? undefined : pdfTrim(saved);
	await page.close();

	const near = (a, b) => a !== undefined && Math.abs(a - b) < 2;
	const sizeOk =
		size !== undefined &&
		(testCase.expect.kind === 'pdf'
			? near(size.widthMm, testCase.expect.widthMm) && near(size.heightMm, testCase.expect.heightMm)
			: size.widthPx === testCase.expect.widthPx && size.heightPx === testCase.expect.heightPx);
	const trimOk =
		testCase.expect.trimMm === undefined ||
		(trim !== undefined &&
			near(trim.widthMm, testCase.expect.trimMm.widthMm) &&
			near(trim.heightMm, testCase.expect.trimMm.heightMm));

	return {
		case: testCase.name,
		ok:
			scaleHonest(render, measured) &&
			sizeOk &&
			trimOk &&
			northOk &&
			edgeOk &&
			bytes > 20_000 &&
			spread > 4 &&
			framed.cropVisible &&
			framed.backdropZIndex === '1' &&
			render?.clamped === false,
		file: saved,
		bytes,
		size,
		sizeOk,
		trim,
		trimOk,
		bearing,
		north: { drawn: drawnNorth, wanted: wantedNorth, offByDegrees: northOffBy, ok: northOk },
		edge,
		edgeOk,
		spread,
		groundWidthM: render?.groundWidthM ?? null,
		measuredGroundWidthM: measured,
		scaleHonest: scaleHonest(render, measured),
		framed,
		render,
		consoleErrors: errors.slice(0, 6)
	};
};

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
	acceptDownloads: true
});

const results = [];
for (const testCase of CASES) {
	if (only !== undefined && testCase.name !== only) continue;
	results.push(await runCase(context, testCase));
}
await browser.close();

console.log(JSON.stringify({ url, ok: results.every((r) => r.ok), results }, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
