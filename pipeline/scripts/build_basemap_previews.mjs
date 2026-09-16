#!/usr/bin/env node
/**
 * Extract one preview tile per base map into static/basemaps/.
 *
 * The picker draws a thumbnail beside every name. A thumbnail that was a live
 * tile would cost a request per row every time the panel opened, and would be
 * blank on a boat with no signal, which is the one place this map is for. So the
 * tiles are pulled once, here, and the files are committed.
 *
 * The catalogue is the input rather than a list repeated here: `basemaps.ts`
 * owns the services and the order they paint in, so the one base map that stacks
 * two flights is composited in that same order. Add a base map to the catalogue,
 * rerun this, and the picker has its preview. `basemap-preview.spec.ts` fails if
 * the two ever drift.
 *
 * One tile, 14/8338/6085, the Begur coast. Half land and half sea, so a
 * photograph, a road map and a topographic sheet are told apart at 64 px and the
 * 5 cm coastal flight has something in frame. It is the tile the owner's own
 * selector sampled.
 *
 * Deep water goes behind every photograph, because PNOA is flown over land and
 * answers a fully transparent PNG over the sea. Left unbacked, half of three
 * thumbnails would take the colour of whatever they were laid on. The backing is
 * the chart's own `void`, so what shows through is the colour the map paints
 * open water in.
 *
 *     node pipeline/scripts/build_basemap_previews.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { BASE_MAPS } from '../../src/lib/domain/basemaps.ts';
import { PALETTE } from '../../src/lib/map/palette.ts';

const flag = (name, fallback) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? fallback : process.argv[at + 1];
};

const out = flag('--out', 'static/basemaps');
/** Begur: the dive coast, and enough of both sides of the shore to tell maps apart. */
const zoom = Number(flag('--zoom', 14));
const tileX = Number(flag('--x', 8338));
const tileY = Number(flag('--y', 6085));
/**
 * The thumbnail is drawn near 64 CSS px, so 128 covers a 2x screen and stops
 * there. Downsampling from the server's own 256 is also what keeps a road map's
 * hairlines from breaking up.
 */
const size = Number(flag('--size', 128));
const quality = Number(flag('--quality', 0.82));

/** Web Mercator half-circumference, which is where the tile grid is pinned. */
const SHIFT = 20037508.342789244;

const bboxOf = (z, x, y) => {
	const span = (2 * SHIFT) / 2 ** z;
	const west = -SHIFT + x * span;
	const north = SHIFT - y * span;
	return [west, north - span, west + span, north].join(',');
};

/** A service asks either by tile index or by bounding box, and both are here. */
const urlOf = (template) =>
	template
		.replaceAll('{z}', String(zoom))
		.replaceAll('{x}', String(tileX))
		.replaceAll('{y}', String(tileY))
		.replaceAll('{bbox-epsg-3857}', bboxOf(zoom, tileX, tileY));

/**
 * OSM's tile policy asks for an identifying agent and blocks the ones it does
 * not know. Everything else here is happy either way.
 */
const AGENT = 'dive-map basemap preview build (+https://divemap.mauri.app)';

const fetchTile = async (service) => {
	const url = urlOf(service.tiles);
	const response = await fetch(url, { headers: { 'User-Agent': AGENT } });
	if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${service.id}`);
	const type = response.headers.get('content-type') ?? '';
	if (!type.startsWith('image/')) throw new Error(`${type || 'no content type'} for ${service.id}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	return {
		id: service.id,
		source: bytes.length,
		url: `data:${type};base64,${bytes.toString('base64')}`
	};
};

const sources = new Map();
for (const service of BASE_MAPS.flatMap((map) => map.services)) {
	if (!sources.has(service.id)) sources.set(service.id, await fetchTile(service));
}

const browser = await chromium.launch();
const page = await browser.newPage();

/**
 * Composited and encoded in the browser rather than in node, the way
 * `build_avatars.mjs` rasterises its drawings: node has no image codec, and this
 * is the one already in the toolchain.
 */
const encode = (layers) =>
	page.evaluate(
		async ({ layers, size, quality, backing }) => {
			const canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			const context = canvas.getContext('2d');
			context.imageSmoothingQuality = 'high';
			context.fillStyle = backing;
			context.fillRect(0, 0, size, size);
			for (const layer of layers) {
				const image = new Image();
				image.src = layer;
				await image.decode();
				context.drawImage(image, 0, 0, size, size);
			}
			return canvas.toDataURL('image/webp', quality);
		},
		{ layers, size, quality, backing: PALETTE.void }
	);

mkdirSync(out, { recursive: true });

const built = [];
for (const map of BASE_MAPS) {
	const layers = map.services.map((service) => sources.get(service.id).url);
	const encoded = await encode(layers);
	const file = `${out}/${map.id}.webp`;
	writeFileSync(file, Buffer.from(encoded.slice(encoded.indexOf(',') + 1), 'base64'));
	built.push({
		id: map.id,
		services: map.services.map((service) => service.id),
		bytes: statSync(file).size
	});
}

await browser.close();

// The TypeScript side names one file per base map, and basemap-preview.spec.ts
// asserts it against this list, so a base map added to the catalogue without a
// preview fails a test rather than drawing a broken image on a boat.
writeFileSync(
	`${out}/index.json`,
	`${JSON.stringify({ zoom, tile: [tileX, tileY], size, ids: built.map((b) => b.id) }, null, '\t')}\n`
);

console.log(
	JSON.stringify(
		{
			out,
			at: `${zoom}/${tileX}/${tileY}`,
			size,
			total: built.reduce((sum, b) => sum + b.bytes, 0),
			previews: built
		},
		null,
		2
	)
);
