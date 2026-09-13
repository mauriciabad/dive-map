import { describe, expect, it } from 'vitest';
import { precacheList, precachePlan, type ServiceWorkerManifest } from './service-worker.ts';

/**
 * The split is the whole of issue #46's second half. `cache.addAll` is all or
 * nothing, so one static file that will not fetch discards the installing worker
 * and the browser keeps serving the old build with nothing to say why. Only the
 * files the app cannot start without are allowed to do that.
 */
const manifest = (base: string): ServiceWorkerManifest => ({
	version: '1789326439801',
	base,
	build: [`${base}/_app/immutable/entry/app.DwEfC05J.js`, `${base}/_app/immutable/nodes/0.js`],
	files: [
		`${base}/data/habitats.json`,
		`${base}/fonts/alegreya.woff2`,
		`${base}/textures/1024/ch_sand.webp`,
		`${base}/tiles/seabed-dem.pmtiles`
	],
	prerendered: [`${base}/`]
});

describe('precachePlan', () => {
	it('requires this version’s own html and bundle, and nothing else', () => {
		const plan = precachePlan(manifest(''));
		expect(plan.required).toEqual([
			'/_app/immutable/entry/app.DwEfC05J.js',
			'/_app/immutable/nodes/0.js',
			'/'
		]);
	});

	it('lets a static file miss the install, because a runtime route will fetch it', () => {
		const plan = precachePlan(manifest(''));
		expect(plan.optional).toContain('/data/habitats.json');
		expect(plan.optional).toContain('/fonts/alegreya.woff2');
	});

	it('leaves the archives and the large textures out of the install entirely', () => {
		const plan = precachePlan(manifest(''));
		const all = [...plan.required, ...plan.optional];
		expect(all).not.toContain('/tiles/seabed-dem.pmtiles');
		expect(all).not.toContain('/textures/1024/ch_sand.webp');
	});

	it('reads a path’s purpose off the site’s own part of it, under a subpath too', () => {
		const plan = precachePlan(manifest('/dive-map'));
		expect(plan.required).toContain('/dive-map/');
		expect(plan.optional).toContain('/dive-map/data/habitats.json');
		expect(plan.optional).not.toContain('/dive-map/textures/1024/ch_sand.webp');
	});

	it('offers the routing table the same set it always did, each path once', () => {
		const list = precacheList(manifest(''));
		expect(list).toEqual([...new Set(list)]);
		expect([...list].sort()).toEqual(
			[...precachePlan(manifest('')).required, ...precachePlan(manifest('')).optional].sort()
		);
	});
});
