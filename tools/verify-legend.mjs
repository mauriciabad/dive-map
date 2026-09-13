#!/usr/bin/env node
/**
 * Open the legend and check it explains the seabed that is actually on screen.
 *
 * The interesting failures here are all silent. A band is a CSS background, so
 * it paints a plausible dark rectangle whether or not the texture behind it
 * decoded, and the probe image next to it exists whether or not it loaded. So
 * every row is measured twice: the probe's decoded dimensions, and a canvas
 * sample of a 64px crop of it at full resolution, which is flat only if the
 * texture is not really there. The band's own computed background-size is read
 * as well, because a band at the wrong repeat is the exact thing issue #10
 * complained about and it looks fine in a screenshot.
 *
 * The list is read again after a long pan and again after the ground layer
 * switches: a legend that never changes is indistinguishable from a hardcoded
 * one.
 *
 * Usage: node tools/verify-legend.mjs <url> [--shots docs/shots]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4181/';
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt === -1 ? undefined : process.argv[shotsAt + 1];
if (shots) mkdirSync(shots, { recursive: true });

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const REPEAT_CSS_PX = 256;

const browser = await chromium.launch();
const errors = [];

const readRows = (page) =>
	page.evaluate(async () => {
		const sample = (img) => {
			const canvas = document.createElement('canvas');
			canvas.width = 64;
			canvas.height = 64;
			const ctx = canvas.getContext('2d', { willReadFrequently: true });
			if (ctx === null) return undefined;
			try {
				ctx.drawImage(img, 0, 0, 64, 64, 0, 0, 64, 64);
				const px = ctx.getImageData(0, 0, 64, 64).data;
				let min = 255;
				let max = 0;
				let opaque = 0;
				for (let i = 0; i < px.length; i += 4) {
					const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
					min = Math.min(min, lum);
					max = Math.max(max, lum);
					if (px[i + 3] > 250) opaque += 1;
				}
				return { spread: Math.round(max - min), opaque: opaque === 64 * 64 };
			} catch {
				return undefined;
			}
		};

		const rows = [...document.querySelectorAll('.panel li.row')];
		await Promise.all(
			rows.flatMap((row) => {
				const img = row.querySelector('img');
				return img === null || img.complete ? [] : [img.decode().catch(() => undefined)];
			})
		);

		return rows.map((row) => {
			const img = row.querySelector('img');
			const band = row.querySelector('.band');
			const names = [...row.querySelectorAll('p')].map((p) => p.textContent.trim());
			const style = band === null ? undefined : getComputedStyle(band);
			const box = band === null ? undefined : band.getBoundingClientRect();
			return {
				names,
				missing: row.querySelector('.missing') !== null,
				texture: img?.getAttribute('src')?.replace(/^.*\//, ''),
				naturalWidth: img?.naturalWidth ?? 0,
				naturalHeight: img?.naturalHeight ?? 0,
				bandWidth: Math.round(box?.width ?? 0),
				bandHeight: Math.round(box?.height ?? 0),
				repeat: style?.backgroundSize,
				painted: style !== undefined && style.backgroundImage !== 'none',
				pixels: img === null ? undefined : sample(img)
			};
		});
	});

const overflow = (page) =>
	page.evaluate(() => {
		const panel = document.querySelector('.panel');
		const rect = panel?.getBoundingClientRect();
		return {
			docWidth: document.documentElement.scrollWidth,
			viewWidth: window.innerWidth,
			panelLeft: Math.round(rect?.left ?? 0),
			panelRight: Math.round(rect?.right ?? 0)
		};
	});

const drag = async (page, dx, dy, at) => {
	await page.mouse.move(at.x, at.y);
	await page.mouse.down();
	for (let step = 1; step <= 10; step += 1) {
		await page.mouse.move(at.x + (dx * step) / 10, at.y + (dy * step) / 10);
	}
	await page.mouse.up();
};

const openPage = async (viewport, locale) => {
	const page = await browser.newPage({ viewport, locale });
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(`${locale} ${m.text().slice(0, 200)}`);
	});
	page.on('pageerror', (e) => errors.push(`${locale} ${String(e).slice(0, 200)}`));
	await page.goto(url, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('.maplibregl-canvas', { timeout: 30_000 });
	await page.waitForTimeout(10_000);
	await page
		.getByRole('button', { name: /llegenda|leyenda|legend/i })
		.first()
		.click();
	await page.waitForSelector('.panel li.row', { timeout: 20_000 });
	await page.waitForTimeout(1500);
	return page;
};

const desktop = await openPage(DESKTOP, 'ca');
const first = await readRows(desktop);
const firstOverflow = await overflow(desktop);
if (shots) await desktop.screenshot({ path: `${shots}/legend-desktop-ca.png` });

for (let i = 0; i < 6; i += 1) await drag(desktop, -700, 260, { x: 1050, y: 450 });
await desktop.waitForTimeout(3500);
const panned = await readRows(desktop);
if (shots) await desktop.screenshot({ path: `${shots}/legend-panned.png` });

await desktop
	.getByRole('button', { name: /tipus de fons|tipo de fondo|seafloor type/i })
	.first()
	.click();
await desktop.waitForTimeout(3500);
const substrate = await readRows(desktop);
if (shots) await desktop.screenshot({ path: `${shots}/legend-substrate.png` });
await desktop.close();

const phone = await openPage(PHONE, 'es');
const phoneRows = await readRows(phone);
const phoneOverflow = await overflow(phone);
if (shots) await phone.screenshot({ path: `${shots}/legend-phone-es.png` });
await phone.close();

const english = await openPage(DESKTOP, 'en-GB');
const englishRows = await readRows(english);
if (shots) await english.screenshot({ path: `${shots}/legend-desktop-en.png` });
await english.close();

await browser.close();

const signature = (rows) => rows.map((r) => r.texture).join('|');
const real = (rows) =>
	rows.filter(
		(r) =>
			r.naturalWidth > 0 &&
			r.painted &&
			r.repeat === `${REPEAT_CSS_PX}px ${REPEAT_CSS_PX}px` &&
			r.bandWidth > 200 &&
			r.pixels !== undefined &&
			r.pixels.opaque &&
			// Two of the pack's textures really are nearly flat, the cave void and the
			// bare dirt, so this only separates real pixels from a blank decode.
			r.pixels.spread > 2
	).length;

const result = {
	url,
	desktopRows: first.length,
	desktopReal: real(first),
	swatchNatural: first[0]?.naturalWidth,
	swatchRepeat: first[0]?.repeat,
	bandSize: [first[0]?.bandWidth, first[0]?.bandHeight],
	anyMissingBand: first.some((r) => r.missing),
	pannedRows: panned.length,
	changedOnPan: signature(first) !== signature(panned),
	substrateRows: substrate.length,
	changedOnGround: signature(first) !== signature(substrate),
	phoneRows: phoneRows.length,
	phoneReal: real(phoneRows),
	englishRows: englishRows.length,
	catalan: first[0]?.names[0],
	spanish: phoneRows[0]?.names[0],
	english: englishRows[0]?.names[0],
	desktopOverflow: firstOverflow,
	phoneOverflow,
	consoleErrors: errors.slice(0, 6)
};

const pass =
	first.length > 0 &&
	real(first) === first.length &&
	real(phoneRows) === phoneRows.length &&
	englishRows.length > 0 &&
	result.changedOnPan &&
	result.changedOnGround &&
	result.catalan !== result.english &&
	firstOverflow.docWidth <= firstOverflow.viewWidth &&
	phoneOverflow.docWidth <= phoneOverflow.viewWidth &&
	phoneOverflow.panelLeft >= 0 &&
	phoneOverflow.panelRight <= PHONE.width &&
	errors.length === 0;

console.log(JSON.stringify({ pass, ...result }, null, 2));
process.exit(pass ? 0 : 1);
