#!/usr/bin/env node
/**
 * Ask a real Chrome whether it would offer to install this, and check the icons
 * it would use are the icons we think we shipped.
 *
 * Two failures this exists to catch. The first is a manifest that parses and is
 * still uninstallable, because the criteria are Chrome's and no amount of
 * reading the JSON tells you whether it met them; `Page.getInstallabilityErrors`
 * is Chrome's own answer and it is the only one worth having. The second is the
 * path trap: `start_url` and `scope` resolve against the manifest's URL, not
 * against the origin, so a leading slash works at divemap.mauri.app and quietly
 * installs the wrong thing under /dive-map/ on the github.io project URL. Run
 * this against both, from the same build, or it has not been checked.
 *
 * Pixel dimensions come out of each PNG's IHDR rather than out of the filename,
 * because a 512 that is really a 192 upscaled is exactly the kind of thing a
 * filename will happily lie about.
 *
 * Usage: node pipeline/scripts/verify-pwa.mjs <base-url> [--shots docs/shots]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:4173/';
const shotsAt = process.argv.indexOf('--shots');
const shots = resolve(shotsAt === -1 ? 'docs/shots' : process.argv[shotsAt + 1]);

const failures = [];
const check = (ok, what, detail) => {
	if (!ok) failures.push(detail === undefined ? what : `${what}: ${detail}`);
	return ok;
};

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const pngSize = (bytes) => {
	if (bytes.length < 24) return null;
	for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
		if (bytes[i] !== PNG_SIGNATURE[i]) return null;
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
};

/** ICO stores 256 as 0, which is the one place the format is not literal. */
const icoEntries = (bytes) => {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) return null;
	const count = view.getUint16(4, true);
	return Array.from({ length: count }, (unused, i) => {
		const at = 6 + i * 16;
		const declared = bytes[at] === 0 ? 256 : bytes[at];
		const offset = view.getUint32(at + 12, true);
		const length = view.getUint32(at + 8, true);
		return { declared, payload: pngSize(bytes.subarray(offset, offset + length)) };
	});
};

const fetchBytes = async (url) => {
	const response = await fetch(url);
	const bytes = new Uint8Array(await response.arrayBuffer());
	return { status: response.status, type: response.headers.get('content-type') ?? '', bytes };
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 430, height: 860 } });
await context.addInitScript(() => {
	window.addEventListener('beforeinstallprompt', () => {
		Object.defineProperty(window, '__installPromptFired', { value: true });
	});
});

const page = await context.newPage();
const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => {
	if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160));
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 160)}`));
page.on('response', (r) => {
	if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(0, 110)}`);
});

const cdp = await context.newCDPSession(page);
await cdp.send('Page.enable');
await page.goto(base, { waitUntil: 'load' });

const root = new URL('.', page.url()).href;

const manifestHref = await page.getAttribute('link[rel=manifest]', 'href');
check(manifestHref !== null, 'no <link rel=manifest> in the served HTML');
if (manifestHref !== null) {
	check(
		!manifestHref.startsWith('/') && !/^[a-z]+:/.test(manifestHref),
		'manifest href is not relative, so it cannot work under a project subpath',
		manifestHref
	);
}

const manifestUrl = new URL(manifestHref ?? 'manifest.webmanifest', page.url()).href;
const manifestResponse = await fetch(manifestUrl);
check(
	manifestResponse.status === 200,
	'manifest did not return 200',
	String(manifestResponse.status)
);

let manifest = null;
const manifestText = await manifestResponse.text();
try {
	manifest = JSON.parse(manifestText);
} catch (error) {
	check(false, 'manifest is not valid JSON', error.message.split('\n')[0]);
}

const resolvedIcons = [];
let startUrl = null;
let scope = null;

