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
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'data', 'build', 'style-check');
mkdirSync(out, { recursive: true });

writeFileSync(join(out, 'app-paths.mjs'), "export const asset = (f) => f;\nexport const base = '';\n");

/**
 * Every module the style actually pulls in, found by following the imports.
 *
 * This used to be a list typed out by hand, and a list typed out by hand goes
 * stale the first time anything moves: extracting the palette and adding the
 * live-position layers both left an import with nothing behind it, and the whole
 * check had been dying on a missing module rather than validating anything. The
 * imports are scanned off the compiled output, so a `import type` erased by the
 * transpiler correctly pulls in nothing.
 */
const compiled = new Set();

const compile = (file) => {
	const name = basename(file, '.ts');
	if (compiled.has(name)) return name;
	compiled.add(name);
	const src = readFileSync(file, 'utf8')
		.replace(/from '\$app\/paths'/g, "from './app-paths.mjs'")
		.replace(/from '\$lib\/([\w/-]+)'/g, (_, p) => `from './${p.split('/').pop()}.mjs'`)
		.replace(/from '\.\/([\w-]+)(?:\.ts)?'/g, "from './$1.mjs'");
	const js = ts.transpileModule(src, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
	}).outputText;
	writeFileSync(join(out, `${name}.mjs`), js);

	for (const [, dependency] of js.matchAll(/from ["']\.\/([\w-]+)\.mjs["']/g)) {
		if (dependency === 'app-paths' || compiled.has(dependency)) continue;
		const hit = sources.find((path) => basename(path, '.ts') === dependency);
		if (hit === undefined) throw new Error(`${name} imports ${dependency}, which is not under src/`);
		compile(hit);
	}
	return name;
};

const sources = [];
const walk = (dir) => {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walk(path);
		else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) sources.push(path);
	}
};
walk(join(root, 'src', 'lib'));

compile(join(root, 'src', 'lib', 'map', 'style.ts'));
compile(join(root, 'src', 'lib', 'domain', 'card.ts'));

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
	locale: 'ca',
	smoothed: true,
	isobaths: DEFAULT_ISOBATHS,
	visible: DEFAULT_LAYERS,
	groundLayer: 'habitats'
});
writeFileSync(join(out, 'style.json'), JSON.stringify(style, null, 2));
console.log(`\nlayers: ${style.layers.map((l) => l.id).join(', ')}`);
console.log(`written: ${join(out, 'style.json')}`);
process.exit(failed > 0 ? 1 : 0);
