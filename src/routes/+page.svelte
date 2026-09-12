<script lang="ts">
	import MapView from '$lib/map/MapView.svelte';
	import ControlRail from '$lib/ui/ControlRail.svelte';
	import LocationControl from '$lib/ui/LocationControl.svelte';
	import CropOverlay from '$lib/ui/CropOverlay.svelte';
	import FeatureCard from '$lib/ui/FeatureCard.svelte';
	import { GROUND_PICK_LAYERS, OSM_PICK_LAYERS, pickFrom } from '$lib/ui/feature-card';
	import { whenMapReady } from '$lib/map/controls';
	import type { LngLat, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
	import { MapState } from '$lib/state/map-view.svelte';
	import { t } from '$lib/i18n/messages';

	/** Begur and Tamariu, the water this was built for. */
	const START = { lng: 3.2165, lat: 41.9275 };
	const START_ZOOM = 13.4;

	const view = new MapState(navigator.languages);

	/** Wet fingers need slack; the seabed needs more, so a site on a habitat
	 *  boundary names both sides rather than whichever pixel was under the thumb. */
	const box = (x: number, y: number, r: number): [[number, number], [number, number]] => [
		[x - r, y - r],
		[x + r, y + r]
	];

	$effect(() =>
		whenMapReady((map) => {
			const inspect = (point: { x: number; y: number }, at: LngLat) => {
				const osm = map.queryRenderedFeatures(box(point.x, point.y, 10), {
					layers: [...OSM_PICK_LAYERS]
				});
				const ground = map.queryRenderedFeatures(box(point.x, point.y, 24), {
					layers: [...GROUND_PICK_LAYERS]
				});
				view.select(
					pickFrom(
						osm.map((f) => f.properties),
						ground.map((f) => f.properties),
						{ lng: at.lng, lat: at.lat }
					)
				);
			};

			/*
			 * A tap cannot open the panel, because double-tap-and-drag is how you
			 * zoom one-handed and a tap handler eats the first half of it. Touch gets
			 * a long press; a mouse keeps its click.
			 */
			let held: ReturnType<typeof setTimeout> | undefined;
			const cancel = () => {
				if (held !== undefined) clearTimeout(held);
				held = undefined;
			};

			const onclick = (e: MapMouseEvent) => {
				if (e.originalEvent.detail === 0) return;
				inspect(e.point, e.lngLat);
			};
			const ontouchstart = (e: MapTouchEvent) => {
				cancel();
				if (e.points.length !== 1) return;
				const point = e.point;
				const at = e.lngLat;
				held = setTimeout(() => {
					held = undefined;
					inspect(point, at);
				}, 450);
			};

			map.on('click', onclick);
			map.on('touchstart', ontouchstart);
			map.on('touchend', cancel);
			map.on('touchcancel', cancel);
			map.on('touchmove', cancel);
			map.on('movestart', cancel);
			return () => {
				cancel();
				map.off('click', onclick);
				map.off('touchstart', ontouchstart);
				map.off('touchend', cancel);
				map.off('touchcancel', cancel);
				map.off('touchmove', cancel);
				map.off('movestart', cancel);
			};
		})
	);
</script>

<svelte:head>
	<title>{t(view.locale, 'appName')}</title>
	<meta name="description" content={t(view.locale, 'disclaimer')} />
	<meta name="theme-color" content="#14100c" />
</svelte:head>

<main>
	<MapView {view} centre={START} zoom={START_ZOOM} />

	{#if !view.ready}
		<div class="booting" role="status">
			<span class="sounding" aria-hidden="true"></span>
			{t(view.locale, 'loading')}
		</div>
	{/if}

	{#if view.error !== undefined}
		<div class="failure" role="alert">
			<strong>{t(view.locale, 'errorTitle')}</strong>
			<span>{view.error}</span>
			<button type="button" onclick={() => { location.reload(); }}>{t(view.locale, 'retry')}</button>
		</div>
	{/if}

	{#if view.panelOpen === 'print'}
		<CropOverlay print={view.print} live={view.live} zoom={view.zoom} />
	{/if}

	<FeatureCard
		pick={view.selection}
		locale={view.locale}
		onclose={() => {
			view.select(undefined);
		}}
	/>

	<ControlRail {view} />
	<LocationControl {view} />
</main>

<style>
	main {
		position: fixed;
		inset: 0;
		overflow: hidden;
	}

	/* A sounding line dropping while the seabed loads, rather than a spinner. */
	.booting {
		position: absolute;
		z-index: 10;
		inset: auto 0 auto 0;
		top: 50%;
		translate: 0 -50%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.9rem;
		color: var(--color-paper-dim);
		font-size: 0.85rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		pointer-events: none;
	}

	.sounding {
		width: 1px;
		height: 3.5rem;
		background: linear-gradient(180deg, transparent, var(--color-brass-400));
		position: relative;
	}

	.sounding::after {
		content: '';
		position: absolute;
		bottom: 0;
		left: 50%;
		width: 0.5rem;
		height: 0.5rem;
		translate: -50% 50%;
		rotate: 45deg;
		background: var(--color-brass-400);
		animation: drop 1.8s cubic-bezier(0.4, 0, 0.5, 1) infinite;
	}

	@keyframes drop {
		0% {
			bottom: 100%;
			opacity: 0;
		}
		25% {
			opacity: 1;
		}
		100% {
			bottom: 0;
			opacity: 0.25;
		}
	}

	.failure {
		position: absolute;
		z-index: 30;
		/* Centred with both corner stacks left clear. A banner that hides the layer
		   buttons takes the controls away exactly when something has gone wrong. */
		inset: calc(var(--ctrl-gap) + env(safe-area-inset-top)) auto auto 50%;
		translate: -50% 0;
		width: max-content;
		max-width: min(34rem, calc(100vw - 2 * (var(--ctrl-gap) * 2 + var(--ctrl-size))));
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
		background: var(--color-table-800);
		border: 1px solid var(--color-hazard);
		border-radius: var(--radius-rail);
		box-shadow: var(--rail-shadow);
		font-size: 0.85rem;
	}

	.failure span {
		flex: 1;
		color: var(--color-paper-dim);
	}

	.failure button {
		min-height: var(--spacing-touch);
		padding: 0 1rem;
		border: 0;
		border-radius: 0.35rem;
		background: var(--color-brass-500);
		color: var(--color-table-900);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.failure button:hover {
		background: var(--color-brass-400);
	}
</style>
