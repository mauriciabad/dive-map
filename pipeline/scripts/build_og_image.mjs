#!/usr/bin/env node
/**
 * Draw the link preview image out of the map itself.
 *
 * A crawler reading og:image does not run JavaScript, and this site is static
 * files on GitHub Pages with nothing to render a frame on request. So the frame
 * is drawn here, from the same map a browser draws, and the file is committed.
 * Re-run it whenever the map's look changes.
 *
 * The pixels come off MapLibre's own canvas rather than off a page screenshot,
 * so no control, badge or first-run hint can land in the picture. The canvas is
 * twice the size of the image and is downsampled into it, which is what keeps
 * the isobath lines and the seabed textures from crawling.
 *
 * Needs the frozen dev server: readiness is read off `window.diveMap`, which
 * only exists under `import.meta.env.DEV`.
 *
 *     pnpm exec vite dev --config pipeline/config/vite-frozen.js --port 5220
 *     node pipeline/scripts/build_og_image.mjs --out static/og-image.jpg
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const flag = (name, fallback) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? fallback : process.argv[at + 1];
};

const url = flag('--url', 'http://localhost:5220/');
const out = flag('--out', 'static/og-image.jpg');
/**
 * The Illes Medes off L'Estartit, framed so that all eleven named dive sites
 * around the archipelago land inside the picture with their labels whole, the
 * Posidonia meadows fill the left, and the harbour shows in the top corner. A
 * frame with no land in it reads as an abstract pattern rather than as a coast.
 */
const at = flag('--at', '14.68/42.045/3.2155');
/** What every preview card crops to. Anything else gets cut by somebody. */
const width = Number(flag('--width', 1200));
const height = Number(flag('--height', 630));
/**
 * WhatsApp fetches the preview on the phone's connection and gives up on a large
 * one, so the file has to come in under a quarter of a megabyte. Quality steps
 * down until it does.
 */
const maxBytes = Number(flag('--max-bytes', 250_000));

const TITLE = 'Mapa de busseig de la costa catalana';
const HOME = 'divemap.mauri.app';
/**
 * Quoted, not written. The ICGC licence asks for its clause, and the shelf survey
 * is owed the ministry by name rather than the survey's; `ATTRIBUTION` in
 * src/lib/print/furniture.ts carries the same line onto a printed sheet.
 */
