# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

SvelteKit with TypeScript at its strictest, MapLibre GL JS 6 for rendering, PMTiles for
vector tiles, Tailwind 4. Static output deployed to GitHub Pages at divemap.mauri.app,
so nothing may depend on a server at runtime. Confirmed by the user.

## Users

Recreational scuba divers and dive guides working the Catalan coast, from Cap de Creus
down to the Ebre delta. Two moments matter and they are different.

The first is at home or in the shop, planning. A guide or a diver opens the map on a
laptop, looks at a site, and decides where to take people. This is where annotations get
drawn and briefing cards get framed and printed.

The second is on a boat, five minutes before the dive. Somebody is holding a phone in
bright sun with wet hands, or holding a laminated A3 sheet on a spiral binding, and the
boat is moving. There is usually no mobile signal. The reader has thirty seconds and is
about to be underwater with no way to check anything.

## Product Purpose

Make a dive site legible before anyone gets in the water.

Two failures this exists to fix, named by the user from experience. Divers cannot picture
the site before they jump, because the briefing is verbal and the shape of the reef does
not survive being described out loud. And nobody knows where the good stuff is, meaning
which patch is Posidonia meadow, where the coralligenous wall starts, where the cave
mouth is.

Success is a diver who enters the water already holding a mental picture of the bottom:
which way it drops away, how deep it gets, what they will be swimming over, and where to
find the thing worth seeing.

## Positioning

Nautical charts are built for staying off the bottom. This is built for going to it.

The mechanism is public Catalan government survey data that no dive map currently uses.
ICGC publishes one-metre bathymetry and a one-metre isobath vector product for the whole
coast, and the Generalitat publishes the Mapa dels hàbitats marins, 50,436 classified
seafloor polygons covering every substrate and habitat in Catalan waters. Both are CC BY
4.0. Nothing else combines them, and nothing else renders the seabed as something you
read for texture and shape rather than for clearance depth.

Dive site geometry comes from OpenStreetMap, so corrections flow back to a commons rather
than into a private database. Editing the sites happens in OSM. The map consumes it.

## Operating Context

Boat diving on the Costa Brava and the Catalan coast generally. Sites are reached by boat,
tied to a mooring buoy, and briefed on deck before a giant stride entry.

The printed artefact is specific and it constrains the design. A3 sheets, laminated
against seawater, punched and held on a spiral binding, one sheet per site, carried on the
boat. A season's worth is a book. Sheets get reprinted when the data or the annotations
change, so framing a sheet has to be a saved thing that can be reproduced, not a
screenshot of whatever the screen happened to show.

Offline is not a degraded mode. It is the normal mode at the moment of use.

## Capabilities and Constraints

Confirmed functionality:

- Seabed rendered from ICGC bathymetry: isobaths with 5, 18, 30, 40 and 50 metres drawn
  heavier than the rest, because those are the depths that govern a recreational dive
  plan, plus relief shading so up and down read without reading numbers.
- Marine habitat and seafloor substrate polygons filled with tileable textures, so
  substrate is recognised by feel rather than by decoding a colour key.
- OSM overlay: dive sites, mooring buoys, wrecks, submerged rocks, restricted and swimming
  areas, lights, slipways, ladders, dive centres.
- User annotations drawn in the browser, stored as GeoJSON committed to the repository.
- A side panel controlling which layers show and how the isobaths are configured.
- Print framing by dragging the map under a crop overlay that shows exactly what lands on
  the sheet, then export to A3 PDF. Any area can be framed, including water with no dive
  site in it.

Constraints:

- Static hosting on GitHub Pages. No server, no database, no runtime tile service.
- Must work offline once an area has been visited or explicitly saved.
- Must work well on a phone held in one hand in direct sunlight.
- Layers stay vector wherever the data allows. Habitat textures are raster patterns
  clipped to vector polygons, which is the one place raster is unavoidable and correct.
- Textures ship at 256, 512, 1024 and 2048 pixels so a phone and a print run can each take
  what they need.
- Site editing is deliberately not in this app. It happens in OpenStreetMap.

Terminology: isobath, not contour line. Habitat is the biological community; substrate is
the ground it sits on; the map shows both as separate layers. Catalan place names are the
primary names.

## Brand Commitments

Full interface translation across Catalan, Spanish and English, with the reader choosing.
Catalan is the primary language of the place names because that is what the data carries
and what gets said on the boat.

Deployed at divemap.mauri.app. MIT licensed.

## Evidence on Hand

Real data already fetched and verified against the live services:

- `data/raw/isobaths-shelf.fgb`, 240,021 one-metre isobath segments, 0 to −80 m, whole
  Catalan coast, from ICGC's FlatGeobuf product.
- `data/raw/habitats.geojson`, 50,436 classified marine habitat polygons, whole coast,
  from the Generalitat WFS.
- `data/raw/osm-costabrava.json`, 1,617 OSM elements including 48 dive sites, 343 mooring
  buoys, 3 wrecks and 33 restricted areas.
- `static/textures/`, 21 seabed textures at four resolutions each, seams measured and
  repaired where they failed.
- ICGC bathymetric DEM, a 3.33 GB range-readable COG, not yet clipped.

Two facts about the data that the design must not paper over. The habitat specification
accepts 40% per-class accuracy by its own confusion matrix, and a polygon only has to be
75% pure, so a habitat boundary is an estimate and must not be drawn as a hard line. And
ICGC's bathymetry metadata states it may not be used for maritime navigation. The app
carried a not-for-navigation line on every screen and every printed sheet until the owner
asked for it to go, on the grounds that a diver reading a seabed map is not navigating a
vessel. The attribution stays, because the data licence requires it, and the print panel
still warns before it is switched off.

No testimonials, no usage numbers, no customers. Do not invent any.

## Product Principles

1. **The boat is the hard case.** Wet hands, bright sun, no signal, thirty seconds. A
   decision that helps the laptop and hurts the boat is the wrong decision.
2. **Show the shape of the bottom, not a table of numbers.** A diver should read depth and
   relief from the picture before reading a single label.
3. **Say what the data actually knows.** Habitat classes are estimates. Render them as
   estimates. Never let the map look more certain than the survey behind it.
4. **The printed sheet is a product, not an export.** It is framed on purpose, reproducible,
   and readable cold by someone who has never seen the site.
5. **Corrections belong in OpenStreetMap.** The map is a reader of a commons, not a private
   store of dive site truth.

## Accessibility & Inclusion

Sunlight legibility is the governing constraint, which means high contrast and large hit
targets rather than a subtle low-contrast interface. Touch targets sized for wet hands.
Habitat must never be encoded by colour alone, because the textures carry the meaning and
a colour-blind reader has to get the same information. Interface in three languages.
