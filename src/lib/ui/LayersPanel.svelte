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
		{ id: 'osm', icon: 'buoy', key: 'osmFeatures' },
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
	</div>
</Panel>

<style>
	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
</style>
