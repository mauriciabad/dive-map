<script lang="ts">
	import MapView from '$lib/map/MapView.svelte';
	import ControlRail from '$lib/ui/ControlRail.svelte';
	import FirstRun from '$lib/ui/FirstRun.svelte';
	import LocationControl from '$lib/ui/LocationControl.svelte';
	import BaseMapToggle from '$lib/ui/BaseMapToggle.svelte';
	import CropOverlay from '$lib/ui/CropOverlay.svelte';
	import FeatureCard from '$lib/ui/FeatureCard.svelte';
	import { GROUND_PICK_LAYERS, OSM_PICK_LAYERS, pickFrom } from '$lib/ui/feature-card';
	import { whenMapReady } from '$lib/map/controls';
	import { depthAt } from '$lib/map/depth';
	import { watchArchives } from '$lib/map/tile-errors';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Map as MapLibre, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
	import { MapState } from '$lib/state/map-view.svelte';
	import { Configurations } from '$lib/state/configurations.svelte';
	import { findExtent, formatAddress, parseAddress } from '$lib/state/address';
	import type { OsmRef } from '$lib/domain/osm';
	import type { Start } from '$lib/state/configuration';
	import { POSITION_ZOOM, SURVEY_CENTRE, grantedFix, nearSurvey } from '$lib/state/opening';
	import { negotiate } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';
	import { updates } from '$lib/offline/updates.svelte';

	const view = new MapState(navigator.languages);

	/*
	 * What this tab opens with, decided before the map is built: its own working
	 * configuration if it has one, else the saved configuration set as the
	 * default, else the shipped defaults.
	 */
	const configurations = new Configurations(negotiate(navigator.languages));
	const opening = configurations.opening();
	view.apply(opening.configuration);

	/*
	 * A link outranks every remembered camera and the diver's own position: read
	 * once, here, before the map is built. See `Start` in state/configuration.ts
	 * for the order of the rest.
	 */
	const queried = parseAddress(location.search);
	/*
	 * The fragment is the fallback, and only that. The scheme lived there for one
	 * release and links written then are still out on somebody's phone, so they are
	 * still read; the first write below moves the tab onto the query and the
	 * fragment never comes back.
	 */
	const address =
		queried.camera === undefined && queried.osm === undefined
			? parseAddress(location.hash)
			: queried;
	const opened: Start =
		address.camera === undefined ? opening.start : { kind: 'address', camera: address.camera };

	/**
	 * Put the link for what is on screen in the address bar, in place, without a
	 * history entry.
	 *
	 * Through SvelteKit's own `replaceState` rather than the browser's, because the
	 * router keeps its position in the history stack in that state object and loses
	 * count when something writes over it.
	 */
	const remember = (query: string): void => {
		if (query === location.search && location.hash === '') return;
		/*
		 * `svelte/no-navigation-without-resolve` wants the argument to be a bare
		 * `resolve()` call, so that nothing hard-codes a path that breaks under the
		 * base this site is served from on the project URL. The base is honoured
		 * here, by the `resolve('/')` the query is appended to; the rule cannot see
		 * through the template, and a query is not a route it could resolve.
		 */
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(`${resolve('/')}${query}`, {});
	};

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
		opened.kind === 'survey'
			? { centre: SURVEY_CENTRE, zoom: BEFORE_THE_GUARD_ANSWERS, bearing: 0 }
			: opened.camera;

	/*
	 * Where the map settled once everything allowed to move it has had its say.
	 * Undefined while a fix might still arrive, which is what keeps the opening
	 * hints from flashing up over a map that is about to jump to the diver.
	 */
	let settled = $state.raw<'survey' | 'elsewhere' | undefined>(
		opened.kind === 'tab' || opened.kind === 'address' ? 'elsewhere' : undefined
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
		/*
		 * The address bar trails the map on the same timer, so whatever is on screen
		 * is always a link somebody can send, and so the browser's own share button
		 * shares the view rather than the front page. Only once the map is really
		 * pointed somewhere: before that `view.camera` is the class's placeholder,
		 * and writing it would overwrite the link this tab was opened with.
		 *
		 * The open feature rides along, so sharing a dive site shares its card and
		 * not merely the water around it.
		 */
		const query = view.ready
			? formatAddress({ camera: view.camera, osm: view.selection?.feature?.ref }, location.search)
			: undefined;
		const pending = setTimeout(() => {
			configurations.remember(working);
			if (query !== undefined) remember(query);
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
			// A link and a reload both name the water already, so neither is moved.
			if (opened.kind === 'tab' || opened.kind === 'address') return;
			/*
			 * As far out as the map goes, which is the whole survey fitted to this
			 * screen. `constrainToData` does that arithmetic already and publishes the
			 * answer as the minimum zoom, so reading it back beats keeping a second
			 * copy of it here that would be right on a laptop and wrong on a phone.
			 */
			if (opened.kind === 'survey') {
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
				settled = opened.kind === 'survey' ? 'survey' : 'elsewhere';
			});
			return () => {
				canvas.removeEventListener('pointerdown', stop);
				canvas.removeEventListener('wheel', stop);
			};
		})
	);

	/*
	 * Blank water is two opposite answers wearing the same face: nobody surveyed
	 * here, or the archive that covers here would not open. The map cannot tell the
	 * diver which without being asked, so it is asked.
	 */
	$effect(() => whenMapReady((map) => watchArchives(map, view)));

	/*
	 * The document's language. `app.html` can only carry a guess, because the page
	 * is one prerendered file served to everybody, and a screen reader picks its
	 * voice from this attribute: Catalan labels read in an English voice stay that
	 * way for the whole dive unless it follows the language actually chosen.
	 */
	$effect(() => {
		document.documentElement.lang = view.locale;
	});

	/** Wet fingers need slack; the seabed needs more, so a site on a habitat
	 *  boundary names both sides rather than whichever pixel was under the thumb. */
	const box = (x: number, y: number, r: number): [[number, number], [number, number]] => [
		[x - r, y - r],
		[x + r, y + r]
	];

	/**
	 * Answer for one point on the map: the OSM feature under it, the seabed under
	 * it, and the depth. Shared by the tap that opens a card and by a link that
	 * arrives naming a feature, so both get the same card rather than two answers
	 * built from different queries.
	 *
	 * The depth is the contour nearest the point, read out of the archives rather
	 * than off the lines being drawn, so it is the same number at every zoom. The
	 * habitat polygon carries a range as well and it is the range of the whole
	 * polygon, which is how a card about one spot came to say "0 to 42 m".
	 */
	const inspect = (
		map: MapLibre,
		point: { readonly x: number; readonly y: number },
		at: { readonly lng: number; readonly lat: number }
	): void => {
		// The same window the hover cursor guards in `cursor.ts`, and it opens
		// again on the setStyle behind every layer toggle. MapLibre answers a
		// query naming a layer it does not have by firing an error event rather
		// than throwing, and the map turns that into a banner over a map that is
		// loading fine. There is nothing under the pointer to pick yet anyway.
		if (!map.isStyleLoaded()) return;
		const osm = map.queryRenderedFeatures(box(point.x, point.y, 10), {
			layers: [...OSM_PICK_LAYERS]
		});
		const ground = map.queryRenderedFeatures(box(point.x, point.y, 24), {
			layers: [...GROUND_PICK_LAYERS]
		});
		view.select(
			pickFrom(
				osm.map((f) => f.properties),
				ground.map((f) => ({ layer: f.layer.id, props: f.properties })),
				{ lng: at.lng, lat: at.lat },
				depthAt(map, at)
			)
		);
	};

	/** As close as a link to one feature goes, when the feature is a single point. */
	const FEATURE_ZOOM = 16;

	/*
	 * A link naming an OSM feature lands on it with its card open.
	 *
	 * The extent comes out of the file the map ships rather than from what happens
	 * to be drawn, because the camera has to be moved before the feature is on
	 * screen at all. Once it is there the card is built by the same query a tap
	 * runs, so a shared dive site arrives with its depth and its seabed filled in.
	 */
	$effect(() =>
		whenMapReady((map) => {
			let gone = false;

			const show = (ref: OsmRef): void => {
				void findExtent(ref).then((extent) => {
					if (gone || extent === undefined) return;
					const at = {
						lng: (extent.west + extent.east) / 2,
						lat: (extent.south + extent.north) / 2
					};
					map.fitBounds(
						[
							[extent.west, extent.south],
							[extent.east, extent.north]
						],
						{ padding: 80, maxZoom: FEATURE_ZOOM, duration: 0 }
					);
					map.once('idle', () => {
						if (!gone) inspect(map, map.project(at), at);
					});
				});
			};

			/*
			 * Only on a cold open now. A query pasted into the address bar is a page
			 * load, so it comes back through here rather than through a listener; the
			 * `hashchange` one that used to sit at this spot could only ever fire for
			 * the scheme this no longer writes.
			 */
			if (address.osm !== undefined) show(address.osm);

			return () => {
				gone = true;
			};
		})
	);

	$effect(() =>
		whenMapReady((map) => {
			/*
			 * A tap cannot open the panel, because double-tap-and-drag is how you
			 * zoom one-handed and a tap handler eats the first half of it. Touch gets
			 * a long press; a mouse keeps its click.
			 *
			 * Telling the two apart by `detail` was the wrong test and is why the
			 * gesture was still broken. A tap's synthetic click carries detail 1,
			 * exactly like a mouse click, so every tap opened the panel and the first
			 * half of a double-tap-and-drag laid a sheet over the second half. What
			 * is reliable is that a finger has just been on the glass: a mouse never
			 * fires a touch event, and the synthetic click follows the lift inside a
			 * few hundred milliseconds.
			 */
			const AFTER_TOUCH = 900;
			const DOUBLE_TAP = 400;
			let touchedAt = 0;
			let liftedAt = 0;
			let held: ReturnType<typeof setTimeout> | undefined;
			const cancel = () => {
				if (held !== undefined) clearTimeout(held);
				held = undefined;
			};

			const onclick = (e: MapMouseEvent) => {
				if (performance.now() - touchedAt < AFTER_TOUCH) return;
				inspect(map, e.point, e.lngLat);
			};
			const ontouchstart = (e: MapTouchEvent) => {
				cancel();
				const now = performance.now();
				touchedAt = now;
				if (e.points.length !== 1) return;
				// The second tap of a double tap is the first half of the zoom, so it
				// gets no long press at all. A hold that opened the panel there would
				// put the sheet under the drag that is about to follow.
				if (now - liftedAt < DOUBLE_TAP) return;
				const point = e.point;
				const at = e.lngLat;
				held = setTimeout(() => {
					held = undefined;
					inspect(map, point, at);
				}, 450);
			};
			const ontouchmove = () => {
				touchedAt = performance.now();
				cancel();
			};
			const ontouchend = () => {
				liftedAt = performance.now();
				touchedAt = liftedAt;
				cancel();
			};

			map.on('click', onclick);
			map.on('touchstart', ontouchstart);
			map.on('touchend', ontouchend);
			map.on('touchcancel', ontouchend);
			map.on('touchmove', ontouchmove);
			map.on('movestart', cancel);
			return () => {
				cancel();
				map.off('click', onclick);
				map.off('touchstart', ontouchstart);
				map.off('touchend', ontouchend);
				map.off('touchcancel', ontouchend);
				map.off('touchmove', ontouchmove);
				map.off('movestart', cancel);
			};
		})
	);
