#!/usr/bin/env node
/**
 * Rasterise the position avatars into static/avatars/.
 *
 * Two dark layers carry every figure: a rotation-invariant dark halo and a thick
 * ink outline, under pale paper fills. The halo is what makes a pale figure read
 * on pale shallows, the pale fill is what makes it read on the dark sea, and the
 * halo is symmetric rather than a cast shadow because MapLibre rotates the whole
 * sprite and a directional shadow would spin with the boat.
 *
 * Every figure points bow-up, so `icon-rotate` takes a course in degrees
 * clockwise from north with no offset.
 *
 * Usage: node pipeline/scripts/build_avatars.mjs [--out static/avatars] [--size 256]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INK = '#1d1710';
const PAPER = '#efe4cf';
const PAPER_DIM = '#bfb19a';
const BRASS = '#b8893f';
const BRASS_LIT = '#e0bd85';
const WOOD = '#8a5a32';
const SEA = '#2b9fe4';
const HAZARD = '#d4553f';
const OLIVE = '#7d8a3c';

const ink = (w) =>
	`stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

/** A pale flick of broken water off the bow, which also says which end is the front. */
const wake = (d) => `<path d="${d}" fill="none" stroke="${PAPER}" stroke-width="4.5"
	stroke-linecap="round" stroke-opacity="0.75"/>`;

