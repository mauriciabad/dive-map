#!/usr/bin/env node
/**
 * Build the real map style and validate it against the MapLibre style spec.
 *
 * The style is the one artifact where a typo costs nothing at compile time and
 * everything at runtime: a bad expression makes a layer silently vanish rather
 * than throw. This loads the actual TypeScript module, so it checks what ships.
 *
 * Writes the built style to build/style.json for inspection.
 */
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import ts from 'typescript';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'data', 'build', 'style-check');
mkdirSync(out, { recursive: true });

const STUBS = {
	'$app/paths': "export const asset = (f) => f;\nexport const base = '';\n"
};

const compile = (rel, name) => {
	const src = readFileSync(join(root, rel), 'utf8')
		.replace(/from '\$app\/paths'/g, "from './app-paths.mjs'")
		.replace(/from '\$lib\/([\w/-]+)'/g, (_, p) => `from './${p.split('/').pop()}.mjs'`)
		.replace(/from '\.\/([\w-]+)\.ts'/g, "from './$1.mjs'");
	const js = ts.transpileModule(src, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
	}).outputText;
	writeFileSync(join(out, `${name}.mjs`), js);
};

writeFileSync(join(out, 'app-paths.mjs'), STUBS['$app/paths']);
for (const [rel, name] of [
	['src/lib/domain/units.ts', 'units'],
	['src/lib/domain/print.ts', 'print'],
	['src/lib/domain/habitat.ts', 'habitat'],
	['src/lib/domain/card.ts', 'card'],
	['src/lib/map/style.ts', 'style']
]) {
	compile(rel, name);
}

const { buildStyle } = await import(pathToFileURL(join(out, 'style.mjs')).href);
const { DEFAULT_ISOBATHS, DEFAULT_LAYERS } = await import(pathToFileURL(join(out, 'card.mjs')).href);

let failed = 0;
for (const ground of ['habitats', 'substrate']) {
	for (const isobaths of [
		DEFAULT_ISOBATHS,
		{ ...DEFAULT_ISOBATHS, intervalM: 1, labels: false },
		{ ...DEFAULT_ISOBATHS, intervalM: 10, maxDepthM: 50, emphasised: [10, 20, 30] }
	]) {
		const style = buildStyle({ isobaths, visible: DEFAULT_LAYERS, groundLayer: ground });
		const errors = validateStyleMin(style);
		const label = `${ground} @ ${isobaths.intervalM}m`;
		if (errors.length > 0) {
			failed += errors.length;
			console.error(`FAIL ${label}`);
			for (const e of errors) console.error(`  ${e.message}`);
		} else {
			console.log(`ok   ${label}: ${style.layers.length} layers, ${Object.keys(style.sources).length} sources`);
		}
	}
}

const style = buildStyle({
	isobaths: DEFAULT_ISOBATHS,
	visible: DEFAULT_LAYERS,
	groundLayer: 'habitats'
});
writeFileSync(join(out, 'style.json'), JSON.stringify(style, null, 2));
console.log(`\nlayers: ${style.layers.map((l) => l.id).join(', ')}`);
console.log(`written: ${join(out, 'style.json')}`);
process.exit(failed > 0 ? 1 : 0);