const CREDIT =
	'© ICGC · Ministerio de Agricultura, Pesca y Alimentación · Generalitat de Catalunya · OpenStreetMap';

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width, height },
	deviceScaleFactor: 2
});
const page = await context.newPage();
const problems = [];
page.on('console', (m) => {
	if (m.type() === 'error') problems.push(m.text().slice(0, 160));
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 160)}`));
page.on('response', (r) => {
	if (r.status() >= 400) problems.push(`${r.status()} ${r.url().slice(0, 110)}`);
});

await page.goto(`${url}?map=${at}`, { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(
	async ({ width, height, maxBytes, title, home, credit }) => {
		const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		const deadline = Date.now() + 90_000;

		const canvas = () => document.querySelector('.maplibregl-canvas');
		while (!canvas() && Date.now() < deadline) await wait(300);
		const map = window.diveMap;
		if (!canvas() || !map) return { error: 'no map canvas or no map handle' };

		let steady = 0;
		while (Date.now() < deadline) {
			await wait(400);
			steady = map.loaded() && map.areTilesLoaded() ? steady + 1 : 0;
			if (steady >= 4) break;
		}
		const settled = steady >= 4;
		await new Promise((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(resolve));
		});

		const source = canvas();
		const sheet = document.createElement('canvas');
		sheet.width = width;
		sheet.height = height;
		const context = sheet.getContext('2d');
		context.imageSmoothingQuality = 'high';
		// Cover, never stretch: the canvas is the window and a window is not always
		// the shape a preview card wants.
		const scale = Math.max(width / source.width, height / source.height);
		const cropW = width / scale;
		const cropH = height / scale;
		context.drawImage(
			source,
			(source.width - cropW) / 2,
			(source.height - cropH) / 2,
			cropW,
			cropH,
			0,
			0,
			width,
			height
		);

		const serif = new FontFace('OgTitle', 'url(/fonts/print/Alegreya-Bold.ttf)');
		document.fonts.add(await serif.load());
		const sans = new FontFace('OgSans', 'url(/fonts/print/AlegreyaSans-Regular.ttf)');
		document.fonts.add(await sans.load());

		const scrim = Math.round(height * 0.1);
		const fade = context.createLinearGradient(0, height - scrim, 0, height);
		fade.addColorStop(0, 'rgba(20, 16, 12, 0)');
		fade.addColorStop(1, 'rgba(20, 16, 12, 0.78)');
		context.fillStyle = fade;
		context.fillRect(0, height - scrim, width, scrim);

		const titleSize = Math.round(height * 0.068);
		const homeSize = Math.round(height * 0.032);
		const pad = Math.round(height * 0.032);
		context.font = `${titleSize}px OgTitle, serif`;
		const titleWidth = context.measureText(title).width;
		context.font = `${homeSize}px OgSans, sans-serif`;
		const homeWidth = context.measureText(home).width;
		const plateW = Math.round(Math.max(titleWidth, homeWidth) + pad * 2);
		const plateH = Math.round(pad * 1.5 + titleSize * 1.05 + homeSize * 1.5);
		const plateX = Math.round(height * 0.042);
		const plateY = height - Math.round(height * 0.052) - plateH;

		context.save();
		context.shadowColor = 'rgba(0, 0, 0, 0.5)';
		context.shadowBlur = Math.round(height * 0.028);
		context.shadowOffsetY = Math.round(height * 0.006);
		context.fillStyle = 'rgba(20, 16, 12, 0.9)';
		context.beginPath();
		context.roundRect(plateX, plateY, plateW, plateH, Math.round(height * 0.012));
		context.fill();
		context.restore();

		const rule = Math.max(1, Math.round(height * 0.0032));
		context.strokeStyle = 'rgba(198, 158, 86, 0.85)';
		context.lineWidth = rule;
		context.beginPath();
		context.roundRect(
			plateX + rule,
			plateY + rule,
			plateW - rule * 2,
			plateH - rule * 2,
			Math.round(height * 0.01)
		);
		context.stroke();

		context.textBaseline = 'alphabetic';
		context.fillStyle = '#f3e7d2';
		context.font = `${titleSize}px OgTitle, serif`;
		context.fillText(title, plateX + pad, plateY + pad * 0.75 + titleSize * 0.78);
		context.fillStyle = 'rgba(198, 158, 86, 0.95)';
		context.font = `${homeSize}px OgSans, sans-serif`;
		context.fillText(home, plateX + pad, plateY + plateH - pad * 0.75);

		const creditSize = Math.round(height * 0.0222);
		context.font = `${creditSize}px OgSans, sans-serif`;
		context.fillStyle = 'rgba(243, 231, 210, 0.72)';
		context.fillText(
			credit,
			width - context.measureText(credit).width - creditSize,
			height - creditSize * 0.85
		);

		const bytesOf = (data) => Math.floor((data.length - data.indexOf(',') - 1) * 0.75);
		let quality = 0.92;
		let data = sheet.toDataURL('image/jpeg', quality);
		while (bytesOf(data) > maxBytes && quality > 0.5) {
			quality = Math.round((quality - 0.04) * 100) / 100;
			data = sheet.toDataURL('image/jpeg', quality);
		}

		const gl = source.getContext('webgl2') ?? source.getContext('webgl');
		const side = Math.min(300, source.width, source.height);
		const pixels = new Uint8Array(side * side * 4);
		gl.readPixels(
			Math.floor((source.width - side) / 2),
			Math.floor((source.height - side) / 2),
			side,
			side,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			pixels
		);
		let sum = 0;
		let squares = 0;
		for (let i = 0; i < pixels.length; i += 4) {
			const l = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
			sum += l;
			squares += l * l;
		}
		const n = pixels.length / 4;
		const mean = sum / n;

		return {
			data,
			settled,
			quality,
			canvas: { width: source.width, height: source.height },
			mean: +mean.toFixed(1),
			spread: +Math.sqrt(squares / n - mean * mean).toFixed(2),
			isobaths: map.queryRenderedFeatures({ layers: ['isobath'] }).length
		};
	},
	{ width, height, maxBytes, title: TITLE, home: HOME, credit: CREDIT }
);

await browser.close();

if (result.error) {
	console.error(result.error);
	process.exit(1);
}

const bytes = Buffer.from(result.data.slice(result.data.indexOf(',') + 1), 'base64');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);

const painted = result.spread > 3 && result.settled;
console.log(
	JSON.stringify(
		{
			out,
			at,
			width,
			height,
			bytes: bytes.length,
			quality: result.quality,
			settled: result.settled,
			canvas: result.canvas,
			pixels: { mean: result.mean, spread: result.spread },
			isobaths: result.isobaths,
			problems: problems.slice(0, 8)
		},
		null,
		2
	)
);
process.exit(painted ? 0 : 1);
