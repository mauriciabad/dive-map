<script lang="ts">
	import Panel from './Panel.svelte';
	import Action from './controls/Action.svelte';
	import Field from './controls/Field.svelte';
	import Note from './controls/Note.svelte';
	import Segmented from './controls/Segmented.svelte';
	import Swatch from './controls/Swatch.svelte';
	import type { Choice, TextureSample } from './controls/types';
	import LegendRow from './LegendRow.svelte';
	import MarkerRow from './MarkerRow.svelte';
	import { buildLegend, sampleFor } from './legend';
	import { InFrameGround } from './legend.svelte';
	import { PANEL_ID } from './panel';
	import type { Ground } from '$lib/domain/habitat';
	import { DIVE_FEATURE_KINDS } from '$lib/domain/osm';
	import { markerLayerId } from '$lib/domain/card';
	import { whenMapReady } from '$lib/map/controls';
	import {
		type TextureFormat,
		UNSURVEYED_TEXTURE,
		sizeForScreen,
		textureFormat
	} from '$lib/map/textures';
	import { t } from '$lib/i18n/messages';
	import type { MapState } from '$lib/state/map-view.svelte';

	interface Props {
		readonly view: MapState;
		readonly onclose: () => void;
	}

	const { view, onclose }: Props = $props();

	const inFrame = new InFrameGround();
	// Only while the panel is open: nothing else on the map wants this query.
	$effect(() => whenMapReady((map) => inFrame.attach(map)));

	let format = $state<TextureFormat | undefined>(undefined);
	$effect(() => {
		void textureFormat().then((resolved) => {
			format = resolved;
		});
	});

	// The size the map already fetched, so every band here is a cache hit.
	const size = sizeForScreen(
		window.devicePixelRatio,
		window.matchMedia('(pointer: coarse)').matches
	);

	const sampleOf = (texture: string): TextureSample | undefined =>
		format === undefined ? undefined : sampleFor(texture, size, format);

	const grounds = $derived<readonly Choice<Ground>[]>([
		{ value: 'habitats', label: t(view.locale, 'habitats'), icon: 'habitat' },
		{ value: 'substrate', label: t(view.locale, 'substrate'), icon: 'substrate' }
	]);
</script>

<Panel
	id={PANEL_ID}
	title={t(view.locale, 'legend')}
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
		<Note>
			{t(view.locale, view.groundLayer === 'habitats' ? 'habitatEstimate' : 'substrateEstimate')}
		</Note>
	</Field>

	<Field label={t(view.locale, 'legendMarkers')}>
		{#if view.shows('osm')}
			<Note>{t(view.locale, 'legendMarkersHint')}</Note>
			<div class="marks">
				{#each DIVE_FEATURE_KINDS as kind (kind)}
					<MarkerRow
						{kind}
						locale={view.locale}
						on={view.shows(markerLayerId(kind))}
						onchange={() => {
							view.toggle(markerLayerId(kind));
						}}
					/>
				{/each}
			</div>
			<Note>{t(view.locale, 'legendNameOnly')}</Note>
		{:else}
			<Note tone="warn">{t(view.locale, 'legendMarkersOff')}</Note>
			<Action
				label={t(view.locale, 'legendShowMarkers')}
				onclick={() => {
					view.toggle('osm');
				}}
			/>
		{/if}
	</Field>

	{#if !view.shows(view.groundLayer)}
		<Field label={t(view.locale, 'legendInFrame')}>
			<Note tone="warn">{t(view.locale, 'legendGroundOff')}</Note>
			<Action
				label={t(view.locale, 'legendShowGround')}
				onclick={() => {
					view.toggle(view.groundLayer);
				}}
			/>
		</Field>
	{:else}
		{#if inFrame.codes !== undefined}
			{@const legend = buildLegend(view.groundLayer, inFrame.codes, view.textures)}
			<Field label={t(view.locale, 'legendInFrame')}>
				{#if legend.inFrame.length === 0}
					<Note>{t(view.locale, 'legendNothingInFrame')}</Note>
				{:else}
					<ul class="rows">
						{#each legend.inFrame as row (row.texture)}
							<LegendRow
								{row}
								locale={view.locale}
								sample={sampleOf(row.texture)}
								missing={t(view.locale, 'legendNoSwatch')}
							/>
						{/each}
					</ul>
				{/if}
			</Field>

			{#if legend.elsewhere.length > 0}
				<Field label={t(view.locale, 'legendElsewhere')}>
					<ul class="rows">
						{#each legend.elsewhere as row (row.texture)}
							<LegendRow
								{row}
								locale={view.locale}
								sample={sampleOf(row.texture)}
								missing={t(view.locale, 'legendNoSwatch')}
							/>
						{/each}
					</ul>
				</Field>
			{/if}
		{/if}

		<Field label={t(view.locale, 'legendUnsurveyed')}>
			<Swatch sample={sampleOf(UNSURVEYED_TEXTURE)} missing={t(view.locale, 'legendNoSwatch')} />
			<Note>{t(view.locale, 'legendUnsurveyedHint')}</Note>
		</Field>

		{#if view.groundLayer === 'habitats'}
			<Note>{t(view.locale, 'legendHicNote')}</Note>
		{/if}
	{/if}
</Panel>

<style>
	.marks {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.rows {
		display: flex;
		flex-direction: column;
		/* Wider than the gap inside a row, so a caption belongs to the band above it. */
		gap: 1.1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
</style>