</script>

<svelte:head>
	<title>{t(view.locale, 'appName')}</title>
	<meta name="description" content={t(view.locale, 'appDescription')} />
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

	<!-- After the boot indicator has gone, and never under the failure banner it
	     would sit on top of. -->
	{#if view.ready && view.tilesLoading && !view.archiveUnreadable && view.error === undefined && updates.status === 'idle'}
		<div class="fetching" role="status">
			<span class="ping" aria-hidden="true"></span>
			{t(view.locale, 'loadingHere')}
		</div>
	{/if}

	<!-- The same pill in the same strip, because it answers the same question one
	     step on. An archive that will not open never finishes loading either, so it
	     takes the badge's place rather than sitting under a sounder that would ping
	     until the battery went. -->
	{#if view.ready && view.archiveUnreadable && view.error === undefined && updates.status === 'idle'}
		<div class="fetching unreadable" role="status">
			<span class="gap" aria-hidden="true"></span>
			{t(view.locale, 'loadFailedHere')}
		</div>
	{/if}

	<!-- Ahead of both badges in the same strip, because when a deploy is what went
	     wrong this is the answer to them: the archive an unreadable one is failing on
	     is the one the new version is already serving. It appears only once the map
	     has been tapped, since until then the page just reloads onto the new build
	     rather than say anything about it. -->
	{#if updates.status !== 'idle' && view.error === undefined}
		<div class="update" role="status">
			<span>{t(view.locale, 'updateReady')}</span>
			<button
				type="button"
				disabled={updates.status === 'taking'}
				onclick={() => {
					updates.take();
				}}>{t(view.locale, 'updateTake')}</button
			>
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
		textures={view.textures}
		onclose={() => {
			view.select(undefined);
		}}
	/>

	<ControlRail {view} {configurations} />
	<LocationControl {view} />
	<!-- After the locate control, so MapLibre stacks the toggle under it. -->
	<BaseMapToggle {view} />

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

	/*
	 * A pill, not an overlay. The diver is reading the seabed under it, and an
	 * indicator drawn over the water it is talking about would hide the answer it
	 * promises. It sits in the one strip of chrome nothing else uses, clear of both
	 * corner stacks on a phone, opaque rather than frosted so it survives a deck at
	 * noon, and deaf to the pointer so a drag that starts on it still pans.
	 */
	.fetching {
		position: absolute;
		z-index: 20;
		inset: calc(var(--ctrl-gap) + env(safe-area-inset-top)) auto auto 50%;
		translate: -50% 0;
		width: max-content;
		max-width: calc(100vw - 2 * (var(--ctrl-gap) * 2 + var(--ctrl-size)));
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.5rem 0.85rem;
		background: var(--color-table-800);
		border-radius: var(--radius-rail);
		box-shadow: var(--rail-shadow);
		color: var(--color-paper);
		font-size: 0.82rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		pointer-events: none;
	}

	/* The hazard edge of the failure banner, on the badge's own pill. A diver
	   glancing at the strip sees which of the two it is before reading it. */
	.unreadable {
		border: 1px solid var(--color-hazard);
	}

	.gap {
		flex: none;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--color-hazard);
	}

	/* A sounder pinging, the same brass as the line that drops on a cold start. */
	.ping {
		position: relative;
		flex: none;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--color-brass-300);
	}

	.ping::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		border: 1px solid var(--color-brass-400);
		animation: ping 1.4s ease-out infinite;
	}

	@keyframes ping {
		0% {
			scale: 1;
			opacity: 0.9;
		}
		100% {
			scale: 3.2;
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ping::after {
			animation: none;
			scale: 2;
			opacity: 0.45;
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

	/* The failure banner's shape without its hazard edge. Nothing is wrong, and a
	   rail-coloured border says so at the glance before the words are read. */
	.update {
		position: absolute;
		z-index: 25;
		inset: calc(var(--ctrl-gap) + env(safe-area-inset-top)) auto auto 50%;
		translate: -50% 0;
		width: max-content;
		max-width: min(34rem, calc(100vw - 2 * (var(--ctrl-gap) * 2 + var(--ctrl-size))));
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.85rem;
		background: var(--color-table-800);
		border: 1px solid var(--color-brass-500);
		border-radius: var(--radius-rail);
		box-shadow: var(--rail-shadow);
		color: var(--color-paper);
		font-size: 0.85rem;
	}

	.update button {
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

	.update button:hover {
		background: var(--color-brass-400);
	}

	.update button:disabled {
		cursor: progress;
		opacity: 0.6;
	}
</style>
