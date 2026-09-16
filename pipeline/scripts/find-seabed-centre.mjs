import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1107, height: 1591 } })).newPage();
await p.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(20000);
const out = await p.evaluate(async () => {
	const m = window.diveMap;
	// Find a habitat polygon near Tamariu and use its own vertex as the centre.
	m.jumpTo({ center: [3.2118, 41.9186], zoom: 14 });
	await new Promise((r) => setTimeout(r, 6000));
	const feats = m
		.querySourceFeatures('habitats', { sourceLayer: 'habitats' })
		.filter((f) => f.geometry.type === 'Polygon' && (f.properties.dmax ?? 0) >= 10);
	const pick = feats[Math.floor(feats.length / 2)];
	const ring = pick.geometry.coordinates[0];
	const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
	const results = [];
	for (const zoom of [18.81, 17.5]) {
		m.jumpTo({ center: c, zoom });
		await new Promise((r) => setTimeout(r, 6000));
		results.push({
			centre: [+c[0].toFixed(4), +c[1].toFixed(4)],
			zoom,
			ground: m.queryRenderedFeatures({ layers: ['ground-fill'] }).length,
			iso: m.queryRenderedFeatures({ layers: ['isobath'] }).length,
			code: pick.properties.code,
			dmax: pick.properties.dmax
		});
	}
	return results;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
