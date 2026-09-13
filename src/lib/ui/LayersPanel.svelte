<script lang="ts">
	import Panel from './Panel.svelte';
	import Action from './controls/Action.svelte';
	import Field from './controls/Field.svelte';
	import Note from './controls/Note.svelte';
	import Segmented from './controls/Segmented.svelte';
	import Slider from './controls/Slider.svelte';
	import Toggle from './controls/Toggle.svelte';
	import type { Choice } from './controls/types';
	import type { IconName } from './icons';
	import { PANEL_ID } from './panel';
	import type { LayerId } from '$lib/domain/card';
	import type { Ground } from '$lib/domain/habitat';
	import { type MessageKey, t } from '$lib/i18n/messages';
	import type { MapState } from '$lib/state/map-view.svelte';

	interface Props {
		readonly view: MapState;
		readonly onclose: () => void;
	}

	const { view, onclose }: Props = $props();

	interface LayerRow {
		readonly id: LayerId;
		readonly icon: IconName;
		readonly key: MessageKey;
	}

	const LAYER_ROWS: readonly LayerRow[] = [
		{ id: 'hillshade', icon: 'relief', key: 'relief' },
		{ id: 'depth-tint', icon: 'depth', key: 'depthTint' },
		{ id: 'coastline', icon: 'frame', key: 'coastline' },
		{ id: 'flourishes', icon: 'flourish', key: 'flourishes' },
		{ id: 'osm', icon: 'markerMooring', key: 'osmFeatures' },
		{ id: 'annotations', icon: 'annotate', key: 'annotations' }
	];

	const grounds = $derived<readonly Choice<Ground>[]>([
		{ value: 'habitats', label: t(view.locale, 'habitats'), icon: 'habitat' },
		{ value: 'substrate', label: t(view.locale, 'substrate'), icon: 'substrate' }
	]);

</script>

<Panel
	id={PANEL_ID}
	title={t(view.locale, 'layers')}
	locale={view.locale}
	anchor="top-left"
	{onclose}
>
	<Field label={t(view.locale, 'ground')}>
		<Segmented
			options={grounds}
			value={view.groundLayer}
			onselect={(ground: Ground) => {
				view.groundLayer = ground;
				if (!view.shows(ground)) view.toggle(ground);
			}}
		/>
		<!--
			Beside the ground it redraws rather than among the layer switches. It does
			not decide whether the seabed is painted, only which of the two habitat
			archives paints it: the survey is a 10 m raster, and off is the boundary
			as measured, staircase and all.
		-->
		<Toggle
			label={t(view.locale, 'smoothing')}
			pressed={view.smoothed}
			onchange={() => {
				view.smoothed = !view.smoothed;
			}}
		/>
		<Note>{t(view.locale, 'accuracyNote')}</Note>
		<Action
			label={t(view.locale, 'legendOpen')}
			icon="legend"
			onclick={() => {
				view.openPanel('legend');
			}}
		/>
	</Field>

	<div class="rows">
		<Toggle
			label={t(view.locale, 'satellite')}
			icon="satellite"
			pressed={view.shows('satellite')}
			onchange={() => {
				view.toggle('satellite');
			}}
		/>
		{#if view.shows('satellite')}
			<!--
				The photograph is always at full strength. What a diver dials is how much
				of the map's own paint is left over it, and the two sides of the shore
				want different answers: the survey stays authoritative over the water,
				the shore is the half a photograph says anything about.
			-->
			<div class="under">
				<Field label={t(view.locale, 'seabedPaint')}>
					<Slider
						label={t(view.locale, 'seabedPaint')}
						value={view.seabedPaint}
						onchange={(next: number) => {
							view.seabedPaint = next;
						}}
					/>
				</Field>
				<Field label={t(view.locale, 'landPaint')}>
					<Slider
						label={t(view.locale, 'landPaint')}
						value={view.landPaint}
						onchange={(next: number) => {
							view.landPaint = next;
						}}
					/>
				</Field>
			</div>
		{/if}
		<!--
			The depth veil row stays on screen while the photograph holds it off. It used
			to be dropped from the list, which left a diver who had just turned the
			photograph on looking at a panel one row shorter than the one they knew, with
			nothing anywhere saying where the veil had gone. Greyed with the reason on it
			answers the question the empty space asked.
		-->
		{#each LAYER_ROWS as row (row.id)}
			{@const held = view.lockedByPhoto(row.id)}
			<Toggle
				label={t(view.locale, row.key)}
				icon={row.icon}
				pressed={view.shows(row.id)}
				disabled={held}
				reason={held ? t(view.locale, 'depthTintOverPhoto') : undefined}
				onchange={() => {
					view.toggle(row.id);
				}}
			/>
			<!--
				The reason again, in the panel. `title` is the tooltip the owner asked for
				and it is a hover, and nobody hovers on a phone on a boat. Only while the
				row is held, so it is not a permanent line of small print.
			-->
			{#if held}
				<Note>{t(view.locale, 'depthTintOverPhoto')}</Note>
			{/if}
		{/each}
		<Action
			label={t(view.locale, 'markersOpen')}
			icon="legend"
			onclick={() => {
				view.openPanel('legend');
			}}
		/>
	</div>
</Panel>

<style>
	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	/* Indented so the strength reads as belonging to the switch above it rather
	   than as a seventh layer. */
	.under {
		padding: 0.15rem 0 0.35rem 1.9rem;
	}
</style>
