<script lang="ts">
	import Icon from './Icon.svelte';
	import Panel from './Panel.svelte';
	import Action from './controls/Action.svelte';
	import Chip from './controls/Chip.svelte';
	import Field from './controls/Field.svelte';
	import Note from './controls/Note.svelte';
	import Swatch from './controls/Swatch.svelte';
	import LegendRow from './LegendRow.svelte';
	import MarkerRow from './MarkerRow.svelte';
	import TexturePicker from './TexturePicker.svelte';
	import { buildLegend } from './legend';
	import { InFrameGround } from './legend.svelte';
	import { PANEL_ID } from './panel';
	import type { SeabedClass } from '$lib/domain/habitat';
	import { DIVE_FEATURE_KINDS } from '$lib/domain/osm';
	import { HABITAT_POINTS } from '$lib/map/habitat-points';
	import { markerLayerId } from '$lib/domain/card';
	import { whenMapReady } from '$lib/map/controls';
	import {
		THUMBNAIL_SIZE,
		type TextureFormat,
		UNSURVEYED_TEXTURE,
		sizeForScreen,
		textureFormat,
		textureUrl
	} from '$lib/map/textures';
	import { t } from '$lib/i18n/messages';
	import type { MapState } from '$lib/state/map-view.svelte';

	interface Props {
		readonly view: MapState;
		readonly onclose: () => void;
	}

	const { view, onclose }: Props = $props();

	/**
	 * The class whose texture is being chosen, or nothing, which is the legend.
	 *
	 * One piece of state rather than a flag plus a class, so the panel cannot be
	 * picking for nobody, and it is held here rather than in the row because
	 * choosing a texture regroups the rows and would take the row with it.
	 */
	let picking = $state<SeabedClass | undefined>(undefined);

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

	const sampleOf = (texture: string): string | undefined =>
		format === undefined ? undefined : textureUrl(texture, size, format);

	// The grid opens forty-nine bands at once, against one per legend row, and a
	// band is a hundred CSS pixels across at most. The smallest file in the pyramid
	// is the same tile for a fifth of the bytes.
	const thumbnailOf = (texture: string): string | undefined =>
		format === undefined ? undefined : textureUrl(texture, THUMBNAIL_SIZE, format);

	const changed = $derived(Object.keys(view.textures).length);
</script>

<Panel
	id={PANEL_ID}
	title={picking === undefined ? t(view.locale, 'legend') : picking[view.locale]}
	titleTone={picking === undefined ? 'label' : 'name'}
	showing={picking === undefined ? 'legend' : 'texture'}
	locale={view.locale}
	anchor="top-left"
	{onclose}
>
	{#if picking !== undefined}
		{@const seabed = picking}
		<TexturePicker
			{seabed}
			chosen={view.textures}
			locale={view.locale}
			sampleOf={thumbnailOf}
			missing={t(view.locale, 'legendNoSwatch')}
			onpick={(texture: string) => {
				view.setTexture(seabed, texture);
			}}
			onback={() => {
				picking = undefined;
			}}
		/>
	{:else}
		{#if changed > 0}
			<Field label={t(view.locale, 'legendTexture')}>
				<Note>
					{changed === 1
						? t(view.locale, 'legendTexturesOne')
						: t(view.locale, 'legendTexturesMany', { n: changed })}
				</Note>
				<Action
					label={t(view.locale, 'legendRestoreTextures')}
					icon="reset"
					onclick={() => {
						view.clearTextures();
					}}
				/>
			</Field>
		{/if}

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

		<!--
			Beside the map marks and not among the texture rows, because these are marks
			too: the survey drew them as points and the map draws them as glyphs, so
			what a diver is matching is a drawing rather than a pattern of seabed. One
			switch for the layer, in the Layers panel, which is what the marks above
			answer to as well.
		-->
		<Field label={t(view.locale, 'habitatPoints')}>
			{#if view.shows('habitat-points')}
				<Note>{t(view.locale, 'habitatPointsHint')}</Note>
				<ul class="points">
					{#each HABITAT_POINTS as point (point.code)}
						<li class="point">
							<span class="mark" style:color={point.colour}>
								<Icon name={point.icon} size={24} />
							</span>
							<span class="name">
								<span class="text">{point[view.locale]}</span>
								{#if point.hic !== undefined}
									<Chip label={t(view.locale, 'legendHic', { code: point.hic })} />
								{/if}
							</span>
						</li>
					{/each}
				</ul>
			{:else}
				<Note tone="warn">{t(view.locale, 'habitatPointsOff')}</Note>
				<Action
					label={t(view.locale, 'habitatPointsShow')}
					onclick={() => {
						view.toggle('habitat-points');
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
									onpick={(seabed: SeabedClass) => {
										picking = seabed;
									}}
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
									onpick={(seabed: SeabedClass) => {
										picking = seabed;
									}}
								/>
							{/each}
						</ul>
					</Field>
				{/if}
			{/if}

			<Field label={t(view.locale, 'legendUnsurveyed')}>
				<div class="lone">
					<Swatch
						url={sampleOf(UNSURVEYED_TEXTURE)}
						missing={t(view.locale, 'legendNoSwatch')}
						shape="column"
					/>
					<Note>{t(view.locale, 'legendUnsurveyedHint')}</Note>
				</div>
			</Field>

			{#if view.groundLayer === 'habitats'}
				<Note>{t(view.locale, 'legendHicNote')}</Note>
			{/if}
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
		/* Wider than the gap between two names, so a strip owns the names beside it. */
		gap: 0.55rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.points {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* The same column the map marks stand in, so the two lists read as one set. */
	.point {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.3rem 0.5rem;
	}

	.point .mark {
		display: grid;
		flex: none;
		place-items: center;
		width: 1.9rem;
		height: 1.9rem;
	}

	.point .name {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		flex: 1;
		min-width: 0;
		font-size: var(--control-text);
		line-height: 1.3;
		overflow-wrap: anywhere;
	}

	.point .text {
		flex: 1 1 8rem;
		min-width: 0;
	}

	/* The hatch has no class list, so its hint stands in for one and sits beside it.
	   Same width as a legend row's swatch, so the hatch reads as one more texture
	   rather than a smaller afterthought beside the classes above it. */
	.lone {
		display: grid;
		grid-template-columns: 6.5rem minmax(0, 1fr);
		gap: 0.4rem;
		align-items: center;
	}
</style>
