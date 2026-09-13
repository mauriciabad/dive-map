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

const pngSize = (file) => {
	const head = readFileSync(file).subarray(0, 24);
	if (head.subarray(1, 4).toString('latin1') !== 'PNG') return undefined;
	return { widthPx: head.readUInt32BE(16), heightPx: head.readUInt32BE(20) };
};

/**
 * Luminance spread over the finished artefact, not over the map canvas that went
 * into it. Near zero means a flat sheet: empty water, a clamped buffer, or
 * furniture drawn on nothing.
 */
const spreadOf = async (page, file) => {
	const png = file.endsWith('.pdf') ? `${file}.png` : file;
	if (file.endsWith('.pdf')) execFileSync('sips', ['-s', 'format', 'png', file, '--out', png]);
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
		([centre, zoom]) => {
			window.diveMap.jumpTo({ center: centre, zoom });
		},
		[CENTRE, ZOOM]
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
	const download = page.waitForEvent('download', { timeout: 240_000 });
	await byName(page, wanted).click();

	let saved;
	try {
		const file = await download;
		saved = join(outDir, `${testCase.name}-${file.suggestedFilename()}`);
		await file.saveAs(saved);
	} catch (e) {
		await page.close();
		return {
			case: testCase.name,
			ok: false,
			stage: 'download',
			error: String(e).slice(0, 200),
			consoleErrors: errors.slice(0, 6)
		};
	}

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
	await page.close();

	const near = (a, b) => a !== undefined && Math.abs(a - b) < 2;
	const sizeOk =
		size !== undefined &&
		(testCase.expect.kind === 'pdf'
			? near(size.widthMm, testCase.expect.widthMm) && near(size.heightMm, testCase.expect.heightMm)
			: size.widthPx === testCase.expect.widthPx && size.heightPx === testCase.expect.heightPx);

	return {
		case: testCase.name,
		ok:
			scaleHonest(render, measured) &&
			sizeOk &&
			bytes > 20_000 &&
			spread > 4 &&
			framed.cropVisible &&
			framed.backdropZIndex === '1' &&
			render?.clamped === false,
		file: saved,
		bytes,
		size,
		sizeOk,
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
