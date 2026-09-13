# dive-map

A scuba diving map of the Catalan coast. ICGC bathymetry and marine habitats drawn over
OpenStreetMap, printable as A3 dive briefing cards.

Live at [divemap.mauri.app](https://divemap.mauri.app). MIT licensed.

## Running it

```sh
pnpm install
pnpm dev
```

```sh
pnpm run check      # svelte-check, must report 0 errors and 0 warnings
pnpm test           # vitest
pnpm run build      # static output in build/
pnpm run preview    # serve build/ on localhost:4173
```

The service worker only runs against a build, so test offline behaviour under `preview`,
not `dev`.

## Deploying

`.github/workflows/deploy.yml` runs on every push to `main`. It runs `pnpm run check` and
`pnpm test` before `pnpm run build`, and the deploy job needs the build job, so a type
error or a failing test stops the deploy instead of shipping past it.

The site is fully prerendered by `@sveltejs/adapter-static` with `fallback: '404.html'`,
because GitHub Pages serves files and nothing else. `src/routes/+layout.ts` sets
`prerender = true` and `ssr = false`, so each route becomes an HTML file at build time and
hydrates in the browser. There is no server at runtime.

**The base path is empty.** `static/CNAME` points the site at divemap.mauri.app, a custom
subdomain that serves from its own root, so every asset lives at `/`. A base of
`/dive-map` would only be right on the `github.io` project-page URL, and setting it would
break every asset path on the real domain. For the same reason the workflow passes no
`static_site_generator` input to `actions/configure-pages`, which is what would otherwise
inject a repo-name base path.

## The app icon

The artwork is three hand-drawn SVGs in `pipeline/icons/`, kept exactly as they were
exported. `pipeline/scripts/build_favicons.mjs` is the only thing that reads them, and it
writes all seven served assets into `static/`. Redraw a source and rerun the script. Do
not edit a file in `static/icons/`, and nothing ever writes back into `pipeline/icons/`.

```sh
node pipeline/scripts/build_favicons.mjs
node pipeline/scripts/build_favicons.mjs --contact docs/shots/icon-contact.png
```

The three files are separate compositions rather than one drawing at three paddings, and
keeping them that way is the whole point. `--contact` renders all three against a circle,
a squircle, the safe zone and a dark tab strip at 16, 32 and 48, which is how the choices
below were made rather than assumed.

| source                 | feeds                                                                                                          | why                                                                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `favicon-full.svg`     | `apple-touch-icon.png` at 180                                                                                  | Bleeds to all four edges. Apple rounds this icon itself, so handing it the pre-rounded drawing rounds it twice and bites a crescent out of each corner.                                                                          |
| `favicon-rounded.svg`  | `favicon.svg`, `favicon.ico` at 16, 32 and 48, `icons/icon-192.png` and `icons/icon-512.png` at `purpose: any` | Carries its own corner radius. A browser tab, a desktop shortcut and a crawler all composite an icon unshaped, so it has to bring its own silhouette.                                                                            |
| `favicon-maskable.svg` | `icons/icon-maskable-192.png` and `icons/icon-maskable-512.png` at `purpose: maskable`                         | The same scene pulled back, so the compass, the diver and all three pins sit inside the centre circle of 80% that the spec guarantees and paint runs off every edge. A launcher's crop then lands on sea instead of on a border. |

A maskable icon that is the `any` icon with padding is the usual mistake, and
`docs/shots/pwa-maskable-safezone.png` is where to check it, because it shows the circular
and squircle crops against the safe circle.

svgo is held to renders rather than to bytes. The script rasterises every drawing before
and after optimising, at all six sizes it ships, and compares them pixel by pixel. It
fails before writing anything if the two disagree, so a plugin that quietly moves a path
breaks the build instead of shipping. Three plugins were caught doing exactly that and are
configured off or exact. `mergePaths` shifted about 240 pixels per drawing to save 57
bytes. `cleanupNumericValues` moved an edge for 37 bytes. `convertPathData` moved another
through the transforms that only approximate a curve, so it keeps just its exact ones and
still saves 4.5 KB, which is most of the 22% the three sources lose. What survives is
pixel-identical at 16, 32, 48 and 180, and moves a handful of antialiased pixels along one
diagonal at 192 and 512. If you redraw the icons and the gate starts failing, the drawing
changed in a way svgo now handles differently; read the numbers it prints before widening
the threshold.

One thing the pipeline cannot fix. The drawing does not survive 16 px. At 48 and above it
is clear, at 32 it still reads, and at 16 the diver and the compass collapse into a white
smear with only the blue, white and red left as a colour signature. That is the density of
the artwork rather than anything the build does, so it is worth knowing before redrawing.

## Installing it

`static/manifest.webmanifest` uses `"."` for `id`, `start_url` and `scope`, and relative
paths for every icon. A manifest's URL is the base its relative members resolve against,
so `"."` is whichever directory the manifest was served from: `/` on divemap.mauri.app and
`/dive-map/` on the github.io project URL, from one file. A leading slash would be right
for exactly one of them, and Chrome installs the wrong scope without complaining, which is
why `verify-pwa.mjs` resolves both against the manifest and asserts they land on the page's
own directory. Run it against both URLs from the same build.

The icon links, the manifest link and the theme colour live in `src/app.html` rather than
in `svelte:head`, because `src/routes/+layout.ts` sets `ssr = false` and anything in
`svelte:head` only exists once the bundle has run. Chrome reads the manifest off the served
HTML when it decides whether the app can be installed.

`kit.serviceWorker.register` is `false` and `src/routes/+layout.svelte` registers the worker
itself. SvelteKit's generated snippet tests `'serviceWorker' in navigator` and then reads
`.register` off it, which throws wherever the property is declared and the API is absent:
outside a secure context, in Safari private browsing, and in several embedded webviews.
`serviceWorkerContainer()` in `src/lib/offline/support.ts` is the guard, because `lib.dom`
types the property as always present and every unguarded read typechecks.

## Offline

Offline is the normal mode at the moment of use, not a fallback. A diver on a boat has no
signal, so everything the map needs has to already be on the phone.

`src/service-worker.ts` is thin. SvelteKit keeps that file out of the app `tsconfig`
because it needs `lib.webworker`, which cannot load alongside `lib.dom`, so the logic
lives in `src/lib/offline/service-worker.ts` where `pnpm run check` and eslint can see it
and the routing table is unit tested.

### What gets cached, and when

| Asset                            | Policy                 | Why                                                                                                              |
| -------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| App shell, JS, CSS               | precache on install    | Nothing loads without it                                                                                         |
| `textures/256`, `textures/512`   | precache on install    | 512 is the largest a phone needs for a repeating pattern fill, and a blank seabed polygon on a boat is a failure |
| `textures/1024`, `textures/2048` | cache on first use     | The 2048 set exists for A3 printing, which happens on a laptop that has a network                                |
| `data/*.geojson`                 | precache on install    | Small, and the OSM overlay is the layer people read first                                                        |
| `tiles/*.pmtiles`                | byte ranges, on demand | Tens of MB in single files. Precaching them is not an option                                                     |

Measured against the current build, install costs 1.74 MB over 102 files. Skipping the two
print texture sizes keeps 9.8 MB off the phone and skipping the archives keeps off another
78.5 MB. Those figures move as the data grows. The split is the decision, not the numbers.

`assetPolicy()` in `src/lib/offline/assets.ts` holds the rules as a table, applied to
whatever SvelteKit reports in `files`. Adding a file to `static/` picks up the right
policy without touching the service worker.

### Caching byte ranges

PMTiles archives are read with HTTP range requests, never fetched whole. The Cache API
refuses to store a 206 Partial Content response outright, so the usual
`cache.put(request, response)` throws a `TypeError` and the obvious approach is a dead end.

What works is to split the archive into fixed 64 KiB chunks, request each chunk on its own
aligned boundary, and store it as an ordinary 200 response under a synthesised key
carrying the chunk size and index (`coastline.pmtiles?__chunk=65536:45`). A read then
reassembles the chunks it needs and builds the 206 the caller expected. The Cache API is
happy because it never sees a partial response, and the caller is happy because it gets
one.

Chunks carry the archive's ETag. A read that supplies an expected ETag ignores chunks
written by a different build, which stops a redeploy from serving a mix of old and new
bytes as one tile.

Reads search every cache in the origin, so a chunk pinned by a saved area also serves an
ordinary map pan. Writes go to one named cache, so evicting an area is a single
`caches.delete`.

### Saving an area

```ts
import { saveArea, listAreas, evictArea, storageUsage, requestPersistence } from '$lib/offline';

const area = await saveArea(
	{
		name: 'Illes Medes',
		bounds: { west: 3.19, south: 42.02, east: 3.26, north: 42.07 },
		zoom: { min: 10, max: 15 },
		archives: ['/tiles/coastline.pmtiles', '/tiles/dem.pmtiles']
	},
	{
		onProgress: ({ done, total, bytes }) => report(done / total, bytes),
		signal: controller.signal
	}
);

await listAreas();
await evictArea(area.id);
```

`saveArea` walks the tiles covering the box and reads each one through pmtiles, which
means the archive's own directory walk decides which byte ranges matter rather than
anything here guessing. Every range it touches lands in that area's cache. Call it again
with the same box and it only fills gaps, so an interrupted save resumes by being retried.
An aborted or failed save deletes its own cache rather than leaving a half-saved area on
the manifest.

Call `requestPersistence()` before the first save. Without it the browser may evict saved
areas under storage pressure, which on a boat means losing the map with no way to get it
back.

### Checking it still works

`src/lib/offline/range-cache.spec.ts` reads byte ranges out of a real 2 KB PMTiles archive
(`fixture.pmtiles`, built with tippecanoe), then cuts the network and reads them again,
asserting the same bytes and zero further requests. It also decodes a real tile through
`PMTiles` with the network down, and asserts that a range nobody cached still fails, so a
passing run cannot be a silent fallthrough to the network.

`src/lib/offline/areas.spec.ts` runs `saveArea`, `listAreas` and `evictArea` against a fake
Cache API, covering the manifest round-trip, per-area caches, progress that reaches the
total, and a failed save cleaning up after itself.

The service worker itself needs a browser. Build, `pnpm run preview`, load the page, then
kill the preview server and reload. The page still loads from the shell cache, byte ranges
already read come back from the chunk cache, and anything never fetched fails, which is how
you tell the cache apart from a network that is quietly still there.

## Where the work is tracked

Open work is in GitHub issues, not in a file. Start there:

```sh
gh issue list
gh issue view <n>
```

`HANDOFF.md` is background: how the thing is built, and the mistakes already paid
for. Two are worth reading before touching the map, because both fail silently
and look like slowness rather than breakage.

## Checking your work

`pnpm run check` passing is not proof it builds. Run all four:

```sh
CI=true pnpm run check          # svelte-check, 0 errors and 0 warnings
pnpm exec eslint .
CI=true node node_modules/vitest/vitest.mjs run
CI=true pnpm run build
```

Then look at the real thing. These drive a browser and read pixels, because a
flat blue rectangle and a rendered seabed are indistinguishable to everything
above:

```sh
node pipeline/scripts/verify-render.mjs <url>       # does the seabed actually draw
node pipeline/scripts/verify-interaction.mjs <url>  # does tapping a site open the panel
node pipeline/scripts/verify-options.mjs <url>      # do the settings do anything
node pipeline/scripts/verify-export.mjs <url>       # does a real A3 PDF come out
node pipeline/scripts/verify-land.mjs <url>         # does the land detail draw, and survive a restyle
node pipeline/scripts/verify-world.mjs <url>        # does the map still end in a straight line
node pipeline/scripts/find-seabed-centre.mjs <url>  # a centre with seabed under it
node pipeline/scripts/validate-style.mjs            # the style against the MapLibre spec
node pipeline/scripts/verify-pwa.mjs <url>          # would Chrome offer to install it
```
