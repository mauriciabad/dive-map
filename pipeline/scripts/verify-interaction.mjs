#!/usr/bin/env node
/**
 * Click a real dive site on the real map and check the panel opens with its data.
 *
 * The component was verified on its own; this checks the wiring, which is the
 * part that breaks silently. A card that never opens and a card that opens empty
 * look the same to every other check.
 *
 * Usage: node pipeline/scripts/verify-interaction.mjs <url> [--shot dir/]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4176/';
const shotAt = process.argv.indexOf('--shot');
const shotDir = shotAt === -1 ? undefined : process.argv[shotAt + 1];
if (shotDir) mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(25_000);

const target = await page.evaluate(() => {
  const m = window.diveMap;
  if (!m) return { error: 'no map handle; run against a dev build' };
  const sites = m.queryRenderedFeatures({ layers: ['osm-dive-site'] });
  if (sites.length === 0) return { error: 'no dive sites in view' };
  const named = sites.find((f) => typeof f.properties.name === 'string') ?? sites[0];
  const at = m.project(named.geometry.coordinates);
  return {
    name: named.properties.name ?? '(unnamed)',
    tags: Object.keys(named.properties).slice(0, 12),
    x: Math.round(at.x),
    y: Math.round(at.y),
    sitesInView: sites.length
  };
});

if (target.error) {
  console.log(JSON.stringify({ url, ok: false, ...target }, null, 2));
  await browser.close();
  process.exit(1);
}

// A real trusted click. MapLibre listens through its own handlers, and a
// synthetic MouseEvent dispatched at the canvas does not reach them.
await page.mouse.click(target.x, target.y);
await page.waitForTimeout(1500);

const result = await page.evaluate(() => {
  const card = document.querySelector('section.sheet');
  return {
    cardFound: Boolean(card),
    cardText: card?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 220),
    sheets: document.querySelectorAll('section.sheet').length
  };
});
Object.assign(result, { clicked: target.name, at: [target.x, target.y], sitesInView: target.sitesInView, tags: target.tags });

if (shotDir) await page.screenshot({ path: `${shotDir}/card-open.png` });
await browser.close();

const ok = result.cardFound === true && (result.cardText?.length ?? 0) > 10;
console.log(JSON.stringify({ url, ok, ...result, consoleErrors: errors.slice(0, 5) }, null, 2));
process.exit(ok ? 0 : 1);
