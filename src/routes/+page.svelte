<script lang="ts">
	import MapView from '$lib/map/MapView.svelte';
	import ControlRail from '$lib/ui/ControlRail.svelte';
	import FirstRun from '$lib/ui/FirstRun.svelte';
	import LocationControl from '$lib/ui/LocationControl.svelte';
	import CropOverlay from '$lib/ui/CropOverlay.svelte';
	import FeatureCard from '$lib/ui/FeatureCard.svelte';
	import { GROUND_PICK_LAYERS, OSM_PICK_LAYERS, pickFrom } from '$lib/ui/feature-card';
	import { whenMapReady } from '$lib/map/controls';
	import type { LngLat, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
	import { MapState } from '$lib/state/map-view.svelte';
	import { Configurations } from '$lib/state/configurations.svelte';
	import { POSITION_ZOOM, SURVEY_CENTRE, grantedFix, nearSurvey } from '$lib/state/opening';
	import { negotiate } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';

	const view = new MapState(navigator.languages);

	/*
	 * What this tab opens with, decided before the map is built: its own working
	 * configuration if it has one, else the saved configuration set as the
	 * default, else the shipped defaults.
	 */
	const configurations = new Configurations(negotiate(navigator.languages));
	const opening = configurations.opening();
	view.apply(opening.configuration);

	/**
	 * Somewhere over the region while the guard works out the real answer, which it
	 * can only do once it knows the size of the screen. The camera is snapped to
	 * `getMinZoom` below the moment the map exists, so this number decides nothing
	 * except which tiles get asked for first. Zero would be worse than a guess:
	 * MapLibre refuses to show the world smaller than the viewport and throws the
	 * centre to the equator to make it fit.
	 */
	const BEFORE_THE_GUARD_ANSWERS = 7;

	const start =
		opening.start.kind === 'survey'
			? { centre: SURVEY_CENTRE, zoom: BEFORE_THE_GUARD_ANSWERS, bearing: 0 }
			: opening.start.camera;

	/*
	 * Where the map settled once everything allowed to move it has had its say.
	 * Undefined while a fix might still arrive, which is what keeps the opening
	 * hints from flashing up over a map that is about to jump to the diver.
	 */
	let settled = $state.raw<'survey' | 'elsewhere' | undefined>(
		opening.start.kind === 'tab' ? 'elsewhere' : undefined
	);
	let dismissed = $state(false);
	const taught = configurations.introSeen;
	const hinting = $derived(settled === 'survey' && !taught && !dismissed && view.ready);

	/*
	 * The working configuration trails the map instead of following it. A camera
	 * sync runs on every frame of a pan, and a write per frame is a write per
	 * frame; 400 ms after the last change is still well inside a reload, and
	 * pagehide covers the reload that beats the timer.
	 */
	$effect(() => {
		const working = {
			configuration: view.configuration,
			camera: view.camera,
			from: configurations.from
		};
		const pending = setTimeout(() => {
			configurations.remember(working);
		}, 400);
		const flush = (): void => {
			clearTimeout(pending);
			configurations.remember(working);
		};
		window.addEventListener('pagehide', flush);
		return () => {
			clearTimeout(pending);
			window.removeEventListener('pagehide', flush);
		};
	});

	/*
	 * A tab that did not come back to its own water opens on the diver instead,
	 * when the browser already knows where they are and they are near this coast.
	 * Nothing here asks for anything: the permission is read before the fix is
	 * requested, so a first visit is never met with a prompt.
	 *
	 * A hand on the map outranks it. Somebody already dragging has said where they
	 * want to be, and being thrown somewhere else mid-gesture is the worst thing a
	 * map can do.
	 */
	$effect(() =>
		whenMapReady((map) => {
			if (opening.start.kind === 'tab') return;
			/*
			 * As far out as the map goes, which is the whole survey fitted to this
			 * screen. `constrainToData` does that arithmetic already and publishes the
			 * answer as the minimum zoom, so reading it back beats keeping a second
			 * copy of it here that would be right on a laptop and wrong on a phone.
			 */
			if (opening.start.kind === 'survey') {
				map.jumpTo({ center: [SURVEY_CENTRE.lng, SURVEY_CENTRE.lat], zoom: map.getMinZoom() });
			}
			const canvas = map.getCanvasContainer();
			let touched = false;
			const stop = (): void => {
				touched = true;
			};
			canvas.addEventListener('pointerdown', stop, { passive: true });
			canvas.addEventListener('wheel', stop, { passive: true });
			void grantedFix(navigator).then((fix) => {
				if (fix !== undefined && !touched && nearSurvey(fix)) {
					map.jumpTo({
						center: [fix.lng, fix.lat],
						zoom: Math.max(map.getZoom(), POSITION_ZOOM)
					});
					settled = 'elsewhere';
					return;
				}
				settled = opening.start.kind === 'survey' ? 'survey' : 'elsewhere';
			});
			return () => {
				canvas.removeEventListener('pointerdown', stop);
				canvas.removeEventListener('wheel', stop);
			};
		})
	);

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
	<MapView {view} centre={start.centre} zoom={start.zoom} bearing={start.bearing} />

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
			<button
				type="button"
				onclick={() => {
					location.reload();
				}}>{t(view.locale, 'retry')}</button
			>
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

	<ControlRail {view} {configurations} />
	<LocationControl {view} />

	<!-- Last, so the locate button it points at is already in MapLibre's corner. -->
	{#if hinting}
		<FirstRun
			locale={view.locale}
			ondone={() => {
				dismissed = true;
				configurations.markIntroSeen();
			}}
		/>
	{/if}
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
