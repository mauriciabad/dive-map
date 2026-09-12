import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(12000);
const out = await p.evaluate(() => {
  const corners = {};
  for (const c of ['top-left','top-right','bottom-left','bottom-right']) {
    const el = document.querySelector(`.maplibregl-ctrl-${c}`);
    corners[c] = el ? [...el.children].map(g => ({
      cls: g.className,
      buttons: [...g.querySelectorAll('button')].map(b => b.className || b.title || b.getAttribute('aria-label')),
      rect: (r => ({x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}))(g.getBoundingClientRect())
    })) : null;
  }
  const probe = document.querySelector('.maplibregl-ctrl-group button');
  const root = getComputedStyle(document.documentElement);
  const vars = {};
  for (const v of ['--ctrl-size','--spacing-touch','--ctrl-gap','--color-brass-300','--radius-rail']) {
    vars[v] = root.getPropertyValue(v).trim() || '(empty)';
  }
  const btn = probe ? (cs => ({ width: cs.width, height: cs.height, display: cs.display }))(getComputedStyle(probe)) : null;
  return { corners, vars, button: btn };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