if (manifest !== null) {
	startUrl = new URL(manifest.start_url, manifestUrl).href;
	scope = new URL(manifest.scope, manifestUrl).href;
	check(
		startUrl === root,
		'start_url does not resolve to the deployment root',
		`${startUrl} vs ${root}`
	);
	check(scope === root, 'scope does not resolve to the deployment root', `${scope} vs ${root}`);
	check(startUrl.startsWith(scope), 'start_url is outside scope', `${startUrl} vs ${scope}`);

	check(manifest.display === 'standalone', 'display is not standalone', manifest.display);
	check(
		manifest.theme_color === '#14100c',
		'theme_color is not the app chrome',
		manifest.theme_color
	);
	check(
		manifest.background_color === manifest.theme_color,
		'background_color and theme_color disagree, so the splash flashes',
		`${manifest.background_color} vs ${manifest.theme_color}`
	);
	for (const field of ['name', 'short_name', 'description']) {
		check(typeof manifest[field] === 'string' && manifest[field].length > 0, `${field} is empty`);
	}
	check(
		manifest.short_name.length <= 12,
		'short_name is longer than a home screen shows',
		`${manifest.short_name.length} characters`
	);

	const pngs = manifest.icons.filter((icon) => icon.type === 'image/png');
	for (const purpose of ['any', 'maskable']) {
		const sizes = pngs.filter((icon) => icon.purpose === purpose).map((icon) => icon.sizes);
		for (const size of ['192x192', '512x512']) {
			check(sizes.includes(size), `no ${size} icon declared with purpose ${purpose}`);
		}
	}
	for (const icon of pngs) {
		check(icon.purpose !== undefined, 'a PNG icon declares no purpose', icon.src);
	}

	for (const icon of manifest.icons) {
		check(
			!icon.src.startsWith('/'),
			'icon src is absolute, so it breaks under a subpath',
			icon.src
		);
		resolvedIcons.push({ url: new URL(icon.src, manifestUrl).href, ...icon });
	}
}

for (const attribute of ['link[rel=apple-touch-icon]', 'link[rel=icon][type="image/svg+xml"]']) {
	const href = await page.getAttribute(attribute, 'href');
	check(href !== null, `no ${attribute} in the served HTML`);
	if (href !== null) {
		check(!href.startsWith('/'), `${attribute} href is absolute`, href);
		resolvedIcons.push({ url: new URL(href, page.url()).href, sizes: null, type: null });
	}
}

for (const icon of resolvedIcons) {
	const { status, type, bytes } = await fetchBytes(icon.url);
	const name = icon.url.slice(root.length);
	if (!check(status === 200, `${name} did not return 200`, String(status))) continue;
	if (icon.type !== null) {
		check(
			type.startsWith(icon.type),
			`${name} served as the wrong type`,
			`${type} vs ${icon.type}`
		);
	}
	if (icon.sizes !== null && icon.sizes !== 'any') {
		const measured = pngSize(bytes);
		const [width, height] = icon.sizes.split('x').map(Number);
		check(measured !== null, `${name} is not a PNG`);
		if (measured !== null) {
			check(
				measured.width === width && measured.height === height,
				`${name} is not the size it declares`,
				`${measured.width}x${measured.height} vs ${icon.sizes}`
			);
		}
	}
}

const icoUrl = new URL('favicon.ico', root).href;
const ico = await fetchBytes(icoUrl);
check(ico.status === 200, 'favicon.ico did not return 200', String(ico.status));
const entries = ico.status === 200 ? icoEntries(ico.bytes) : null;
check(entries !== null, 'favicon.ico is not a valid ICO directory');
const icoSizes = entries?.map((e) => e.declared) ?? [];
for (const size of [16, 32, 48]) {
	check(
		icoSizes.includes(size),
		`favicon.ico declares no ${size}x${size} entry`,
		icoSizes.join(', ')
	);
}
for (const entry of entries ?? []) {
	check(entry.payload !== null, `favicon.ico entry ${entry.declared} is not a PNG payload`);
	if (entry.payload !== null) {
		check(
			entry.payload.width === entry.declared && entry.payload.height === entry.declared,
			`favicon.ico entry ${entry.declared} holds the wrong raster`,
			`${entry.payload.width}x${entry.payload.height}`
		);
	}
}

await page.evaluate(async () => {
	if (navigator.serviceWorker === undefined) return;
	await navigator.serviceWorker.ready;
});
const controlled = await page.evaluate(
	() => navigator.serviceWorker !== undefined && navigator.serviceWorker.controller !== null
);
check(controlled, 'no service worker controls the page, so Chrome will not offer to install');

const appManifest = await cdp.send('Page.getAppManifest');
check(
	appManifest.errors.length === 0,
	'Chrome reported manifest errors',
	appManifest.errors.map((e) => e.message).join('; ')
);
check(appManifest.url === manifestUrl, 'Chrome read a different manifest', appManifest.url);

let installability = null;
try {
	const reported = await cdp.send('Page.getInstallabilityErrors');
	installability = reported.installabilityErrors.map((e) => e.errorId);
	check(
		installability.length === 0,
		'Chrome would not offer to install this',
		installability.join('; ')
	);
} catch (error) {
	check(
		false,
		'Page.getInstallabilityErrors is not available on this Chromium',
		error.message.split('\n')[0]
	);
}

/*
 * Headless Chromium does not raise beforeinstallprompt even when every criterion
 * is met, so it is reported and never asserted. getInstallabilityErrors is the
 * authority here.
 */
const promptFired = await page.evaluate(() => window.__installPromptFired === true);

