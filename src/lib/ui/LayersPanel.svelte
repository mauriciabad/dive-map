<script lang="ts">
	import BaseMapPicker from './BaseMapPicker.svelte';
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
	import { type BaseMapId, NO_BASE_MAP } from '$lib/domain/basemaps';
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
		{ id: 'depth-tint', icon: 'depthVeil', key: 'depthTint' },
		{ id: 'coastline', icon: 'land', key: 'land' },
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
	</Field>

	<Field label={t(view.locale, 'baseMap')}>
		<BaseMapPicker
			locale={view.locale}
			chosen={[view.baseMap]}
			onpick={(id: BaseMapId) => {
				view.setBaseMap(id);
			}}
		/>
		{#if view.baseMap !== NO_BASE_MAP}
			<!--
				The base map is always at full strength. What a diver dials is how much
				of the map's own paint goes back over it, one slider per side of the
				shore. Both start at nothing, because asking for a map under the chart
				should produce one.
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
	</Field>

	<!--
		Which two the corner button flicks between, chosen the same way and from the
		same ten. Picking one pushes the resting map into the other slot, so any pair
		is two taps, no tap can leave a slot empty and no tap can put the same map in
		both. That rule is `withQuickChoice` in the catalogue.
	-->
	<Field label={t(view.locale, 'quickToggle')}>
		<BaseMapPicker
			locale={view.locale}
			chosen={view.quickToggle}
			onpick={(id: BaseMapId) => {
				view.chooseQuick(id);
			}}
		/>
		<Note>{t(view.locale, 'quickToggleNote')}</Note>
	</Field>

	<div class="rows">
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

	/* Indented so the two paint levels read as belonging to the base map above
	   them rather than as layers of their own. */
	.under {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.15rem 0 0.1rem 0.9rem;
	}
</style>
