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
	import { loadTextures, sizeForScreen, texturePalette } from './textures';
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
	let texturesInstalled = false;

	const style = $derived(
		buildStyle({
			isobaths: view.isobaths,
			visible: [...view.visible],
			groundLayer: view.groundLayer
		})
	);

	/**
	 * Patterns live in the image registry, not a sprite sheet, so the print path
	 * can swap the 2048 set in under the same ids without rebuilding a sprite.
	 * setStyle clears the registry, so this runs again on every styledata.
	 */
	const installTextures = async (m: MapLibre): Promise<void> => {
		// addImage mutates the style, which fires styledata again. Without this the
		// install loops forever and isStyleLoaded() never becomes true.
		if (texturesInstalled) return;
		texturesInstalled = true;
		const size = sizeForScreen(
			window.devicePixelRatio,
			window.matchMedia('(pointer: coarse)').matches
		);
		const loaded = await loadTextures(texturePalette(), size);
		for (const { name, bitmap } of loaded) {
			if (m.hasImage(name)) m.updateImage(name, bitmap);
			else m.addImage(name, bitmap, { pixelRatio: 2 });
		}
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
				customAttribution:
					'Batimetria i línia de costa © ICGC, CC BY 4.0 · Hàbitats marins © Generalitat de Catalunya, CC BY 4.0 · © OpenStreetMap contributors'
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

		m.on('styledata', () => void installTextures(m));
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
		// setStyle clears the image registry, so the patterns have to go back in.
		texturesInstalled = false;
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