const AVATARS = [
	{
		id: 'pirate-boat',
		body: `
			<path d="M64 10 C80 32 88 62 86 88 C85 105 76 116 64 116 C52 116 43 105 42 88 C40 62 48 32 64 10Z"
				fill="${WOOD}" ${ink(6)}/>
			<path d="M64 24 C76 42 81 64 80 86 C79 98 73 106 64 106 C55 106 49 98 48 86 C47 64 52 42 64 24Z"
				fill="${PAPER_DIM}" ${ink(3)}/>
			<path d="M50 62h28M51 76h26M53 90h22" stroke="${WOOD}" stroke-width="3" stroke-opacity="0.55"/>
			<path d="M64 46 C90 58 94 84 78 100 L64 92Z" fill="${INK}" stroke="${PAPER}" stroke-width="3.5"
				stroke-linejoin="round"/>
			<circle cx="64" cy="46" r="6" fill="${BRASS_LIT}" ${ink(4)}/>
			<path d="M64 40 L64 18 L78 24 L64 30" fill="${HAZARD}" ${ink(3.5)}/>
			${wake('M46 22 C52 14 58 10 64 8 C70 10 76 14 82 22')}`
	},
	{
		id: 'llagut',
		body: `
			<path d="M64 8 C78 34 84 66 80 92 C77 110 71 120 64 120 C57 120 51 110 48 92 C44 66 50 34 64 8Z"
				fill="${PAPER}" ${ink(6)}/>
			<path d="M55 34 C50 58 49 86 53 106M73 34 C78 58 79 86 75 106" stroke="${SEA}" stroke-width="4.5"
				stroke-linecap="round"/>
			<path d="M64 30 C60 54 60 82 64 104" stroke="${WOOD}" stroke-width="4" stroke-opacity="0.5"/>
			<path d="M62 22 L96 74 L66 66Z" fill="${PAPER}" ${ink(5)}/>
			<path d="M62 22 L96 74" stroke="${WOOD}" stroke-width="4" stroke-linecap="round"/>
			<circle cx="62" cy="62" r="5.5" fill="${BRASS}" ${ink(3.5)}/>
			${wake('M48 20 C54 12 59 8 64 6 C69 8 74 12 80 20')}`
	},
	{
		id: 'zodiac',
		body: `
			<path d="M64 12 C48 26 40 52 40 82 L40 104 C40 110 44 114 50 114 L78 114 C84 114 88 110 88 104
				L88 82 C88 52 80 26 64 12Z" fill="${PAPER_DIM}" ${ink(6)}/>
			<path d="M64 30 C56 42 52 62 52 82 L52 100 L76 100 L76 82 C76 62 72 42 64 30Z"
				fill="${INK}" stroke="none"/>
			<path d="M52 56 C52 74 52 88 52 98M76 56 C76 74 76 88 76 98" stroke="${PAPER}" stroke-width="4"
				stroke-linecap="round" stroke-opacity="0.6"/>
			<rect x="55" y="58" width="18" height="13" rx="3" fill="${BRASS}" ${ink(3.5)}/>
			<path d="M58 84h12" stroke="${PAPER_DIM}" stroke-width="5" stroke-linecap="round"/>
			<rect x="57" y="112" width="14" height="12" rx="3" fill="${INK}" stroke="${PAPER}" stroke-width="3"/>
			${wake('M44 26 C50 18 57 13 64 10 C71 13 78 18 84 26')}`
	},
	{
		id: 'ship',
		body: `
			<path d="M64 8 C82 30 90 60 88 92 L88 108 C88 114 84 118 78 118 L50 118 C44 118 40 114 40 108
				L40 92 C38 60 46 30 64 8Z" fill="${PAPER}" ${ink(6)}/>
			<path d="M64 22 C78 40 84 64 82 92 L82 106 L46 106 L46 92 C44 64 50 40 64 22Z"
				fill="${BRASS}" fill-opacity="0.45" stroke="none"/>
			<rect x="50" y="44" width="28" height="26" rx="5" fill="${PAPER_DIM}" ${ink(5)}/>
			<path d="M54 52h20" stroke="${SEA}" stroke-width="5" stroke-linecap="round"/>
			<path d="M48 82h32M48 94h32" stroke="${WOOD}" stroke-width="5" stroke-linecap="round"/>
			<path d="M52 118h24M56 124h16" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
			${wake('M44 24 C51 15 58 10 64 7 C70 10 77 15 84 24')}`
	},
	{
		id: 'turtle',
		body: `
			<path d="M64 20 C56 20 50 26 50 33 C50 40 56 45 64 45 C72 45 78 40 78 33 C78 26 72 20 64 20Z"
				fill="${BRASS_LIT}" ${ink(5.5)}/>
			<path d="M40 40 C22 40 12 54 16 66 C20 78 36 78 46 68M88 40 C106 40 116 54 112 66
				C108 78 92 78 82 68" fill="${OLIVE}" ${ink(5.5)}/>
			<path d="M44 96 C32 104 30 116 38 120 C46 124 54 116 56 106M84 96 C96 104 98 116 90 120
				C82 124 74 116 72 106" fill="${OLIVE}" ${ink(5.5)}/>
			<ellipse cx="64" cy="72" rx="34" ry="40" fill="${OLIVE}" ${ink(6)}/>
			<path d="M64 34 L64 112M34 62 L94 62M32 84 L96 84M46 38 L40 108M82 38 L88 108"
				stroke="${INK}" stroke-width="3.5" stroke-opacity="0.55" fill="none"/>
			<ellipse cx="64" cy="72" rx="16" ry="20" fill="${PAPER_DIM}" fill-opacity="0.35" stroke="none"/>`
	},
	{
		id: 'ray',
		body: `
			<path d="M64 14 C74 14 84 30 106 62 C114 74 110 84 96 86 C84 88 72 92 64 98
				C56 92 44 88 32 86 C18 84 14 74 22 62 C44 30 54 14 64 14Z" fill="${INK}" ${ink(6)}/>
			<path d="M64 26 C70 30 78 44 92 64 C96 70 94 74 86 75 C76 77 68 80 64 84
				C60 80 52 77 42 75 C34 74 32 70 36 64 C50 44 58 30 64 26Z"
				fill="${SEA}" fill-opacity="0.3" stroke="none"/>
			<circle cx="52" cy="40" r="4" fill="${PAPER}"/>
			<circle cx="76" cy="40" r="4" fill="${PAPER}"/>
			<circle cx="44" cy="58" r="3.5" fill="${PAPER}" fill-opacity="0.8"/>
			<circle cx="84" cy="58" r="3.5" fill="${PAPER}" fill-opacity="0.8"/>
			<circle cx="64" cy="52" r="3.5" fill="${PAPER}" fill-opacity="0.8"/>
			<path d="M64 96 C64 106 63 116 62 124" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
			<path d="M64 96 C64 106 63 116 62 124" stroke="${PAPER}" stroke-width="2.5" stroke-linecap="round"
				stroke-opacity="0.5"/>`
	},
	{
		id: 'grouper',
		body: `
			<path d="M64 12 C82 12 94 34 94 62 C94 82 88 98 80 106 L86 120 L64 110 L42 120 L48 106
				C40 98 34 82 34 62 C34 34 46 12 64 12Z" fill="${WOOD}" ${ink(6)}/>
			<path d="M64 24 C76 24 84 40 84 62 C84 78 80 90 74 98 L54 98 C48 90 44 78 44 62
				C44 40 52 24 64 24Z" fill="${BRASS}" fill-opacity="0.4" stroke="none"/>
			<path d="M34 58 C22 62 16 72 20 82 C24 90 34 88 40 78M94 58 C106 62 112 72 108 82
				C104 90 94 88 88 78" fill="${WOOD}" ${ink(5)}/>
			<circle cx="52" cy="30" r="5.5" fill="${PAPER}" ${ink(3.5)}/>
			<circle cx="76" cy="30" r="5.5" fill="${PAPER}" ${ink(3.5)}/>
			<path d="M54 18 C58 14 70 14 74 18" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
			<circle cx="56" cy="52" r="4" fill="${PAPER}" fill-opacity="0.55"/>
			<circle cx="74" cy="64" r="4" fill="${PAPER}" fill-opacity="0.55"/>
			<circle cx="58" cy="76" r="4" fill="${PAPER}" fill-opacity="0.55"/>`
	},
	{
		id: 'octopus',
		body: `
			<path d="M30 66 C14 76 10 96 18 110 C22 118 30 116 30 108 C30 98 34 88 44 82" ${ink(7)} fill="none"/>
			<path d="M98 66 C114 76 118 96 110 110 C106 118 98 116 98 108 C98 98 94 88 84 82" ${ink(7)} fill="none"/>
			<path d="M46 84 C38 102 40 118 50 124 C58 128 62 120 58 112 C54 104 54 96 58 88" ${ink(7)} fill="none"/>
			<path d="M82 84 C90 102 88 118 78 124 C70 128 66 120 70 112 C74 104 74 96 70 88" ${ink(7)} fill="none"/>
			<path d="M30 66 C14 76 10 96 18 110 C22 118 30 116 30 108 C30 98 34 88 44 82" stroke="${HAZARD}"
				stroke-width="4" stroke-linecap="round" fill="none"/>
			<path d="M98 66 C114 76 118 96 110 110 C106 118 98 116 98 108 C98 98 94 88 84 82" stroke="${HAZARD}"
				stroke-width="4" stroke-linecap="round" fill="none"/>
			<path d="M46 84 C38 102 40 118 50 124 C58 128 62 120 58 112 C54 104 54 96 58 88" stroke="${HAZARD}"
				stroke-width="4" stroke-linecap="round" fill="none"/>
			<path d="M82 84 C90 102 88 118 78 124 C70 128 66 120 70 112 C74 104 74 96 70 88" stroke="${HAZARD}"
				stroke-width="4" stroke-linecap="round" fill="none"/>
			<path d="M64 10 C84 10 94 30 94 52 C94 72 82 86 64 86 C46 86 34 72 34 52 C34 30 44 10 64 10Z"
				fill="${HAZARD}" ${ink(6)}/>
			<path d="M64 22 C78 22 86 36 86 52 C86 66 78 76 64 76 C50 76 42 66 42 52 C42 36 50 22 64 22Z"
				fill="${PAPER}" fill-opacity="0.2" stroke="none"/>
			<circle cx="50" cy="46" r="7" fill="${PAPER}" ${ink(4)}/>
			<circle cx="78" cy="46" r="7" fill="${PAPER}" ${ink(4)}/>
			<circle cx="50" cy="46" r="2.6" fill="${INK}"/>
			<circle cx="78" cy="46" r="2.6" fill="${INK}"/>`
	}
];

