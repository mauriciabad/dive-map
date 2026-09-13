#!/usr/bin/env node
/**
 * Prove that choosing a texture for a seabed class reaches the pixels, and
 * measure what choosing costs.
 *
 * Everything about this feature type-checks and tests green while painting
 * nothing at all. `fill-pattern` naming an image the map never registered is not
 * an error in MapLibre: the fill simply does not draw, and a hole in the seabed
 * looks like deep water. So every case here reads the canvas back, and the
 * fallback case asserts the painted frame is the same picture it is with no
 * choice at all, rather than merely "still something".
 *
 * Three traps this is written around, each of which has cost time before:
 *   - `waitForSelector` with `detached` is satisfied by an element that was
 *     never rendered, so it passes on an empty page a millisecond after
 *     navigation. Nothing here waits on an absence.
 *   - `window.diveMap` exists only under import.meta.env.DEV, so a production
 *     preview looks exactly like a map that never loaded. That is said out loud
 *     rather than left to time out.
 *   - A console listener alone cannot see an uncaught exception. `pageerror` is
 *     listened for too.
 *
 * Usage: node pipeline/scripts/verify-textures.mjs <url> [--shot dir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5211/';
const shotAt = process.argv.indexOf('--shot');
const shotDir = shotAt === -1 ? undefined : process.argv[shotAt + 1];
if (shotDir !== undefined) mkdirSync(shotDir, { recursive: true });

/**
 * Illes Medes at diving zoom. Well inside the survey, so the camera guard leaves
 * it where it is put, and over a stretch that paints several habitat classes at
 * once, which is what makes "one class changed" mean more than "the frame
 * changed".
 */
const MEDES = { centre: [3.2235, 42.047], zoom: 15 };

/**
 * Illa Roja off Begur, the camera the export check uses. Open seabed rather than
 * an island: the middle 300 pixels of an A3 sheet at 1:2000 is 76 m of ground,
 * and over the Medes the middle 76 m is the island itself, which paints flat and
 * makes a perfectly good sheet look blank.
 */
const BEGUR = { centre: [3.2136, 41.9087], zoom: 15.2 };

const WORKING_KEY = 'dive-map:working';
const LIBRARY_KEY = 'dive-map:configurations';
const RECENT_KEY = 'dive-map:recent';

/** Near black. Nothing in the habitat catalogue paints open seabed with it. */
const DARK_TEXTURE = 'ch_dungeonvoid';

const failures = [];
const notes = {};

