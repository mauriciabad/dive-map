<script lang="ts">
	import { whenMapReady } from '$lib/map/controls';
	import { COAST_HINT, type Box, type Point, onScreen, placeHint } from './first-run';
	import { LOCATE_CONTROL_CLASS } from './panel';
	import type { Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';

	/**
	 * The two things worth teaching on a first visit, drawn over the map and
	 * pointing at what they mean.
	 *
	 * The whole overlay is transparent to the pointer, which is what makes the
	 * rule the issue is explicit about fall out rather than be enforced: dragging
	 * and pinching reach the map through it, so moving around cannot put the hints
	 * away. Zooming in does, because that is the thing being taught, and once it
	 * is done it never comes back.
	 *
	 * There is no close button on purpose. It would sit in the same corner of the
	 * screen as the hint about the locate control, be the easier of the two to
	 * press, and teach nothing. The gesture that dismisses these is the gesture
	 * they exist to ask for.
	 */

	interface Props {
		readonly locale: Locale;
		/** The diver zoomed in, so the hints have done their job and are finished. */
		readonly ondone: () => void;
	}

	const { locale, ondone }: Props = $props();

	/** A tenth of a zoom level is clamp jitter. A quarter is somebody zooming. */
	const ZOOMED_IN = 0.25;

	/** Keep the coast arrow's tip this far inside the screen when the map is dragged. */
	const TARGET_INSET = 64;

	const viewport = $state({ width: 1440, height: 900 });
	const coastPlaque = $state({ width: 0, height: 0 });
	const locatePlaque = $state({ width: 0, height: 0 });

	let coastAt = $state.raw<Point | undefined>(undefined);
	let locateBox = $state.raw<DOMRect | undefined>(undefined);

	/** How far outside the button the ring is drawn, so it reads as around it rather than on it. */
	const RING_INSET = -4;

	const locateAt = $derived(
		locateBox === undefined
			? undefined
			: { x: locateBox.left + locateBox.width / 2, y: locateBox.top + locateBox.height / 2 }
	);

	/**
	 * The coast moves under the map, the button moves with the chrome, and both are
	 * read in the same pass so a drag never leaves one of them a frame behind.
	 */
	$effect(() =>
		whenMapReady((map) => {
			const place = (): void => {
				const projected = map.project([COAST_HINT.lng, COAST_HINT.lat]);
				coastAt = onScreen({ x: projected.x, y: projected.y }, viewport, TARGET_INSET);
				const button = document.querySelector(`.${LOCATE_CONTROL_CLASS} button`);
				locateBox = button?.getBoundingClientRect();
			};

			// The guard's outer limit is where the map opened, so anything past it is
			// the diver going in. Read live rather than captured: a phone turning on
			// its side moves the limit, and a turn is not a lesson learned.
			const check = (): void => {
				if (map.getZoom() > map.getMinZoom() + ZOOMED_IN) ondone();
			};

			place();
			check();
			map.on('move', place);
			map.on('zoom', check);
			return () => {
				map.off('move', place);
				map.off('zoom', check);
			};
		})
	);

	const sized = (box: Box): boolean => box.width > 0 && box.height > 0;

	/**
	 * The coast plaque goes wherever there is most empty water. Fitting the whole
	 * survey to a wide screen leaves margins down the sides and to a tall one
	 * leaves bands above and below, so the plaque takes the side and the phone
	 * takes the bottom. `placeHint` holds both inside the screen from there.
	 */
	const coast = $derived.by(() => {
		const target = coastAt;
		if (target === undefined || !sized(coastPlaque)) return undefined;
		const wide = viewport.width > viewport.height;
		const offset = wide
			? { x: -(coastPlaque.width / 2 + 92), y: 56 }
			: { x: 0, y: coastPlaque.height / 2 + 104 };
		return placeHint(target, coastPlaque, viewport, offset, wide ? 26 : -30);
	});

	const locate = $derived.by(() => {
		const target = locateAt;
		if (target === undefined || !sized(locatePlaque)) return undefined;
		return placeHint(
			target,
			locatePlaque,
			viewport,
			{ x: -(locatePlaque.width / 2 + 28), y: 84 },
			-22
		);
	});
</script>

<svelte:window bind:innerWidth={viewport.width} bind:innerHeight={viewport.height} />

<div class="hints" role="status">
	<svg class="leaders" aria-hidden="true">
		{#if coast !== undefined && coast.leader !== ''}
			<path class="leader" style:--in="120ms" pathLength="1" d={coast.leader} />
			<path
				class="head nudge"
				style:--in="560ms"
				style:--nudge-x="{coast.heading.x * 5}px"
				style:--nudge-y="{coast.heading.y * 5}px"
				d={coast.head}
			/>
		{/if}
		{#if locate !== undefined && locate.leader !== ''}
			<path class="leader" style:--in="300ms" pathLength="1" d={locate.leader} />
			<path class="head" style:--in="740ms" d={locate.head} />
		{/if}
		{#if locateBox !== undefined && locate !== undefined}
			<!-- Drawn round the button rather than painted onto it, so nothing here
			     reaches into a control another component owns. -->
			<rect
				class="ring"
				style:--in="740ms"
				x={locateBox.left + RING_INSET}
				y={locateBox.top + RING_INSET}
				width={locateBox.width - 2 * RING_INSET}
				height={locateBox.height - 2 * RING_INSET}
				rx="12"
			/>
		{/if}
	</svg>

	<p
		class="plaque"
		class:placed={coast !== undefined}
		style:--in="0ms"
		style:left="{coast?.at.x ?? 0}px"
		style:top="{coast?.at.y ?? 0}px"
		bind:clientWidth={coastPlaque.width}
		bind:clientHeight={coastPlaque.height}
	>
		{t(locale, 'introCoast')}
	</p>

	<p
		class="plaque"
		class:placed={locate !== undefined}
		style:--in="180ms"
		style:left="{locate?.at.x ?? 0}px"
		style:top="{locate?.at.y ?? 0}px"
		bind:clientWidth={locatePlaque.width}
		bind:clientHeight={locatePlaque.height}
	>
		{t(locale, 'introLocate')}
	</p>
</div>

<style>
	/*
	 * Above the map and below everything a diver can press. Nothing in here takes
	 * a pointer event, so a drag, a pinch and a tap all land on the map underneath
	 * exactly as they would with the overlay absent.
	 */
	.hints {
		position: absolute;
		inset: 0;
		z-index: 5;
		pointer-events: none;
	}

	.leaders {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	/*
	 * Brass on the sea, at the weight the rest of the chrome draws its glyphs. The
	 * dark stroke under it is what keeps the line readable where it crosses the
	 * pale shallows, which is most of where it goes.
	 */
	.leader,
	.head,
	.ring {
		fill: none;
		stroke: var(--color-brass-400);
		stroke-width: 2.4;
		stroke-linecap: round;
		stroke-linejoin: round;
		paint-order: stroke;
		filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.75));
	}

	/* One authored moment: each line draws itself in, then its arrowhead arrives. */
	.leader {
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		animation: ink 620ms cubic-bezier(0.16, 1, 0.3, 1) var(--in) both;
	}

	.head {
		opacity: 0;
		animation: arrive 320ms ease-out var(--in) both;
	}

	/*
	 * Once every few seconds the coast arrow leans the way it is pointing and the
	 * ring round the button breathes. On a phone in sun a static hairline gets read
	 * as part of the map; something that moves once in a while gets read as
	 * somebody indicating. Both run off the same clock, so the pair reads as one
	 * gesture rather than as two things fidgeting.
	 */
	.nudge {
		animation:
			arrive 320ms ease-out var(--in) both,
			lean 3.4s ease-in-out 1.4s infinite;
	}

	.ring {
		stroke-width: 2;
		opacity: 0;
		animation:
			arrive 320ms ease-out var(--in) both,
			breathe 3.4s ease-in-out 1.4s infinite;
	}

	.plaque {
		position: absolute;
		margin: 0;
		max-width: min(19rem, 64vw);
		padding: 0.6rem 0.85rem;
		background: var(--color-table-800);
		border: 1px solid var(--ctrl-edge);
		border-radius: var(--radius-rail);
		box-shadow: var(--rail-shadow);
		color: var(--color-paper);
		/* A notch above the app's own control text. It is the one thing on screen,
		   and the screen is a phone in sunlight. */
		font-size: 1rem;
		line-height: 1.35;
		text-wrap: balance;
		opacity: 0;
	}

	/*
	 * Measured before it is placed, so the first frame would otherwise show both
	 * plaques stacked in the top-left corner. They stay invisible until they know
	 * where they go, and the entrance starts from there.
	 */
	.plaque.placed {
		animation: settle 460ms cubic-bezier(0.16, 1, 0.3, 1) var(--in) both;
	}

	@keyframes ink {
		to {
			stroke-dashoffset: 0;
		}
	}

	@keyframes arrive {
		to {
			opacity: 1;
		}
	}

	@keyframes settle {
		from {
			opacity: 0;
			translate: 0 8px;
		}
		to {
			opacity: 1;
			translate: 0 0;
		}
	}

	@keyframes lean {
		0%,
		72%,
		100% {
			translate: 0 0;
		}
		86% {
			translate: var(--nudge-x) var(--nudge-y);
		}
	}

	@keyframes breathe {
		0%,
		72%,
		100% {
			opacity: 0.55;
			stroke-width: 2;
		}
		86% {
			opacity: 1;
			stroke-width: 2.8;
		}
	}

	/*
	 * The global reduced-motion rule crushes durations to nothing, which leaves an
	 * infinite animation spinning and a `both` fill starting from its hidden first
	 * frame. Named here so the hints simply appear, drawn and still.
	 */
	@media (prefers-reduced-motion: reduce) {
		.leader,
		.head,
		.nudge,
		.ring,
		.plaque.placed {
			animation: none;
			opacity: 1;
			stroke-dashoffset: 0;
		}
	}
</style>
