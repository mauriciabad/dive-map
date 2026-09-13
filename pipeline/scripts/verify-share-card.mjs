#!/usr/bin/env node
/**
 * Prove that a shared link comes back as a card, against a site that is running.
 *
 * Every claim here is one a crawler makes and a person never sees until the link
 * is already in somebody's chat. So nothing is read off the source tree: the page
 * is fetched the way a scraper fetches it, with no JavaScript, and the image is
 * fetched from the absolute URL the tag gives rather than from disk. The pixel
 * size is read out of the file's own SOF header, because a tag saying 1200x630
 * over a file that is not gets the picture cropped by the platform.
 *
 * The last check needs a browser. The app sets its own title once it runs, and
 * two title elements in one document leave the tab showing whichever came first,
 * which is a regression nothing else would catch.
 *
 *     node pipeline/scripts/verify-share-card.mjs https://divemap.mauri.app/
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/';

const failures = [];
const notes = {};
const check = (name, passed, detail) => {
	notes[name] = detail === undefined ? passed : { passed, ...detail };
	if (!passed) failures.push(name);
};

const page = await fetch(url, { headers: { 'user-agent': 'facebookexternalhit/1.1' } });
const html = await page.text();
check('page fetches', page.ok, { status: page.status });

const meta = (attribute, name) => {
	const tag = new RegExp(
		`<meta[^>]*${attribute}=["']${name}["'][^>]*>|<meta[^>]*content=["']([^"']*)["'][^>]*${attribute}=["']${name}["']`,
		'i'
	).exec(html);
	if (tag === null) return undefined;
	return /content=["']([^"']*)["']/i.exec(tag[0])?.[1];
};

const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1];
check('title', typeof title === 'string' && title.length > 0, { title });
check('description', (meta('name', 'description') ?? '').length > 20);
check('og:title', (meta('property', 'og:title') ?? '').length > 0);
check('og:description', (meta('property', 'og:description') ?? '').length > 20);
check('og:type', meta('property', 'og:type') === 'website');
check('twitter:card', meta('name', 'twitter:card') === 'summary_large_image');

const claimed = {
	image: meta('property', 'og:image'),
	width: Number(meta('property', 'og:image:width')),
	height: Number(meta('property', 'og:image:height')),
	alt: meta('property', 'og:image:alt'),
	canonical: /<link[^>]*rel=["']canonical["'][^>]*>/i.exec(html)?.[0]
};
check('og:image is absolute', (claimed.image ?? '').startsWith('https://'), {
	image: claimed.image
});
check('og:image:alt', (claimed.alt ?? '').length > 20);
check('canonical is absolute', (claimed.canonical ?? '').includes('https://'));
for (const [name, value] of Object.entries({
	'og:url': meta('property', 'og:url'),
	'twitter:image': meta('name', 'twitter:image')
})) {
	check(`${name} is absolute`, (value ?? '').startsWith('https://'), { value });
}

/** Width and height as the decoder reads them, from the first frame header. */
const framedAt = (bytes) => {
	for (let i = 2; i + 9 < bytes.length;) {
		if (bytes[i] !== 0xff) {
			i += 1;
			continue;
		}
		const marker = bytes[i + 1];
		const length = (bytes[i + 2] << 8) + bytes[i + 3];
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return {
				height: (bytes[i + 5] << 8) + bytes[i + 6],
				width: (bytes[i + 7] << 8) + bytes[i + 8]
			};
		}
		i += 2 + length;
	}
	return undefined;
};

if (claimed.image !== undefined) {
	const response = await fetch(claimed.image);
	const bytes = new Uint8Array(await response.arrayBuffer());
	const framed = framedAt(bytes);
	check('image is served', response.ok, {
		status: response.status,
		type: response.headers.get('content-type')
	});
	check('image is a jpeg', (response.headers.get('content-type') ?? '').includes('jpeg'));
	check(
		'image is the size the tags claim',
		framed?.width === claimed.width && framed?.height === claimed.height,
		{
			measured: framed,
			claimed: { width: claimed.width, height: claimed.height }
		}
	);
	// A preview card is 1.91:1 everywhere it matters. Anything else gets cropped
	// by the platform, and the platform crops where it likes.
	check('image is 1200x630', framed?.width === 1200 && framed?.height === 630, framed);
	// WhatsApp drops a preview it cannot fetch quickly on a phone connection.
	check('image is under 300 kB', response.ok && bytes.length < 300_000, { bytes: bytes.length });
}

const browser = await chromium.launch();
const tab = await browser.newPage();
await tab.goto(url, { waitUntil: 'domcontentloaded' });
// The map canvas is the first thing that only exists once the app has mounted,
// and the app is what could leave a second title element behind it.
await tab.waitForSelector('.maplibregl-canvas', { timeout: 60_000 });
const live = await tab.evaluate(() => ({
	titles: [...document.querySelectorAll('title')].map((t) => t.textContent),
	shown: document.title,
	lang: document.documentElement.lang,
	descriptions: [...document.querySelectorAll('meta[name="description"]')].length
}));
await browser.close();
check('one title in the live page', live.titles.length === 1, live);
check('one description in the live page', live.descriptions === 1, live);

console.log(JSON.stringify({ url, failures, notes, live }, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
