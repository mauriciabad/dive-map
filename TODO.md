# Outstanding work

The user's requests, kept verbatim where the wording matters. Nothing here is
done until it is ticked and verified in a browser.

## In flight (3 agents max, running now)

- [ ] **Habitat smoothing, stronger.** The first pass came out a rounded staircase, not
      blobs. Max boundary displacement 0.88 m against a source quantised at 8–11 m;
      you cannot remove a 10 m staircase with under a metre of travel. Needs a
      strength setting with a much higher default, every existing invariant kept
      (bit-identical shared edges, zero gaps, MMU survivors unchanged).
- [ ] **Print rework.** Paper size and orientation from a list, custom size in mm,
      custom size in px, configurable zoom. No dark border: map full bleed to the
      page edge, furniture gets its own padding. PNG export as well as PDF. Show or
      hide each element and an all-at-once control. User picks the name on the map.
      Delete the "Drag the map. The box is what gets printed." box. Framing follows
      the panel being open, not a separate toggle. The dark backdrop darkens only
      the map layer, not the interface.
- [ ] **Live position.** Button in the right-hand controls. Real-time updates. Trail
      of where you came from, on by default at 10 minutes with no distance limit,
      panel to choose minutes or distance, polyline as a gradient fading out at the
      old end. Current trajectory line (course over ground, NOT phone orientation),
      on by default, configurable. Avatars instead of a circle: pirate boat by
      default, plus a turtle, a top-down ship, and others.

## Queued

- [ ] **PWA.** No favicon and no maskable icon today. Manifest, icon set, installable.
- [ ] **Saved configurations.** Preferences in localStorage with a reset-to-defaults
      button. Multiple named configs, one picked as default for a new tab. Different
      tabs hold different configs at the same time without interfering. Saving to
      localStorage is manual; sessionStorage keeps the working config across a reload.
- [ ] **OSM labels follow the chosen language.**
- [ ] **Bug: changing several options breaks it.** Named case: "Bottom: Habitats,
      Seafloor type" does not work.
- [ ] **Attribution.** Make it links. The collapse control shows an `i` and is not
      visible enough; it should be an x or similar, if MapLibre allows it.

## Standing instructions

- Deploy directly. The user will ask for changes if they dislike something.
- At most three agents at once, sequential where possible.
- Check on agents periodically; they get stuck on irrelevant things and waste time.
- `pnpm run check` passing is not proof it builds. Run `pnpm run build` too.
- Verify in a real browser. A flat blue rectangle and a rendered seabed look the
  same to every other kind of check.
