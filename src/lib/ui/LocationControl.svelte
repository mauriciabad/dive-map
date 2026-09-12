<script lang="ts">
	import { untrack } from 'svelte';
	import { GeoJSONSource, type Map as MapLibre } from 'maplibre-gl';
	import LocationButton from '$lib/geo/LocationButton.svelte';
	import LocationPanel from '$lib/geo/LocationPanel.svelte';
	import { AVATARS, AVATAR_PIXEL_RATIO } from '$lib/geo/avatars';
	import { avatarUrl } from '$lib/geo/avatar-assets';
	import { type MapFrame, buildFrame } from '$lib/geo/frame';
	import { PositionTracker } from '$lib/geo/position.svelte';
	import { SvelteControl, whenMapReady } from '$lib/map/controls';
	import type { MapState } from '$lib/state/map-view.svelte';

	/**
	 * Where the boat is, drawn on the map and driven from the corner stack.
	 *
	 * The button and the panel both go through `SvelteControl` into the top-right
	 * corner, under MapLibre's own zoom group, so the whole thing takes the corner
	 * layout that already clears the notch and stays inside the viewport.
	 *
	 * The three style layers are always present and always visible. Nothing here
	 * touches the style: switching tracking off empties the sources instead, which
	 * means no style rebuild, no interaction with the layer panel, and no way for
	 * a half-applied style diff to leave a stale boat on the map.
	 */

	interface Props {
		readonly view: MapState;
		/** Supplied only by the verification harness, which drives it from outside. */
		readonly tracker?: PositionTracker;
	}

	const { view, tracker: supplied }: Props = $props();

	// Read once on purpose. The tracker owns a live geolocation watch, so swapping
	// it mid-flight would leak the old one; the prop exists to inject, not to rebind.
	const tracker = untrack(() => supplied) ?? new PositionTracker();
	const childProps = {
		tracker,
		get locale() {
			return view.locale;
		}
	};

	let map = $state.raw<MapLibre | undefined>(undefined);
	let installing = false;
	let handledRecentre = 0;
	let latest: MapFrame | undefined;

	const frame = $derived(
		buildFrame({
			fix: tracker.fix,
			stale: tracker.stale,
			course: tracker.course,
			avatar: tracker.avatar,
			trail: tracker.trail,
			window: tracker.window,
			showTrail: tracker.showTrail,
			showTrajectory: tracker.showTrajectory
		})
	);

	const push = (m: MapLibre, next: MapFrame): void => {
		const position = m.getSource('position');
		const trail = m.getSource('trail');
		if (!(position instanceof GeoJSONSource) || !(trail instanceof GeoJSONSource)) return;
		void position.setData(next.position);
		void trail.setData(next.trail);
		// Age-mapped stops, so they change with every update. Guarded because a
		// style rebuild can land between the source existing and the layer existing.
		if (next.gradient !== undefined && m.getLayer('trail-line') !== undefined) {
			m.setPaintProperty('trail-line', 'line-gradient', next.gradient);
		}
	};

	/**
	 * setStyle clears the image registry, exactly as it does for the seabed
	 * patterns, so this runs again on every styledata and re-checks rather than
	 * trusting a flag. The flag only stops the concurrent storm while one pass is
	 * still awaiting its fetches.
	 */
	const installAvatars = async (m: MapLibre): Promise<void> => {
		if (installing) return;
		installing = true;
		try {
			for (const { id } of AVATARS) {
				if (m.hasImage(id)) continue;
				const response = await fetch(avatarUrl(id));
				const bitmap = await createImageBitmap(await response.blob());
				if (!m.hasImage(id)) m.addImage(id, bitmap, { pixelRatio: AVATAR_PIXEL_RATIO });
			}
		} finally {
			installing = false;
		}
	};

	/**
	 * One attachment for the whole map side: the button, the avatar images and the
	 * re-push after a style rebuild. `whenMapReady` exists because this component
	 * mounts before the map does, and it hands back the detach an `$effect` wants.
	 */
	$effect(() =>
		whenMapReady((m) => {
			const button = new SvelteControl(LocationButton, {
				props: childProps,
				className: 'maplibregl-ctrl maplibregl-ctrl-group'
			});
			m.addControl(button, 'top-right');
			const onStyle = (): void => {
				void installAvatars(m);
				if (latest !== undefined) push(m, latest);
			};
			m.on('styledata', onStyle);
			void installAvatars(m);
			map = m;
			return () => {
				m.off('styledata', onStyle);
				m.removeControl(button);
				map = undefined;
			};
		})
	);

	$effect(() => {
		latest = frame;
		if (map !== undefined) push(map, frame);
	});

	$effect(() => {
		const seq = tracker.recentreSeq;
		const fix = tracker.fix;
		if (map === undefined || fix === undefined || seq === handledRecentre) return;
		handledRecentre = seq;
		map.easeTo({ center: [fix.lng, fix.lat], zoom: Math.max(map.getZoom(), 15), duration: 900 });
	});

	$effect(() => {
		if (!tracker.panelOpen) return;
		return whenMapReady((m) => {
			const control = new SvelteControl(LocationPanel, {
				props: childProps,
				className: 'maplibregl-ctrl dive-ctrl-panel'
			});
			m.addControl(control, 'top-right');
			return () => {
				m.removeControl(control);
			};
		});
	});

	$effect(() => () => {
		tracker.dispose();
	});
</script>

<svelte:window
	onkeydown={(e: KeyboardEvent) => {
		if (e.key === 'Escape') tracker.panelOpen = false;
	}}
/>
