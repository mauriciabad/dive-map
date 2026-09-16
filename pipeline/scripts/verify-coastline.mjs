import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = [];
p.on('console', (m) => {
	if (m.type() === 'error') errs.push(m.text().slice(0, 120));
});
p.on('pageerror', (e) => errs.push(`pageerror: ${e.message.slice(0, 120)}`));
await p.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(22000);
const r = await p.evaluate(async () => {
	const m = window.diveMap;
	m.jumpTo({ center: [3.2147, 41.914], zoom: 15 });
	await new Promise((r) => setTimeout(r, 6000));
	const ids = new Set(m.getStyle().layers.map((l) => l.id));
	// The coastline is the 0 m contour drawn by the ordinary isobath layer and
	// nothing else. A layer of its own here would be the bug, not the check.
	const zero = ids.has('isobath')
		? m
				.queryRenderedFeatures({ layers: ['isobath'] })
				.filter((f) => Number(f.properties.depth) === 0)
		: [];
	return {
		ownLayer: ids.has('zero-isobath') || ids.has('shoreline'),
		hasSeaFloor: ids.has('sea-floor'),
		zeroFeatures: zero.length,
		layerCount: ids.size
	};
});
await p.screenshot({ path: 'docs/shots/coastline.png' });
console.log(JSON.stringify({ ...r, consoleErrors: errs.slice(0, 4) }, null, 1));
await b.close();