const check = (name, passed, detail) => {
	if (!passed) failures.push(detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`);
	notes[name] = detail === undefined ? passed : { passed, ...detail };
};

const watch = (page, tag) => {
	const problems = [];
	page.on('console', (m) => {
		if (m.type() === 'error') problems.push(`${tag} console: ${m.text().slice(0, 200)}`);
	});
	page.on('pageerror', (e) =>
		problems.push(`${tag} pageerror: ${(e.stack ?? e.message).slice(0, 400)}`)
	);
	return problems;
};

/**
 * Every WebGL texture upload and its bytes, hooked before the app runs.
 *
 * This is the honest measure of what the textures cost the driver. The image
 * registry alone would miss what MapLibre actually hands to WebGL, and the two
 * are different numbers.
 */
const countUploads = (context) =>
	context.addInitScript(() => {
		window.__gl = { uploads: 0, bytes: 0, bySize: {} };
		const record = (width, height) => {
			if (typeof width !== 'number' || typeof height !== 'number') return;
			if (width < 2 || height < 2) return;
			window.__gl.uploads += 1;
			window.__gl.bytes += width * height * 4;
			const key = `${width}x${height}`;
			window.__gl.bySize[key] = (window.__gl.bySize[key] ?? 0) + 1;
		};
		for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
			const proto = window[name]?.prototype;
			if (proto === undefined) continue;
			const image = proto.texImage2D;
			proto.texImage2D = function (...args) {
				// Two overloads. The long one carries width and height at 3 and 4; the
				// short one ends in a source that carries its own.
				if (args.length >= 6 && typeof args[3] === 'number') record(args[3], args[4]);
				else {
					const source = args[args.length - 1];
					record(source?.width, source?.height);
				}
				return image.apply(this, args);
			};
			// WebGL2 allocates here and then writes with texSubImage2D, so counting
			// texImage2D alone reported under a megabyte for 22 textures.
			const storage = proto.texStorage2D;
			if (storage === undefined) continue;
			proto.texStorage2D = function (...args) {
				record(args[3], args[4]);
				return storage.apply(this, args);
			};
		}
	});

/** A patch that fits the drawing buffer, so a phone reads real pixels rather than zeros. */
const patchIn = (page, want) =>
	page.evaluate((size) => {
		const canvas = window.diveMap.getCanvas();
		return Math.min(size, canvas.width - 2, canvas.height - 2);
	}, want);

/**
 * Loaded means the handle is published, the shell has taken the sounding line
 * away, MapLibre has nothing left in flight, and the seabed reads the same twice
 * running out of the drawing buffer. The last one is what separates a painted
 * seabed from a flat blue rectangle.
 */
const settle = async (page, where = MEDES, floor = 8) => {
	await page
		.waitForFunction(() => window.diveMap !== undefined, null, { timeout: 90_000 })
		.catch(() => {
			throw new Error(
				`No map handle at ${url}. This needs a dev server: a production build does not expose window.diveMap.`
			);
		});
	await page.evaluate((where) => {
		window.__missingImages = [];
		window.diveMap.on('styleimagemissing', (e) => {
			window.__missingImages.push(e.id);
		});
		window.diveMap.jumpTo({ center: where.centre, zoom: where.zoom });
	}, where);
	// The handle is re-checked inside every poll rather than once before them. A
	// `vite dev` rebuilding under the browser reloads the page mid-run and takes
	// `window.diveMap` with it, and a poll that had captured it throws instead of
	// waiting for the map that is on its way back.
	await page.waitForFunction(
		() =>
			window.diveMap !== undefined &&
			document.querySelector('.booting') === null &&
			window.diveMap.loaded(),
		null,
		{ timeout: 90_000 }
	);
	const size = await patchIn(page, 240);
	await page.waitForFunction(
		([want, patch]) => {
			if (window.diveMap === undefined) return false;
			const canvas = window.diveMap.getCanvas();
			const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
			const pixels = new Uint8Array(patch * patch * 4);
			gl.readPixels(
				Math.floor((canvas.width - patch) / 2),
				Math.floor((canvas.height - patch) / 2),
				patch,
				patch,
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
			const spread = Math.sqrt(squares / n - (sum / n) ** 2);
			const before = window.__spread;
			window.__spread = spread;
			return before !== undefined && Math.abs(before - spread) < 0.05 && spread > want;
		},
		[floor, size],
		{ timeout: 90_000, polling: 700 }
	);
};

/**
 * What the map is painting, as a coarse signature of the canvas.
 *
 * A grid of block means rather than one number, so a class covering one corner
 * of the frame moves the signature even when it barely moves the average. The
 * spread comes back with it, because a frame that stopped painting and a frame
 * that changed texture both move the mean and only one of them flattens.
 */
const signature = async (page) => {
	const patch = await patchIn(page, 512);
	return page.evaluate((size) => {
		const canvas = window.diveMap.getCanvas();
		const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
		const pixels = new Uint8Array(size * size * 4);
		gl.readPixels(
			Math.floor((canvas.width - size) / 2),
			Math.floor((canvas.height - size) / 2),
			size,
			size,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			pixels
		);
		const cells = 8;
		const step = Math.floor(size / cells);
		const blocks = [];
		let sum = 0;
		let squares = 0;
		let count = 0;
		for (let by = 0; by < cells; by += 1) {
			for (let bx = 0; bx < cells; bx += 1) {
				let block = 0;
				let inBlock = 0;
				for (let y = by * step; y < (by + 1) * step; y += 2) {
					for (let x = bx * step; x < (bx + 1) * step; x += 2) {
						const i = (y * size + x) * 4;
						const l = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
						block += l;
						inBlock += 1;
						sum += l;
						squares += l * l;
						count += 1;
					}
				}
				blocks.push(Math.round((block / inBlock) * 100) / 100);
			}
		}
		return {
			blocks,
			mean: Math.round((sum / count) * 100) / 100,
			spread: Math.round(Math.sqrt(squares / count - (sum / count) ** 2) * 100) / 100
		};
	}, patch);
};

/**
 * How far apart two frames are, per block of the 8x8 grid.
 *
 * The worst block decides, not the average. A class that covers one headland
 * moves its own blocks by tens of levels and the frame average by one, so an
 * average would put "this class repainted" and "this frame is identical" within
 * half a level of each other and prove neither.
 */
const apart = (a, b) => {
	const deltas = a.blocks.map((value, index) => Math.abs(value - b.blocks[index]));
	const round = (value) => Math.round(value * 100) / 100;
	return {
		worst: round(Math.max(...deltas)),
		mean: round(deltas.reduce((sum, value) => sum + value, 0) / deltas.length)
	};
};

/** What the live style says each class is painted with, read back off the map. */
const patternLookup = (page) =>
	page.evaluate(() => {
		const found = {};
		for (const id of ['ground-habitats-fill', 'ground-substrate-fill']) {
			let expression;
			try {
				expression = window.diveMap.getPaintProperty(id, 'fill-pattern');
			} catch {
				continue;
			}
			// ['coalesce', ['get', ['get', 'code'], ['literal', lookup]], fallback]
			const literal = expression?.[1]?.[2];
			if (Array.isArray(literal) && literal[0] === 'literal') found[id] = literal[1];
		}
		return found;
	});

const painted = async (page, layer = 'ground-habitats-fill') =>
	Object.values((await patternLookup(page))[layer] ?? {});

/** The codes whose texture differs between two readings of the style, and what they became. */
const repainted = (before, after, layer = 'ground-habitats-fill') => {
	const was = before[layer] ?? {};
	const now = after[layer] ?? {};
	return Object.entries(now)
		.filter(([code, texture]) => was[code] !== texture)
		.map(([code, texture]) => `${code}=${texture}`);
};

/**
 * Whether every texture the style names is in the image registry.
 *
 * This is the invariant that stops a hole appearing in the seabed: a
 * `fill-pattern` naming an image the map never registered is not an error in
 * MapLibre, it simply does not draw. Asked of the settled map rather than
 * listened for, because `styleimagemissing` also fires in the window before the
 * textures finish decoding, when everything is missing and nothing is wrong.
 */
const unregistered = async (page) => {
	const lookups = await patternLookup(page);
	const named = new Set(Object.values(lookups).flatMap((lookup) => Object.values(lookup)));
	return page.evaluate(
		(names) => names.filter((name) => !window.diveMap.hasImage(name)),
		[...named, 'ch_sand', 'unsurveyed']
	);
};

const openLegend = async (page) => {
	await page.getByRole('button', { name: 'Legend' }).first().click();
	await page.waitForSelector('#dive-settings-panel button.name[data-seabed]', { timeout: 20_000 });
};

/** Every class the legend lists, in its own order, keyed the way a choice is keyed. */
const legendClasses = (page) =>
	page.evaluate(() =>
		[...document.querySelectorAll('#dive-settings-panel button.name[data-seabed]')].map((b) => ({
			key: b.dataset.seabed,
			inFrame: b.dataset.dim === 'false',
			name: b.querySelector('.text')?.textContent?.trim() ?? ''
		}))
	);

/** Every texture the picker offers, read off the bands it is showing. */
const paletteOffered = (page) =>
	page.evaluate(() =>
		[...document.querySelectorAll('#dive-settings-panel .tile img.probe')]
			.map((img) => (img.getAttribute('src') ?? '').replace(/.*\//, '').replace(/\..*$/, ''))
			.filter((id) => id.length > 0)
	);

/** Choose a texture for one class through the real controls, the way a diver does. */
const pickTexture = async (page, key, texture) => {
	await page.locator(`#dive-settings-panel button.name[data-seabed="${key}"]`).first().click();
	await page.waitForSelector('#dive-settings-panel .tile', { timeout: 20_000 });
	await page.evaluate((wanted) => {
		const tiles = [...document.querySelectorAll('#dive-settings-panel .tile')];
		const tile = tiles.find((t) =>
			t.querySelector('img.probe')?.getAttribute('src')?.includes(`/${wanted}.`)
		);
		if (tile === undefined) throw new Error(`no tile for ${wanted}`);
		tile.click();
	}, texture);
	await page.waitForTimeout(700);
};

const backToLegend = async (page) => {
	await page.locator('#dive-settings-panel .back').click();
	await page.waitForSelector('#dive-settings-panel button.name[data-seabed]', { timeout: 20_000 });
};

/** What the map wrote for itself with nobody touching anything, read back off the tab. */
const shippedConfiguration = (page) =>
	page.evaluate((key) => {
		const blob = JSON.parse(sessionStorage.getItem(key) ?? 'null');
		if (blob === null) throw new Error('the tab never wrote a working configuration');
		return blob.configuration;
	}, WORKING_KEY);

/**
 * Open the next page on exactly the configuration the map ships with, with only
 * the choices changed.
 *
 * Typed out by hand this was a list of layer ids that had quietly drifted from
 * `DEFAULT_LAYERS`, so the seeded page drew no markers and every frame it
 * produced was 14 levels away from the baseline it was supposed to match. Copied
 * from the running map, the only difference between two frames is the one the
 * case is about.
 */
const seed = (page, shipped, textures) =>
	page.evaluate(
		([working, recent, base, chosen]) => {
			sessionStorage.setItem(
				working,
				JSON.stringify({ version: 1, configuration: { ...base, textures: chosen } })
			);
			localStorage.setItem(recent, JSON.stringify({ version: 1, introSeen: true }));
		},
		[WORKING_KEY, RECENT_KEY, shipped, textures]
	);

const clearStorage = (page) =>
	page.evaluate(
		([working, library, recent]) => {
			sessionStorage.removeItem(working);
			localStorage.removeItem(library);
			localStorage.setItem(recent, JSON.stringify({ version: 1, introSeen: true }));
		},
		[WORKING_KEY, LIBRARY_KEY, RECENT_KEY]
	);

/** Bytes the driver was handed, and what the image registry holds to do it. */
const cost = (page) =>
	page.evaluate(() => {
		const style = window.diveMap.style;
		const images = style.imageManager?.images;
		const list = images instanceof Map ? [...images.entries()] : Object.entries(images ?? {});
		let registryBytes = 0;
		const bySize = {};
		for (const [, entry] of list) {
			const width = entry?.data?.width;
			const height = entry?.data?.height;
			if (typeof width !== 'number' || typeof height !== 'number') continue;
			registryBytes += width * height * 4;
			const key = `${width}x${height}`;
			bySize[key] = (bySize[key] ?? 0) + 1;
		}
		const atlas = style.patternAtlas;
		const entries = atlas?._entries;
		return {
			registryImages: list.length,
			registryMB: Math.round((registryBytes / 1048576) * 10) / 10,
			bySize,
			atlasEntries: entries instanceof Map ? entries.size : Object.keys(entries ?? {}).length,
			atlasPixels: (atlas?._image?.width ?? 0) * (atlas?._image?.height ?? 0),
			uploads: window.__gl?.uploads ?? null,
			uploadedMB: Math.round(((window.__gl?.bytes ?? 0) / 1048576) * 10) / 10,
			uploadsBySize: window.__gl?.bySize ?? null
		};
	});

/**
 * Waits for the export to start and then to stop, by watching the button's own
 * busy state. A refused export never produces a file, so waiting on a download
 * alone waits for something that is never coming.
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
		else if (started) return true;
	}
	return false;
};

const shoot = async (page, name) => {
	if (shotDir === undefined) return;
	await page.screenshot({ path: `${shotDir}/textures-${name}.png` });
};

const browser = await chromium.launch();
const problems = [];

try {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	await countUploads(context);

	// A clean browser first, so every later frame has one nobody chose to be
	// measured against.
	const base = await context.newPage();
	problems.push(...watch(base, 'baseline'));
	await base.goto(url, { waitUntil: 'domcontentloaded' });
	await clearStorage(base);
	await base.reload({ waitUntil: 'domcontentloaded' });
	await settle(base);
	const plain = await signature(base);
	const shipped = await shippedConfiguration(base);
	const plainLookup = await patternLookup(base);
	const plainCost = await cost(base);
	check('the seabed paints before anything is chosen', plain.spread > 8, {
		spread: plain.spread,
		mean: plain.mean
	});
	check(
		'the image registry is readable, so the cost below is a measurement',
		plainCost.registryImages > 0 && plainCost.registryMB > 0 && plainCost.uploads > 0,
		plainCost
	);

	await openLegend(base);
	const classes = await legendClasses(base);
	const inFrame = classes.filter((c) => c.inFrame);
	check('the legend offers every class of the catalogue as a control', classes.length >= 33, {
		listed: classes.length,
		inFrame: inFrame.length
	});
	const target = inFrame[0];
	if (target === undefined) throw new Error('no class in frame at Medes, so nothing can be proved');

	await base.locator(`#dive-settings-panel button.name[data-seabed="${target.key}"]`).click();
	await base.waitForSelector('#dive-settings-panel .tile', { timeout: 20_000 });
	const palette = await paletteOffered(base);
	check(
		'the picker offers every built texture and not the hatch',
		palette.length === 21 && !palette.includes('unsurveyed'),
		{
			offered: palette.length
		}
	);
	await backToLegend(base);

	await pickTexture(base, target.key, DARK_TEXTURE);
	const chosen = await signature(base);
	const moved = repainted(plainLookup, await patternLookup(base));
	// Exactly one code, not merely "the texture appears somewhere": ch_dungeonvoid
	// is already the catalogue's texture for the two cave classes, so a check that
	// only looked for the name would pass with nothing having happened.
	check(
		'the style repaints the chosen class, and only that class',
		moved.length === 1 && moved[0].endsWith(`=${DARK_TEXTURE}`),
		{ chose: target.name, repainted: moved }
	);
	check('what is painted actually changes', apart(plain, chosen).worst > 8, {
		apart: apart(plain, chosen),
		meanBefore: plain.mean,
		meanAfter: chosen.mean
	});
	check('the seabed is still painted, not a hole', chosen.spread > 8, { spread: chosen.spread });
	await shoot(base, 'desktop-chosen');

	// A layer toggle rebuilds the whole style through setStyle. A marker kind is
	// the toggle because it draws nothing over the seabed, so the frame can be
	// compared with itself across the rebuild.
	await backToLegend(base);
	await base.getByRole('button', { name: 'Ladder' }).first().click();
	await base.waitForTimeout(1800);
	const rebuilt = await signature(base);
	const afterRebuild = repainted(plainLookup, await patternLookup(base));
	check('a style rebuild keeps the choice', afterRebuild.join() === moved.join(), {
		repainted: afterRebuild,
		apart: apart(chosen, rebuilt)
	});
	check('the rebuilt frame is the same picture', apart(chosen, rebuilt).worst < 2, {
		apart: apart(chosen, rebuilt)
	});

	await base.reload({ waitUntil: 'domcontentloaded' });
	await settle(base);
	const reloaded = await signature(base);
	const afterReload = repainted(plainLookup, await patternLookup(base));
	check(
		'the choice comes back through the saved configuration',
		afterReload.join() === moved.join(),
		{
			repainted: afterReload,
			apart: apart(chosen, reloaded)
		}
	);
	check('the reloaded frame is the same picture', apart(chosen, reloaded).worst < 2, {
		apart: apart(chosen, reloaded)
	});
	await base.close();

	// A choice naming a texture that was never built. The parse boundary drops it,
	// so the class keeps the catalogue's own and the frame is the one nobody chose.
	const broken = await context.newPage();
	problems.push(...watch(broken, 'missing-texture'));
	await broken.goto(url, { waitUntil: 'domcontentloaded' });
	await seed(broken, shipped, { [target.key]: 'ch_unicorn', 'habitats-12': 'ch_not_built' });
	await broken.reload({ waitUntil: 'domcontentloaded' });
	await settle(broken);
	const fallen = await signature(broken);
	const fallenNames = await painted(broken);
	const orphans = await unregistered(broken);
	const kept = await broken.evaluate((key) => localStorage.getItem(key), LIBRARY_KEY);
	check(
		'a texture that is not built never reaches the style',
		!fallenNames.includes('ch_unicorn') && !fallenNames.includes('ch_not_built'),
		{ named: fallenNames.filter((n) => n === 'ch_unicorn' || n === 'ch_not_built') }
	);
	check('every texture the style names is one the map registered', orphans.length === 0, {
		orphans
	});
	check(
		'the class falls back to its built-in texture rather than painting nothing',
		apart(plain, fallen).worst < 2 && fallen.spread > 8,
		{ apart: apart(plain, fallen), spread: fallen.spread }
	);
	check('nothing was written over the saved configurations', kept === null, { kept });
	await shoot(broken, 'desktop-fallback');
	await broken.close();

	// The cost: every class in frame on a texture of its own, which is the worst
	// case a diver can make, against the same frame with no choice at all.
	const many = await context.newPage();
	problems.push(...watch(many, 'cost'));
	await many.goto(url, { waitUntil: 'domcontentloaded' });
	const spread = {};
	for (const [index, entry] of inFrame.entries()) {
		spread[entry.key] = palette[index % palette.length];
	}
	await seed(many, shipped, spread);
	await many.reload({ waitUntil: 'domcontentloaded' });
	await settle(many);
	const manyCost = await cost(many);
	const manySignature = await signature(many);
	const distinct = new Set(await painted(many)).size;
	check(
		'every class in frame can be given a texture of its own',
		distinct >= Math.min(inFrame.length, palette.length) - 1,
		{
			classesInFrame: inFrame.length,
			distinctTexturesInStyle: distinct
		}
	);
	check(
		'the seabed still paints with the most textures a diver can ask for',
		manySignature.spread > 8 && (await unregistered(many)).length === 0,
		{ spread: manySignature.spread }
	);
	check(
		'choosing costs no more memory than the map already spends',
		manyCost.registryMB <= plainCost.registryMB + 0.1 &&
			manyCost.atlasEntries === plainCost.atlasEntries,
		{ noChoice: plainCost, everyClassDifferent: manyCost }
	);
	notes.cost = {
		noChoice: plainCost,
		everyClassDifferent: manyCost,
		classesInFrame: inFrame.length
	};
	await shoot(many, 'desktop-every-class');
	await many.close();

	// The print path. It builds a second map from the same StyleOptions and swaps
	// the 2048 set in under the same ids, so a choice that reached the screen can
	// still miss the sheet. The sheet is the artefact this whole project is for.
	//
	// Two sheets from the same camera, one with no choice and one with every class
	// the legend lists painted near black. Comparing them is the only way to tell
	// from outside that the choice reached the print map: the sheet's own style is
	// built inside the export and never published anywhere a check can read it.
	const exportSheet = async (textures, tag) => {
		const page = await context.newPage();
		problems.push(...watch(page, `print-${tag}`));
		await page.goto(url, { waitUntil: 'domcontentloaded' });
		await seed(page, shipped, textures);
		await page.reload({ waitUntil: 'domcontentloaded' });
		await settle(page, BEGUR);
		await page
			.getByRole('button', { name: /^Print$/ })
			.first()
			.click();
		await page.waitForTimeout(600);
		const saved = page.waitForEvent('download', { timeout: 260_000 }).catch(() => undefined);
		// The PDF rather than the PNG: it is the sheet this project exists to print,
		// and it needs no format switch to reach.
		await page
			.getByRole('button', { name: /^Export PDF$/ })
			.first()
			.click();
		const ran = await exportFinished(page);
		const file = await saved;
		const render = await page.evaluate(() => window.lastRender ?? null);
		const spent = await cost(page);
		await page.close();
		return { ran, named: file?.suggestedFilename() ?? null, render, spent };
	};

	const plainSheet = await exportSheet({}, 'plain');
	const everyClass = Object.fromEntries(classes.map((entry) => [entry.key, DARK_TEXTURE]));
	const darkSheet = await exportSheet(everyClass, 'dark');

	check(
		'the sheet exports at all',
		plainSheet.ran && plainSheet.named !== null && darkSheet.ran && darkSheet.named !== null,
		{ plain: plainSheet.named, dark: darkSheet.named }
	);
	check(
		'the print map asks for no pattern it does not have, at 2048 as at 512',
		(plainSheet.render?.missingImages.length ?? 1) === 0 &&
			(darkSheet.render?.missingImages.length ?? 1) === 0,
		{
			plain: plainSheet.render?.missingImages ?? null,
			dark: darkSheet.render?.missingImages ?? null
		}
	);
	check('the sheet is painted rather than blank', (plainSheet.render?.pixelSpread ?? 0) > 10, {
		pixelSpread: plainSheet.render?.pixelSpread ?? null,
		codes: plainSheet.render?.habitatCodes.length ?? null,
		problems: plainSheet.render?.problems ?? null
	});
	check(
		'the choice comes out on the A3 sheet',
		(plainSheet.render?.pixelMean ?? 0) - (darkSheet.render?.pixelMean ?? 0) > 10,
		{
			plainMean: plainSheet.render?.pixelMean ?? null,
			darkMean: darkSheet.render?.pixelMean ?? null,
			plainSpread: plainSheet.render?.pixelSpread ?? null,
			darkSpread: darkSheet.render?.pixelSpread ?? null
		}
	);
	notes.printCost = {
		uploadsBySize: darkSheet.spent.uploadsBySize,
		sheetPixels:
			darkSheet.render === null ? null : `${darkSheet.render.width}x${darkSheet.render.height}`
	};

	// Phone, so the panel is the sheet across the bottom rather than the column.
	const phone = await context.newPage();
	problems.push(...watch(phone, 'phone'));
	await phone.setViewportSize({ width: 390, height: 844 });
	await phone.goto(url, { waitUntil: 'domcontentloaded' });
	await seed(phone, shipped, { [target.key]: DARK_TEXTURE });
	await phone.reload({ waitUntil: 'domcontentloaded' });
	await settle(phone);
	check(
		'the phone comes back to the same choice',
		repainted(plainLookup, await patternLookup(phone)).join() === moved.join(),
		{ repainted: repainted(plainLookup, await patternLookup(phone)) }
	);
	await openLegend(phone);
	await phone.locator(`#dive-settings-panel button.name[data-seabed="${target.key}"]`).click();
	await phone.waitForSelector('#dive-settings-panel .tile', { timeout: 20_000 });
	const reach = await phone.evaluate(() => {
		const tiles = [...document.querySelectorAll('#dive-settings-panel .tile')];
		const boxes = tiles.map((t) => t.getBoundingClientRect());
		return {
			tiles: tiles.length,
			narrowest: Math.round(Math.min(...boxes.map((b) => b.width))),
			shortest: Math.round(Math.min(...boxes.map((b) => b.height))),
			overflows: boxes.some((b) => b.right > window.innerWidth + 1)
		};
	});
	check(
		'every texture is reachable with a thumb on a phone',
		reach.tiles === 21 && reach.narrowest >= 44 && reach.shortest >= 44 && !reach.overflows,
		reach
	);
	await shoot(phone, 'phone-picker');
	await phone.close();
} finally {
	await browser.close();
}

failures.push(...problems);

console.log(JSON.stringify(notes, null, 2));
if (failures.length > 0) {
	console.error(`\n${failures.length} failed:`);
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}
console.log(`\nall ${Object.keys(notes).length} checks passed`);
