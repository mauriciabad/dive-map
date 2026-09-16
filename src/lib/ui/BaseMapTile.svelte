<script lang="ts">
	import Icon from './Icon.svelte';
	import { baseMapName } from './basemap-name';
	import { baseMapPreview } from './basemap-preview';
	import type { BaseMapId } from '$lib/domain/basemaps';
	import type { Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';
	import { PALETTE } from '$lib/map/palette';

	/**
	 * One base map, shown as the map it is rather than as its name.
	 *
	 * The archives' names are proper nouns a diver has no reason to know: ICGC and
	 * IGN both publish a photograph, a road map and a topographic sheet, so the
	 * name alone cannot say which of the three any row would put under the chart.
	 * The extracted tile can, and does it in the width of a word.
	 *
	 * The name stays, over the picture rather than beside it, because two archives
	 * flew the same coast and the tiles at this size are nearly the same picture.
	 *
	 * `none` has no photograph. It is the chart with nothing under it, so it gets
	 * the chart's own isobath mark on the colour the map paints open water, which
	 * is the same colour the photographs are backed with above.
	 */

	interface Props {
		readonly id: BaseMapId;
		/** The archive's own name, or nothing where the heading already said it. */
		readonly label?: string | undefined;
		readonly locale: Locale;
		readonly pressed: boolean;
		readonly recommended?: boolean;
		readonly onpick: () => void;
	}

	const { id, label, locale, pressed, recommended = false, onpick }: Props = $props();

	const preview = $derived(baseMapPreview(id));
	/**
	 * Spoken as the shelf and then the archive, the way the corner button and the
	 * quick pair's summary say it, with the star read out rather than left as a
	 * mark only a sighted diver gets.
	 */
	const spoken = $derived(
		recommended
			? `${baseMapName(id, locale)}, ${t(locale, 'baseMapRecommended')}`
			: baseMapName(id, locale)
	);
</script>

<button type="button" class="tile" aria-pressed={pressed} aria-label={spoken} onclick={onpick}>
	{#if preview === undefined}
		<span class="chart" style:background={PALETTE.void}>
			<Icon name="isobath" size={24} />
		</span>
	{:else}
		<img src={preview} alt="" width="128" height="128" />
	{/if}
	{#if recommended}
		<span class="star" aria-hidden="true">★</span>
	{/if}
	{#if label !== undefined}
		<span class="name">{label}</span>
	{/if}
</button>

<style>
	/*
	 * Square, and wide enough that four sit on one line inside the panel on the
	 * narrowest phone this app supports. The width comes from the picker so every
	 * shelf draws the same tile, whether it holds two of them or four.
	 */
	.tile {
		position: relative;
		flex: none;
		width: var(--tile);
		padding: 0;
		border: 1px solid var(--control-rim);
		border-radius: var(--control-radius);
		background: var(--control-well);
		color: var(--control-ink-dim);
		overflow: hidden;
		cursor: pointer;
		transition:
			border-color var(--control-ease),
			box-shadow var(--control-ease);
	}

	.tile:hover {
		border-color: var(--control-on);
	}

	/* The brass the rest of the panel marks a chosen thing with, as a ring rather
	   than a fill, because the picture underneath is the point. */
	.tile[aria-pressed='true'] {
		border-color: var(--control-on);
		box-shadow:
			0 0 0 2px var(--control-on),
			var(--sunk);
	}

	img,
	.chart {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
	}

	.chart {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-paper-dim);
	}

	/*
	 * Over the tile on a scrim rather than under it on a line of its own: the
	 * label has to be readable against a photograph of a town and against one of
	 * open water, and a row of ten tiles has no room for a caption each.
	 */
	.name {
		position: absolute;
		inset: auto 0 0 0;
		padding: 0.55rem 0.15rem 0.15rem;
		background: linear-gradient(to top, rgb(3 8 12 / 0.85), rgb(3 8 12 / 0));
		color: var(--color-paper);
		font-size: 0.68rem;
		font-weight: 700;
		line-height: 1.1;
		text-align: center;
		text-shadow: 0 1px 2px rgb(0 0 0 / 0.9);
	}

	/* The best of its shelf, marked the way issue #40 marked it and kept in the
	   corner so it never lands on the name. */
	.star {
		position: absolute;
		top: 0.05rem;
		right: 0.2rem;
		color: var(--color-brass-300);
		font-size: 0.75rem;
		text-shadow: 0 1px 2px rgb(0 0 0 / 0.9);
	}
</style>
