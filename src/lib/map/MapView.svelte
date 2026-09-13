<script lang="ts">
	import {
		AttributionControl,
		type LayerSpecification,
		Map as MapLibre,
		Marker,
		NavigationControl,
		ScaleControl,
		type StyleSpecification,
		addProtocol,
		setWorkerUrl
	} from 'maplibre-gl';
	// MapLibre resolves its worker with a bare relative URL, which the bundler then
	// resolves against the importing chunk's directory. In the build that becomes
	// /_app/immutable/nodes/maplibre-gl-worker.mjs and 404s. The worker does all the
	// tile decoding and dies silently, so the map paints its background, loads
	// nothing, and reports no error. Handing Vite the URL is what makes it emit the
	// worker as an asset and hand back a path that actually exists.
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
	import { untrack } from 'svelte';
	import { Protocol } from 'pmtiles';
	import { publishMap } from './controls';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { installMarkerImages } from './marker-images';
	import {
		ISOBATH_LAYER_IDS,
		type LayerWriter,
		PALETTE,
		applyIsobathLayers,
		buildStyle,
		isobathLayersOf
	} from './style';
	import { type GraftedBaseMap, loadBaseMapStyle } from './basemap-style';
	import { WORLD_SOURCE_ID } from './land';
	import { failedSource } from './tile-errors';
	import {
		FLOURISH_TEXTURE,
		type LoadedTexture,
		loadFlourish,
		loadTextures,
		sizeForScreen,
		texturePalette
	} from './textures';
	import type { Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';
	import type { MapState } from '$lib/state/map-view.svelte';
	import { baseMapOf } from '$lib/domain/basemaps';
	import type { LngLat } from '$lib/domain/card';

	interface Props {
		view: MapState;
		centre: LngLat;
		zoom: number;
		/** Degrees clockwise from north, restored with the rest of the camera. */
		bearing?: number;
		/** Handed the live map once, so the print path can render from it. */
		onready?: (map: MapLibre) => void;
	}

	const { view, centre, zoom, bearing = 0, onready }: Props = $props();

	let map: MapLibre | undefined;
	/** The shell of the style the map is running, so a rebuild happens only when it moves. */
	let applied: string | undefined;
	/** The isobath layers as last pushed, which is the baseline the next push diffs against. */
	let pushed: readonly LayerSpecification[] | undefined;

	// MapLibre renders attribution as HTML, so these are real links rather than the
	// names of places you cannot get to.
	const ATTRIBUTION = [
		'<a href="https://www.icgc.cat/" target="_blank" rel="noopener">ICGC</a> batimetria i línia de costa, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>',
		'<a href="https://mediambient.gencat.cat/ca/05_ambits_dactuacio/patrimoni_natural/sistemes_dinformacio/habitats/habitats-marins/" target="_blank" rel="noopener">Hàbitats marins</a> © Generalitat de Catalunya, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>',
		'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
	].join(' · ');

	/** The strings MapLibre draws itself, under the ids it looks them up by. */
	const controlStrings = (locale: Locale): Record<string, string> => ({
		'Map.Title': t(locale, 'mapRegion'),
		'NavigationControl.ZoomIn': t(locale, 'zoomIn'),
		'NavigationControl.ZoomOut': t(locale, 'zoomOut'),
		'NavigationControl.ResetBearing': t(locale, 'resetNorth'),
		'AttributionControl.ToggleAttribution': t(locale, 'mapCredits')
	});

	/** MapLibre's own chrome, held so its labels can be made to follow the language. */
	let chrome:
		| { readonly attribution: AttributionControl; readonly navigation: NavigationControl }
		| undefined;

	/**
	 * MapLibre's own chrome, added in the order its corners expect.
	 *
	 * The attribution control is built here rather than by the map constructor for
	 * one reason: `relabel` needs to hold it. Bottom-right stacks in reverse, so
	 * attribution first is what keeps the scale bar to the left of the credits.
	 */
	const addChrome = (m: MapLibre): void => {
		const attribution = new AttributionControl({ customAttribution: ATTRIBUTION });
		const navigation = new NavigationControl({ visualizePitch: false });
		m.addControl(attribution, 'bottom-right');
		m.addControl(navigation, 'top-right');
		m.addControl(new ScaleControl({ maxWidth: 140, unit: 'metric' }), 'bottom-right');
		chrome = { attribution, navigation };
	};

	/**
	 * Say the map's own furniture again, in the language just chosen.
	 *
	 * Every string here is read once, when the thing that shows it is built, out of
	 * a table on the map that MapLibre offers no public way to replace. So the
	 * table is written and each control is asked to read its own title again.
	 * Removing and adding the controls instead would relabel them and reorder the
	 * corner: MapLibre appends at the top positions, so a rebuilt zoom stack lands
	 * under the locate button. A diver who switches language on the boat gets the
	 * new words and the same map.
	 */
	const relabel = (m: MapLibre, locale: Locale): void => {
		Object.assign(m._locale, controlStrings(locale));
		// The canvas label is read while MapLibre builds the container and never
		// again, and no control owns it, so it is written here.
		m.getCanvas().setAttribute('aria-label', t(locale, 'mapRegion'));
		if (chrome === undefined) return;
		const { attribution, navigation } = chrome;
		attribution._setElementTitle(attribution._compactButton, 'ToggleAttribution');
		navigation._setButtonTitle(navigation._zoomInButton, 'ZoomIn');
		navigation._setButtonTitle(navigation._zoomOutButton, 'ZoomOut');
		navigation._setButtonTitle(navigation._compass, 'ResetBearing');
	};

	/**
	 * The style with its isobath layers taken out.
	 *
	 * Everything a live push cannot express, and therefore the thing worth
	 * comparing. Derived from the built style rather than from a list of the
	 * inputs typed out again, so a new option cannot be added to the style and
	 * forgotten here.
	 */
	const shellOf = (built: StyleSpecification): string =>
		JSON.stringify({
			...built,
			layers: built.layers.filter((layer) => !ISOBATH_LAYER_IDS.includes(layer.id))
		});

	/**
	 * The archive's own vector style for the chosen base map, once it has arrived.
	 *
	 * One base map publishes one and the rest are raster, so this is usually
	 * undefined and the style builds without it. The raster of the same product is
	 * in the catalogue beside it, which is what draws while this is in flight and
	 * what keeps drawing if the fetch never lands.
	 */
	let grafted = $state<GraftedBaseMap | undefined>(undefined);

	$effect(() => {
		const chosen = view.baseMap;
		const borrowed = baseMapOf(chosen);
		if (borrowed?.style === undefined) {
			grafted = undefined;
			return;
		}
		void loadBaseMapStyle(borrowed).then((loaded) => {
			// The choice may have moved on while the style was in flight, and a graft
			// that draws over a base map nobody asked for is the credit-line bug one
			// layer out.
			if (untrack(() => view.baseMap) === chosen) grafted = loaded;
		});
	});

	const style = $derived(
		buildStyle({
			locale: view.locale,
			isobaths: view.isobaths,
			visible: [...view.visible],
			groundLayer: view.groundLayer,
			smoothed: view.smoothed,
			textures: view.textures,
			seabedPaint: view.seabedPaint,
			landPaint: view.landPaint,
			baseMap: view.baseMap,
			...(grafted === undefined ? {} : { graft: grafted }),
			worldPainted: view.worldPainted
		})
	);

	/**
	 * Patterns live in the image registry rather than a sprite sheet, so the print
	 * path can swap its own size in under the same ids.
	 *
	 * They are decoded once and kept. Every setStyle empties the registry, and the
	 * old one-shot latch meant the second time anyone touched a setting the
	 * patterns never came back and the whole seabed went flat. Re-adding only what
	 * is missing is cheap, cannot loop, and survives any number of style rebuilds.
	 */
	let patterns: readonly LoadedTexture[] = [];

	/**
	 * Names already fetched or being fetched. Claimed before the await so two quick
	 * choices cannot both decode the same texture, and released on failure so a
	 * texture lost to a dropped connection can be asked for again. Deliberately not
	 * reactive: it is a ledger the loader keeps, and an effect that read it would
	 * rerun itself on every texture it caused to load.
	 */
	const claimed: string[] = [];

	const restorePatterns = (m: MapLibre): void => {
		for (const { name, bitmap, pixelRatio } of patterns) {
			// The ratio comes from the texture, not from here. A constant 2 against a
			// file size that follows the device painted a 256 px repeat on a laptop
			// and a 512 px one on a 3x phone, and the legend swatch declares 256.
			if (!m.hasImage(name)) m.addImage(name, bitmap, { pixelRatio });
		}
		// Marker glyphs go the same way and for the same reason. They are drawn
		// rather than fetched, so they are ready before the first style finishes
		// loading and there is no window where the markers are missing.
		installMarkerImages(m);
	};

	/**
	 * Fetch and register the textures the style names that are not held yet.
	 *
	 * The picker offers every texture the build emits, which is more than a phone
	 * should decode and hold at once, so what arrives here is the palette the style
	 * actually paints with. A first call brings the catalogue's own set; choosing
	 * brings one more, and only the one.
	 */
	const loadPatterns = async (m: MapLibre, wanted: readonly string[]): Promise<void> => {
		const missing = wanted.filter((name) => !claimed.includes(name));
		if (missing.length === 0) return;
		claimed.push(...missing);
		try {
			const seabed = await loadTextures(
				missing,
				sizeForScreen(window.devicePixelRatio, window.matchMedia('(pointer: coarse)').matches)
			);
			patterns = [...patterns, ...seabed];
		} catch (failure) {
			for (const name of missing) claimed.splice(claimed.indexOf(name), 1);
			throw failure;
		}
		// A crest that will not load costs a decoration. It must never cost the seabed,
		// so it is appended rather than awaited alongside.
		if (!claimed.includes(FLOURISH_TEXTURE)) {
			claimed.push(FLOURISH_TEXTURE);
			const flourish = await loadFlourish(PALETTE.seaFlourish);
			if (flourish === undefined) claimed.splice(claimed.indexOf(FLOURISH_TEXTURE), 1);
			else patterns = [...patterns, flourish];
		}
		restorePatterns(m);
		m.triggerRepaint();
	};

	const mount = (container: HTMLElement) => {
		setWorkerUrl(workerUrl);
		addProtocol('pmtiles', new Protocol().tile);

		// An attachment is an effect, so reading the derived style here would make
		// every layer toggle tear the map down and build a new one: tiles refetched,
		// patterns re-decoded, and the camera thrown back to the start position in
		// the middle of a dive briefing. The style updates below through setStyle,
		// which is the whole point of keeping `applied`.
		const first = untrack(() => style);

		const m = new MapLibre({
			container,
			style: first,
			center: [centre.lng, centre.lat],
			zoom,
			bearing,
			maxPitch: 0,
			canvasContextAttributes: { preserveDrawingBuffer: true },
			locale: controlStrings(untrack(() => view.locale)),
			// Added below instead, with the rest of MapLibre's own chrome, so a
			// language chosen mid-dive can rebuild all of it together.
			attributionControl: false
		});

		addChrome(m);
		// Not inside 'load'. Offline is the normal mode on a boat, and a load that
		// never fires would leave every one of our controls unmounted while
		// MapLibre's own zoom buttons sat there looking fine.
		publishMap(m);

		const syncCamera = () => {
			const c = m.getCenter();
			view.centre = { lng: c.lng, lat: c.lat };
			view.zoom = m.getZoom();
			view.bearing = m.getBearing();
		};
		m.on('move', syncCamera);
		syncCamera();

		restorePatterns(m);
		m.on('styledata', () => {
			restorePatterns(m);
		});
		void loadPatterns(m, texturePalette(untrack(() => view.textures)));
		/**
		 * The one thing that covers the DEM's lit nodata plane is the land, and on a
		 * cold load a 487 KB archive loses the race to a 33 MB one. So the hillshade
		 * waits here rather than in the DEM. See the layer's own comment in style.ts.
		 *
		 * `idle` is the release valve, not a second signal: a `world` source that
		 * errors or is missing would otherwise hold the hillshade back forever, and
		 * by the time the map is idle the flash window is over either way.
		 */
		const paintHillshade = () => {
			view.worldPainted = true;
		};
		m.on('sourcedata', (e) => {
			if (e.sourceId === WORLD_SOURCE_ID && e.isSourceLoaded) paintHillshade();
		});
		m.once('idle', paintHillshade);

		/**
		 * Say when the patch on screen is still coming, and stop saying it the moment
		 * it arrives.
		 *
		 * `areTilesLoaded` is true only when every source has every tile the current
		 * viewport covers, which is the diver's question exactly: pan somewhere and
		 * either the seabed is missing because nobody surveyed it or because it is
		 * still in flight. Nothing is counted here, so nothing can drift out of step
		 * with what the map actually holds.
		 *
		 * The wait before announcing is what stops it lying the other way. A pan
		 * across cached water settles in a frame or two, and a badge that blinks on
		 * every drag is noise a diver learns to look past. It clears the instant the
		 * tiles land, whether or not the wait had run out.
		 */
		const PATIENCE_MS = 500;
		let patience: ReturnType<typeof setTimeout> | undefined;
		const readTiles = (): void => {
			if (m.areTilesLoaded()) {
				clearTimeout(patience);
				patience = undefined;
				view.tilesLoading = false;
				return;
			}
			if (patience !== undefined || view.tilesLoading) return;
			patience = setTimeout(() => {
				patience = undefined;
				// Asked again rather than assumed. Half a second is long enough for the
				// last tile to have landed without another event since.
				view.tilesLoading = !m.areTilesLoaded();
			}, PATIENCE_MS);
		};
		m.on('dataloading', readTiles);
		m.on('sourcedata', readTiles);
		m.on('moveend', readTiles);
		m.on('idle', readTiles);

		m.on('load', () => {
			view.ready = true;
			onready?.(m);
		});
		m.on('error', (e) => {
			// A failure that names a source is a gap in the data, not a broken app. The
			// ortophoto was the loud case, once per tile on a boat, but an archive that
			// will not fetch offline is the same argument and a stronger one: the map
			// draws what the caches held, which is what the diver is looking at, and
			// three of the archives that fail on an offline reload back layers no
			// control can even reach. The banner is for a style that will not parse,
			// which names no source and is the one failure that means nothing is coming.
			if (failedSource(e) !== undefined) return;
			view.error = e.error.message;
		});

		if (import.meta.env.DEV) Reflect.set(window, 'diveMap', m);

		applied = shellOf(first);
		pushed = isobathLayersOf(first);
		map = m;
		return () => {
			clearTimeout(patience);
			publishMap(undefined);
			chrome = undefined;
			pin?.remove();
			pin = undefined;
			m.remove();
			map = undefined;
		};
	};

	/**
	 * A texture a diver has just chosen was never fetched at startup, so it has to
	 * arrive before the style that names it can paint anything. Until it does the
	 * fill draws nothing and the class keeps whatever the last frame had, which
	 * reads as the choice having been ignored.
	 */
	$effect(() => {
		const wanted = texturePalette(view.textures);
		const m = map;
		if (m !== undefined) void loadPatterns(m, wanted);
	});

	$effect(() => {
		const locale = view.locale;
		if (map !== undefined) relabel(map, locale);
	});

	/**
	 * The point the card is describing, marked on the map.
	 *
	 * A card headed "the bottom here" names a depth and a pair of coordinates and
	 * nothing on screen says which pixel they came from, which on open sand is
	 * every pixel for a hundred metres.
	 *
	 * It is a marker rather than a style layer because the selection is not one of
	 * the options the style is built from, and threading it through would rebuild
	 * the style on every tap. A marker is a DOM overlay, so it also stays put
	 * across the setStyle a layer toggle runs, and stays off the printed sheet,
	 * where a pin from someone's last tap would be an error.
	 */
	let pin: Marker | undefined;

	const pinElement = (): HTMLElement => {
		const element = document.createElement('div');
		element.className = 'pick-pin';
		element.ariaHidden = 'true';
		return element;
	};

	$effect(() => {
		const at = view.selection?.position;
		if (at === undefined) {
			pin?.remove();
			pin = undefined;
			return;
		}
		if (map === undefined) return;
		// The position goes on before the map does. MapLibre draws the marker as
		// part of adding it, and a marker with nowhere to be throws in that draw.
		if (pin === undefined) {
			pin = new Marker({ element: pinElement() }).setLngLat([at.lng, at.lat]).addTo(map);
		} else {
			pin.setLngLat([at.lng, at.lat]);
		}
	});

	const writer = (m: MapLibre): LayerWriter => ({
		filter: (id, filter) => {
			m.setFilter(id, filter);
		},
		paint: (id, property, value) => {
			m.setPaintProperty(id, property, value);
		},
		layout: (id, property, value) => {
			m.setLayoutProperty(id, property, value);
		}
	});

	/**
	 * The map is constructed with the first style already. Pushing it again here
	 * arrives before the style has finished loading, which makes MapLibre discard
	 * the in-flight load and rebuild from scratch, and `load` never fires.
	 *
	 * An isobath setting never adds or removes a layer, so it goes straight at the
	 * three layers it owns instead of through a style MapLibre has to diff.
	 * Measured over Tamariu at z15.2, a slider dragged through a rebuild a frame
	 * held a 100 ms frame gap, a fifth of which was the diff and the rest the tiles
	 * it invalidated; the same drag pushed at the layers holds 17 ms. A style with
	 * no `isobath` layer in it is a diff MapLibre gave up on and replaced whole, so
	 * that falls back to a rebuild rather than writing into a layer that is gone.
	 */
	$effect(() => {
		const built = style;
		const shell = shellOf(built);
		const m = map;
		if (m === undefined) return;
		if (shell !== applied || m.getLayer('isobath') === undefined) {
			applied = shell;
			pushed = isobathLayersOf(built);
			// setStyle diffs, so toggling a layer does not tear down the loaded tiles.
			m.setStyle(built, { diff: true });
			return;
		}
		pushed = applyIsobathLayers(writer(m), built, pushed);
	});
</script>

<div class="map" {@attach mount}></div>

<style>
	.map {
		position: absolute;
		inset: 0;
		background: var(--color-table-900);
	}

	/* Global because MapLibre owns the node, so Svelte never stamps it. */
	:global(.pick-pin) {
		width: 1.15rem;
		height: 1.15rem;
		border-radius: 50%;
		border: 2px solid var(--color-brass-300);
		background: radial-gradient(circle, var(--color-brass-300) 0 2px, transparent 2px);
		box-shadow:
			0 0 0 1px rgb(0 0 0 / 0.55),
			0 1px 3px rgb(0 0 0 / 0.5);
	}
</style>
