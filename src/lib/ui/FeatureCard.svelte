<script lang="ts">
	import { asset } from '$app/paths';
	import Panel from './Panel.svelte';
	import Action from './controls/Action.svelte';
	import Chip from './controls/Chip.svelte';
	import ChipGroup from './controls/ChipGroup.svelte';
	import Field from './controls/Field.svelte';
	import Note from './controls/Note.svelte';
	import {
		KIND_LABEL,
		type FeaturePick,
		detailRowsOf,
		difficultyPips,
		difficultyText,
		heroDepthOf,
		subtitleOf,
		texturePath
	} from './feature-card';
	import { osmUrl } from '$lib/domain/osm';
	import { type TextureChoices, textureOf } from '$lib/domain/habitat';
	import { MARKERS } from '$lib/map/markers';
	import { type Locale, localisedName } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';

	interface Props {
		/** The tapped feature, or undefined when nothing is selected. */
		readonly pick: FeaturePick | undefined;
		readonly locale: Locale;
		/**
		 * The diver's texture choices. The card is read with the map right beside
		 * it, so a swatch showing the catalogue's texture while the polygon under
		 * the thumb is painted with another would be the card contradicting itself.
		 */
		readonly textures: TextureChoices;
		readonly onclose: () => void;
	}

	const { pick, locale, textures, onclose }: Props = $props();
</script>

{#if pick !== undefined}
	{@const feature = pick.feature}
	{@const heading =
		feature === undefined
			? t(locale, 'seabedHere')
			: (localisedName(feature.tags, locale) ?? t(locale, KIND_LABEL[feature.kind]))}
	{@const hero = feature === undefined ? undefined : heroDepthOf(feature)}
	{@const mark = feature === undefined ? undefined : MARKERS[feature.kind]}
	{@const levels = feature?.kind === 'dive-site' ? feature.difficulty : []}
	{@const difficulty = difficultyText(locale, levels)}
	{@const pips = difficultyPips(levels)}
	<Panel
		title={heading}
		{locale}
		anchor="bottom-left"
		titleTone="name"
		icon={mark?.icon}
		iconTint={mark?.colour}
		iconPlate={mark?.plate ?? false}
		{onclose}
	>
		{#if feature !== undefined}
			<p class="subtitle">{subtitleOf(feature, locale).join(' · ')}</p>
		{/if}

		<!--
			The depth under the point, unlabelled and the largest thing on the card. It
			is what a diver reads first and it needs no caption: a number this size on a
			card about one point on the seabed is the depth there. One number, never a
			range, which is what the owner asked for and what `depthAt` answers.
		-->
		{#if pick.depth !== undefined}
			<p class="here">{pick.depth}<span class="unit">m</span></p>
		{/if}

		{#if hero !== undefined}
			<Field label={t(locale, hero.label)}>
				{#if hero.metres === undefined}
					<p class="absent">{t(locale, 'notRecorded')}</p>
				{:else}
					<p class="metres">{hero.metres}<span class="unit">m</span></p>
				{/if}
			</Field>
		{/if}

		{#if difficulty !== undefined}
			<Field label={t(locale, 'difficulty')}>
				<div class="level">
					<span class="numerals">{difficulty}</span>
					{#if pips.length > 0}
						<span class="pips" aria-hidden="true">
							{#each pips as lit, level (level)}
								<span class={['pip', { lit }]}></span>
							{/each}
						</span>
					{/if}
				</div>
			</Field>
		{/if}

		<Field label={t(locale, 'position')}>
			<p class="numeric prose">{pick.position.lat.toFixed(5)}, {pick.position.lng.toFixed(5)}</p>
		</Field>

		{#each feature === undefined ? [] : detailRowsOf(feature, locale) as row (row.label)}
			<Field label={t(locale, row.label)}>
				{#if row.label === 'description'}
					<p class="prose">{row.values.join(' ')}</p>
				{:else}
					<ChipGroup>
						{#each row.values as value (value)}
							<Chip label={value} />
						{/each}
					</ChipGroup>
				{/if}
			</Field>
		{/each}

		<!--
			Both catalogues, always. What lives on the bottom and what the bottom is
			made of are different questions, and which layer happens to be painted is a
			display preference that was deciding which half of the answer a diver got.
		-->
		{#each pick.seabed as reading (reading.ground)}
			<Field label={t(locale, reading.ground)}>
				<ul class="seabed">
					{#each reading.classes as seabedClass (seabedClass)}
						<li>
							<span
								class="swatch"
								style:background-image="url({asset(texturePath(textureOf(seabedClass, textures)))})"
								aria-hidden="true"
							></span>
							<span class="seabed-name">{seabedClass[locale]}</span>
						</li>
					{/each}
				</ul>
				<Note>
					{t(locale, reading.ground === 'habitats' ? 'habitatEstimate' : 'substrateEstimate')}
				</Note>
			</Field>
		{/each}

		{#snippet footer()}
			{#if feature !== undefined}
				<Action label={t(locale, 'editInOsm')} href={osmUrl(feature.ref)} />
			{/if}
		{/snippet}
	</Panel>
{/if}

<style>
	.subtitle {
		margin: 0;
		font-size: 0.8rem;
		color: var(--control-ink-dim);
	}

	/* The depth under the point. Nothing else on the card is bigger. */
	.here {
		margin: 0;
		font-size: 3.2rem;
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: var(--control-ink);
	}

	/* The feature's own depth, under its label: the site's rating, not the ground. */
	.metres {
		margin: 0;
		font-size: 1.6rem;
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: var(--control-ink);
	}

	.unit {
		margin-left: 0.3rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-brass-300);
	}

	.absent {
		margin: 0;
		font-size: 1.1rem;
		color: var(--control-ink-dim);
	}

	.level {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.numerals {
		font-size: 1.25rem;
		font-variant-numeric: tabular-nums;
		color: var(--control-ink);
	}

	.pips {
		display: flex;
		gap: 0.25rem;
	}

	.pip {
		width: 0.72rem;
		height: 0.72rem;
		border-radius: 2px;
		background: var(--color-table-600);
	}

	.pip.lit {
		background: var(--color-brass-400);
	}

	.prose {
		margin: 0;
		font-size: var(--control-text);
		line-height: 1.5;
		color: var(--control-ink);
	}

	.numeric {
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.01em;
	}

	.seabed {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.seabed li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.swatch {
		flex: none;
		width: 2.25rem;
		height: 2.25rem;
		background-size: cover;
		background-position: center;
		border-radius: var(--control-radius);
		border: 1px solid var(--ctrl-edge);
	}

	.seabed-name {
		font-size: var(--control-text);
		color: var(--control-ink);
	}
</style>