const page = (body, size) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:transparent}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
	<filter id="halo" x="-30%" y="-30%" width="160%" height="160%">
		<feDropShadow dx="0" dy="0" stdDeviation="4.5" flood-color="#0a0805" flood-opacity="0.85"/>
		<feDropShadow dx="0" dy="0" stdDeviation="9" flood-color="#0a0805" flood-opacity="0.45"/>
	</filter>
	<g filter="url(#halo)">${body}</g>
</svg>`;

const outAt = process.argv.indexOf('--out');
const sizeAt = process.argv.indexOf('--size');
const out = resolve(outAt === -1 ? 'static/avatars' : process.argv[outAt + 1]);
const size = sizeAt === -1 ? 256 : Number(process.argv[sizeAt + 1]);

mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: size, height: size } });
const tab = await ctx.newPage();

for (const { id, body } of AVATARS) {
	await tab.setContent(page(body, size));
	await tab.locator('svg').screenshot({ path: `${out}/${id}.png`, omitBackground: true });
}
await browser.close();

// The TypeScript catalogue is the union the UI types against; avatars.spec.ts
// asserts it matches this file, so a new drawing that never got a label fails a
// test instead of rendering as a blank sprite.
writeFileSync(
	`${out}/index.json`,
	`${JSON.stringify({ size, pixelRatio: 4, ids: AVATARS.map((a) => a.id) }, null, '\t')}\n`
);

console.log(JSON.stringify({ out, size, count: AVATARS.length, ids: AVATARS.map((a) => a.id) }));