check(consoleErrors.length === 0, 'console errors on load', consoleErrors.slice(0, 4).join(' | '));
check(
	failedRequests.length === 0,
	'failed requests on load',
	failedRequests.slice(0, 4).join(' | ')
);

mkdirSync(shots, { recursive: true });
const faviconSvg = await (await fetch(new URL('favicon.svg', root).href)).text();
const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(faviconSvg)}`;
const title = await page.title();

const tiny = await context.newPage();
await tiny.setViewportSize({ width: 16, height: 16 });
await tiny.setContent(
	`<style>html,body{margin:0}img{display:block}</style><img src="${dataUri}" width="16" height="16">`
);
await tiny.locator('img').screenshot({ path: `${shots}/pwa-favicon-16.png` });

const strip = await context.newPage();
await strip.setViewportSize({ width: 760, height: 210 });
await strip.setContent(`<style>html,body{margin:0;background:#efe4cf;font:13px system-ui}
  .row{display:flex;gap:30px;align-items:center;padding:22px}
  .col{display:flex;flex-direction:column;gap:8px;align-items:center}
  .zoom{image-rendering:pixelated;border:1px solid #8a8073}
  .tab{display:flex;align-items:center;gap:8px;background:#2b2b2b;color:#e8e8e8;
    padding:8px 15px;border-radius:9px 9px 0 0;font:12px system-ui}</style>
  <div class="row">
    <div class="col"><img src="${dataUri}" width="16" height="16"><span>16 px, actual size</span></div>
    <div class="col"><img class="zoom" src="${dataUri}" width="128" height="128"><span>the same 16 px, 8x</span></div>
    <div class="col"><img class="zoom" src="${icoUrl}" width="128" height="128"><span>favicon.ico, 8x</span></div>
    <div class="col"><div class="tab"><img src="${dataUri}" width="16" height="16"><span>${title}</span></div>
      <span>in a tab strip</span></div>
  </div>`);
await strip.screenshot({ path: `${shots}/pwa-favicon-16-zoomed.png` });

const anyUrl = new URL('icons/icon-512.png', root).href;
const maskUrl = new URL('icons/icon-maskable-512.png', root).href;
writeFileSync(`${shots}/pwa-icon-any-512.png`, (await fetchBytes(anyUrl)).bytes);
writeFileSync(`${shots}/pwa-icon-maskable-512.png`, (await fetchBytes(maskUrl)).bytes);

/*
 * The safe zone is a circle of 80% of the canvas. Anything outside it is what a
 * launcher is allowed to crop, so the overlay is the only way to see at a glance
 * that the crop takes painted sea and never takes the dive site.
 */
const safe = await context.newPage();
await safe.setViewportSize({ width: 1120, height: 620 });
await safe.setContent(`<style>html,body{margin:0;background:#efe4cf;font:13px system-ui}
  .row{display:flex;gap:26px;padding:22px}
  .col{display:flex;flex-direction:column;gap:8px;align-items:center}
  .plate{position:relative;width:320px;height:320px}
  .plate img{width:320px;height:320px;display:block}
  .plate svg{position:absolute;inset:0}
  .circle{clip-path:circle(50%)}
  .squircle{clip-path:inset(0 round 22%)}</style>
  <div class="row">
    <div class="col"><div class="plate"><img src="${maskUrl}">
      <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="#d4553f"
        stroke-width="1" stroke-dasharray="3 2"/>
        <rect x="0.5" y="0.5" width="99" height="99" rx="22" fill="none" stroke="#e0a32e"
        stroke-width="1" stroke-dasharray="3 2"/></svg></div>
      <span>maskable 512, safe circle and squircle</span></div>
    <div class="col"><div class="plate circle"><img src="${maskUrl}"></div>
      <span>cropped to a circle, as Android does</span></div>
    <div class="col"><div class="plate squircle"><img src="${maskUrl}"></div>
      <span>cropped to a squircle, as iOS does</span></div>
  </div>`);
await safe.screenshot({ path: `${shots}/pwa-maskable-safezone.png` });

await browser.close();

const written = [
	'pwa-favicon-16.png',
	'pwa-favicon-16-zoomed.png',
	'pwa-icon-any-512.png',
	'pwa-icon-maskable-512.png',
	'pwa-maskable-safezone.png'
].map((name) => `${shots}/${name}`);

console.log(
	JSON.stringify(
		{
			base,
			root,
			manifestUrl,
			manifestHref,
			startUrl,
			scope,
			iconsChecked: resolvedIcons.length,
			icoSizes,
			serviceWorkerControls: controlled,
			installabilityErrors: installability,
			beforeinstallprompt: promptFired,
			shots: written,
			failures
		},
		null,
		2
	)
);

if (failures.length > 0) {
	console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
	process.exit(1);
}
