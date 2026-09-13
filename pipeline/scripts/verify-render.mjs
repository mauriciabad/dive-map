#!/usr/bin/env node
/**
 * Load the map in a real browser and report what actually painted.
 *
 * The failure this exists to catch is silent: MapLibre paints its background
 * layer, loads no tiles, and raises no error, so the page looks like it is
 * merely slow. Luminance spread across a patch of sea separates "drawing the
 * seabed" from "drawing one flat colour" without anyone squinting at a
 * screenshot.
 *
 * Usage: node pipeline/scripts/verify-render.mjs <url> [--shot out.png] [--no-sw]
 *          [--at lng,lat,zoom] [--layers a,b,c] [--settle ms]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5178/';
const shotAt = process.argv.indexOf('--shot');
const shot = shotAt === -1 ? undefined : process.argv[shotAt + 1];
const noSw = process.argv.includes('--no-sw');
const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};
const at = flag('--at')?.split(',').map(Number);
const camera = at?.length === 3 ? { center: [at[0], at[1]], zoom: at[2] } : undefined;
const extraLayers = flag('--layers')?.split(',').filter(Boolean) ?? [];
const settleMs = Number(flag('--settle') ?? 6000);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
if (noSw) await context.addInitScript(() => {
  Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined });
});

const page = await context.newPage();
const errors = [];
const failed = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 110)}`); });

await page.goto(url, { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(async ({ camera, extraLayers, settleMs }) => {
  const deadline = Date.now() + 45_000;
  const canvas = () => document.querySelector('.maplibregl-canvas');
  while (!canvas() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300));
  const c = canvas();
  if (!c) return { error: 'no map canvas' };

  const gl = c.getContext('webgl2') ?? c.getContext('webgl');
  const patch = () => {
    const w = 260, h = 260;
    const x = Math.floor(c.width * 0.42), y = Math.floor(c.height * 0.42);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let s = 0, s2 = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      s += l; s2 += l * l; n++;
    }
    const mean = s / n;
    return { mean: +mean.toFixed(1), sd: +Math.sqrt(s2 / n - mean * mean).toFixed(2) };
  };

  let last = patch();
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    last = patch();
    if (last.sd > 3) break;
  }

  const m = window.diveMap;
  if (m && camera) {
    m.jumpTo(camera);
    await new Promise((r) => setTimeout(r, settleMs));
    last = patch();
  }
  const layers = {};
  if (m) {
    const wanted = ['isobath', 'isobath-label', 'shoreline', 'land', 'osm-marker-key', ...extraLayers];
    for (const id of wanted) {
      try { layers[id] = m.queryRenderedFeatures({ layers: [id] }).length; } catch { layers[id] = 'absent'; }
    }
  }
  return { pixels: last, layers, hasHandle: Boolean(m) };
}, { camera, extraLayers, settleMs });

if (shot) {
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
}
await browser.close();

const painted = (result.pixels?.sd ?? 0) > 3;
console.log(JSON.stringify({ url, painted, ...result, consoleErrors: errors.slice(0, 6), failedRequests: failed.slice(0, 8) }, null, 2));
process.exit(painted ? 0 : 1);
