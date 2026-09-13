<script lang="ts">
	import {
		Map as MapLibre,
		NavigationControl,
		ScaleControl,
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
	import { Protocol } from 'pmtiles';
	import { publishMap } from './controls';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { buildStyle } from './style';
	import { type LoadedTexture, loadTextures, sizeForScreen, texturePalette } from './textures';
	import type { MapState } from '$lib/state/map-view.svelte';
	import type { LngLat } from '$lib/domain/card';

	interface Props {
		view: MapState;
		centre: LngLat;
		zoom: number;
		/** Handed the live map once, so the print path can render from it. */
		onready?: (map: MapLibre) => void;
	}

	const { view, centre, zoom, onready }: Props = $props();

	let map: MapLibre | undefined;
	let applied: unknown;

	const style = $derived(
		buildStyle({
			locale: view.locale,
			isobaths: view.isobaths,
			visible: [...view.visible],
			groundLayer: view.groundLayer,
			smoothed: view.smoothed
		})
	);

	/**
	 * Patterns live in the image registry rather than a sprite sheet, so the print
	 * path can swap the 2048px set in under the same ids.
	 *
	 * They are decoded once and kept. Every setStyle empties the registry, and the
	 * old one-shot latch meant the second time anyone touched a setting the
	 * patterns never came back and the whole seabed went flat. Re-adding only what
	 * is missing is cheap, cannot loop, and survives any number of style rebuilds.
	 */
	let patterns: readonly LoadedTexture[] = [];

	const restorePatterns = (m: MapLibre): void => {
		for (const { name, bitmap, pixelRatio } of patterns) {
			// The ratio comes from the texture, not from here. A constant 2 against a
			// file size that follows the device painted a 256 px repeat on a laptop
			// and a 512 px one on a 3x phone, and the legend swatch declares 256.
			if (!m.hasImage(name)) m.addImage(name, bitmap, { pixelRatio });
		}
	};

	const loadPatterns = async (m: MapLibre): Promise<void> => {
		if (patterns.length > 0) return;
		patterns = await loadTextures(
			texturePalette(),
			sizeForScreen(window.devicePixelRatio, window.matchMedia('(pointer: coarse)').matches)
		);
		restorePatterns(m);
		m.triggerRepaint();
	};

	const mount = (container: HTMLElement) => {
		setWorkerUrl(workerUrl);
		addProtocol('pmtiles', new Protocol().tile);

		const m = new MapLibre({
			container,
			style,
			center: [centre.lng, centre.lat],
			zoom,
			maxPitch: 0,
			canvasContextAttributes: { preserveDrawingBuffer: true },
			attributionControl: {
				// MapLibre renders attribution as HTML, so these are real links rather
				// than the names of places you cannot get to.
				customAttribution: [
					'<a href="https://www.icgc.cat/" target="_blank" rel="noopener">ICGC</a> batimetria i línia de costa, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>',
					'<a href="https://mediambient.gencat.cat/ca/05_ambits_dactuacio/patrimoni_natural/sistemes_dinformacio/habitats/habitats-marins/" target="_blank" rel="noopener">Hàbitats marins</a> © Generalitat de Catalunya, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>',
					'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
				].join(' · ')
			}
		});

		m.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
		m.addControl(new ScaleControl({ maxWidth: 140, unit: 'metric' }), 'bottom-right');
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

		m.on('styledata', () => {
			restorePatterns(m);
		});
		void loadPatterns(m);
		m.on('load', () => {
			view.ready = true;
			onready?.(m);
		});
		m.on('error', (e) => {
			view.error = e.error.message;
		});

		if (import.meta.env.DEV) Reflect.set(window, 'diveMap', m);

		applied = style;
		map = m;
		return () => {
			publishMap(undefined);
			m.remove();
			map = undefined;
		};
	};

	$effect(() => {
		// The map is constructed with the first style already. Pushing it again here
		// arrives before the style has finished loading, which makes MapLibre discard
		// the in-flight load and rebuild from scratch, and `load` never fires.
		if (map === undefined || style === applied) return;
		applied = style;
		// setStyle diffs, so toggling a layer does not tear down the loaded tiles.
		map.setStyle(style, { diff: true });
	});
</script>

<div class="map" {@attach mount}></div>

<style>
	.map {
		position: absolute;
		inset: 0;
		background: var(--color-table-900);
	}
</style>
