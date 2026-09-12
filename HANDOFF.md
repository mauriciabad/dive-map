# Handoff

**Outstanding work lives in GitHub issues, not here.** `gh issue list` is the
current state of the project. This file is background: how things are built and
which mistakes have already been paid for.

State as of 2026-09-12.

## Where things stand

`main` builds, deploys, and renders. Verified on the live site:

```
$ node pipeline/scripts/verify-render.mjs https://mauriciabad.github.io/dive-map/
painted: true, luminance sd 49.46, no console errors, no failed requests
```

`wip/agents-in-flight` holds three agents' unfinished work. **It does not compile.**
Nothing there is lost; it just needs finishing.

Live at https://mauriciabad.github.io/dive-map/ . `divemap.mauri.app` will not
resolve until the DNS record points at GitHub Pages; `static/CNAME` is already in
the build and GitHub will issue the certificate once DNS answers. GitHub refuses
to accept the domain over the API before then ("The certificate does not exist
yet"), so this step is genuinely blocked on DNS, not on code.

## Two bugs worth remembering

**MapLibre's worker dies silently.** It resolves its tile worker with a bare
relative URL, which a bundler resolves against the importing chunk's directory.
Both dev and the build asked for a path that 404s. The worker does every bit of
tile decoding, and when it dies the map paints its background layer, loads
nothing, and raises no error at all. It cost about two hours across two separate
occasions because every check short of looking at pixels said the app was fine.
Fixed in `MapView.svelte` with `?worker&url` plus `setWorkerUrl`.
`pipeline/scripts/verify-render.mjs` exists to catch exactly this: it measures
the luminance spread over a patch of sea, because a flat blue rectangle and a
rendered seabed are indistinguishable to a typecheck, a lint, a test, a green
deploy, and a glance at a screenshot.

**`pnpm run check` passing is not proof the thing builds.** The first deploy
failed on `import fontkit from 'fontkit'`; fontkit 2.x has named exports only in
its browser build, and dev had happily resolved it. Run `pnpm run build` before
pushing.

## Where the open work went

Every outstanding request is an issue now. Read them before starting anything:

    gh issue list
    gh issue view <n>

What follows is the state as of the first session, kept because the reasoning
behind the closed items is not repeated in the issues.

## What the user asked for that was still open then

From their message, in their order:

1. ~~Nothing pushed, no deploy.~~ Done.
2. **UI broken and unusable.** Mostly built on the wip branch: controls are now
   real MapLibre `IControl`s so they stack with the zoom buttons, and theme.css
   masks MapLibre's own glyphs with `currentColor` so both sets take the brass.
   Needs finishing and verifying at phone sizes.
3. ~~No shading.~~ Sun altitude to 15 degrees, exaggeration to 1.0. The shelf
   drops 80 m over kilometres; at a realistic angle there is nothing to see.
4. ~~Contours not every metre.~~ Interval now follows zoom, every metre from z16.
5. **Habitat squares.** Not fixed. `pipeline/scripts/smooth_polygons.py` is
   started. The polygons come from a 10 m raster so every edge is a staircase.
   The smoothing must operate on shared-edge topology, not on each polygon, or
   every boundary between neighbours opens a gap. Ship smoothed and raw tiles so
   it can be a toggle, default on.
6. **Coastline does not match.** Not fixed, and the plan changed. The habitats
   WFS has no coastline layer, but the marine habitat polygons were digitised
   against the shore, so dissolving them yields a boundary that agrees with the
   habitat edges by construction. Emit it as `coverage.pmtiles` with the landward
   edge tagged apart from the offshore data limit; the first draws as coast, the
   second must fade or it reads as a wall in open sea.
7. **Dark blue no-data regions.** Partly handled: the background is now deep
   water matched to what the depth veil composites to at 90 m, so gaps read as
   sea. The hard edge where the survey stops still shows and needs the coverage
   layer above.
8. ~~Contour colours by band.~~ Done, and visible in `docs/shots/prod-sw.png`.

Never started: annotations and the feature card are both half-built on the wip
branch. The print path works end to end but has never had its PDF opened and
looked at by a human.

## Working notes

- `.audit/dive-map.tsv` is the decision trail. `column -s$'\t' -t` renders it.
- `pipeline/scripts/` is all idempotent. Rerunning does nothing.
- `data/raw/` holds about 1.2 GB of source data and is gitignored. The fetch
  scripts rebuild it.
- The tile archives are committed. 140 MB, largest file 75 MB, under GitHub's
  100 MB per-file limit. Range requests work on Pages, verified.
- Habitat class accuracy is 40% per class by the survey's own confusion matrix.
  Boundaries are drawn as a soft shadow rather than a line for that reason. Do
  not sharpen them.
