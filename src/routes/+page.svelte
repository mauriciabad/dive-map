<script lang="ts">
	import MapView from '$lib/map/MapView.svelte';
	import ControlRail from '$lib/ui/ControlRail.svelte';
	import CropOverlay from '$lib/ui/CropOverlay.svelte';
	import FeatureCard from '$lib/ui/FeatureCard.svelte';
	import { GROUND_PICK_LAYERS, OSM_PICK_LAYERS, pickFrom } from '$lib/ui/feature-card';
	import { whenMapReady } from '$lib/map/controls';
	import type { MapMouseEvent } from 'maplibre-gl';
	import { MapState } from '$lib/state/map-view.svelte';
	import { t } from '$lib/i18n/messages';
	import { renderCard } from '$lib/print/render';
	import { composeCardPdf } from '$lib/print/pdf';

	/** Begur and Tamariu, the water this was built for. */
	const START = { lng: 3.2165, lat: 41.9275 };
	const START_ZOOM = 13.4;

	const view = new MapState(navigator.languages);
	let exporting = $state(false);

	/** Wet fingers need slack; the seabed needs more, so a site on a habitat
	 *  boundary names both sides rather than whichever pixel was under the thumb. */
	const box = (x: number, y: number, r: number): [[number, number], [number, number]] => [
		[x - r, y - r],
		[x + r, y + r]
	];

	$effect(() =>
		whenMapReady((map) => {
			const onclick = (e: MapMouseEvent) => {
				const osm = map.queryRenderedFeatures(box(e.point.x, e.point.y, 10), {
					layers: [...OSM_PICK_LAYERS]
				});
				const ground = map.queryRenderedFeatures(box(e.point.x, e.point.y, 24), {
					layers: [...GROUND_PICK_LAYERS]
				});
				view.select(
					pickFrom(
						osm.map((f) => f.properties),
						ground.map((f) => f.properties)
					)
				);
			};
			map.on('click', onclick);
			return () => {
				map.off('click', onclick);
			};
		})
	);

	const fileName = (title: string): string => {
		const slug = title
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^\w]+/g, '-')
			.replace(/^-|-$/g, '')
			.toLowerCase();
		return `${slug.length > 0 ? slug : 'full'}.pdf`;
	};

	const exportSheet = async (): Promise<void> => {
		exporting = true;
		try {
			const card = view.framedCard;
			const rendered = await renderCard(card, {
				isobaths: view.isobaths,
				visible: [...view.visible],
				groundLayer: view.groundLayer
			});
			const pdf = await composeCardPdf(card, rendered, view.locale);
			const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }));
			const a = document.createElement('a');
			a.href = url;
			a.download = fileName(card.title);
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			view.error = e instanceof Error ? e.message : String(e);
		} finally {
			exporting = false;
		}
	};
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

	{#if view.framing}
		<CropOverlay
			{view}
			busy={exporting}
			onexport={() => {
				void exportSheet();
			}}
		/>
	{/if}

	<FeatureCard
		pick={view.selection}
		locale={view.locale}
		onclose={() => {
			view.select(undefined);
		}}
	/>

	<ControlRail {view} />
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
		inset: 1rem 1rem auto 1rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		max-width: 34rem;
		margin-inline: auto;
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
