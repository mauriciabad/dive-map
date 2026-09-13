import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = [];
p.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,120)); });
p.on('pageerror', e => errs.push(`pageerror: ${e.message.slice(0,120)}`));
await p.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(22000);
const r = await p.evaluate(async () => {
  const m = window.diveMap;
  m.jumpTo({ center: [3.2147, 41.9140], zoom: 15 });
  await new Promise(r => setTimeout(r, 6000));
  const ids = new Set(m.getStyle().layers.map(l => l.id));
  return {
    hasZero: ids.has('zero-isobath'), hasSeaFloor: ids.has('sea-floor'),
    zeroFeatures: ids.has('zero-isobath') ? m.queryRenderedFeatures({ layers: ['zero-isobath'] }).length : -1,
    layerCount: ids.size
  };
});
await p.screenshot({ path: 'docs/shots/zero-isobath.png' });
console.log(JSON.stringify({ ...r, consoleErrors: errs.slice(0,4) }, null, 1));
await b.close();
