<script lang="ts">
	import Panel from './Panel.svelte';
	import Action from './controls/Action.svelte';
	import Field from './controls/Field.svelte';
	import Note from './controls/Note.svelte';
	import Segmented from './controls/Segmented.svelte';
	import Toggle from './controls/Toggle.svelte';
	import type { Choice } from './controls/types';
	import type { IconName } from './icons';
	import { PANEL_ID } from './panel';
	import { PHOTO_STRENGTHS, type LayerId, type PhotoStrength } from '$lib/domain/card';
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

	const strengths: readonly Choice<PhotoStrength>[] = PHOTO_STRENGTHS.map((value) => ({
		value,
		label: `${value * 100}%`
	}));
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
			<div class="under">
				<Field label={t(view.locale, 'photoStrength')}>
					<Segmented
						options={strengths}
						value={view.photoStrength}
						numeric
						onselect={(next: PhotoStrength) => {
							view.photoStrength = next;
						}}
					/>
				</Field>
			</div>
		{/if}
		{#each LAYER_ROWS as row (row.id)}
			<Toggle
				label={t(view.locale, row.key)}
				icon={row.icon}
				pressed={view.shows(row.id)}
				onchange={() => {
					view.toggle(row.id);
				}}
			/>
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
