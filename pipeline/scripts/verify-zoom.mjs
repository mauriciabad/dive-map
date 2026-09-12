#!/usr/bin/env node
/** Render counts at a given camera, so the print path can be compared against the live map. */
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1107, height: 1591 } })).newPage();
await p.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(20000);
const out = await p.evaluate(async () => {
  const m = window.diveMap;
  const at = [];
  for (const [lng, lat, zoom] of [[3.2118, 41.9186, 18.81], [3.2118, 41.9186, 15.5], [3.2118, 41.9186, 17]]) {
    m.jumpTo({ center: [lng, lat], zoom });
    await new Promise(r => setTimeout(r, 6000));
    at.push({
      zoom,
      ground: m.queryRenderedFeatures({ layers: ['ground-fill'] }).length,
      iso: m.queryRenderedFeatures({ layers: ['isobath'] }).length,
      land: m.queryRenderedFeatures({ layers: ['land'] }).length,
      srcHab: m.querySourceFeatures('habitats', { sourceLayer: 'habitats' }).length,
      hasGrass: m.hasImage('ch_grass')
    });
  }
  return at;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
