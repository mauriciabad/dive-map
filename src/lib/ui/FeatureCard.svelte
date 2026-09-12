<script lang="ts">
	import { asset } from '$app/paths';
	import Icon from './Icon.svelte';
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
	import { type Locale, localisedName } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';

	interface Props {
		/** The tapped feature, or undefined when nothing is selected. */
		pick: FeaturePick | undefined;
		locale: Locale;
		onclose: () => void;
	}

	const { pick, locale, onclose }: Props = $props();

	let body = $state<HTMLElement | undefined>(undefined);
	let more = $state(false);

	/**
	 * A phone caps the sheet short of the map centre, so a hazard can sit below the
	 * fold with nothing to say so. The fade is driven by the real scroll position,
	 * never painted over a list that is already whole.
	 */
	$effect(() => {
		const el = body;
		if (el === undefined || pick === undefined) return;
		const measure = () => {
			more = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
		};
		measure();
		el.addEventListener('scroll', measure, { passive: true });
		return () => {
			el.removeEventListener('scroll', measure);
		};
	});
</script>

<svelte:window
	onkeydown={(e: KeyboardEvent) => {
		if (e.key === 'Escape' && pick !== undefined) onclose();
	}}
/>

{#if pick !== undefined}
	{@const feature = pick.feature}
	{@const heading =
		feature === undefined
			? t(locale, 'seabedHere')
			: (localisedName(feature.tags, locale) ?? t(locale, KIND_LABEL[feature.kind]))}
	{@const hero = feature === undefined ? undefined : heroDepthOf(feature)}
	{@const levels = feature?.kind === 'dive-site' ? feature.difficulty : []}
	{@const difficulty = difficultyText(locale, levels)}
	{@const pips = difficultyPips(levels)}
	<section class="sheet" aria-label={heading}>
		<header>
			<h2>{heading}</h2>
			<button type="button" class="icon-btn" onclick={onclose}>
				<Icon name="close" size={20} />
				<span class="sr">{t(locale, 'close')}</span>
			</button>
		</header>

		<div class={['body', { more }]} bind:this={body}>
			{#if feature !== undefined}
				<p class="subtitle">{subtitleOf(feature, locale).join(' · ')}</p>
			{/if}

			{#if hero !== undefined}
				<div class="block">
					<span class="legend">{t(locale, hero.label)}</span>
					{#if hero.metres === undefined}
						<p class="absent">{t(locale, 'notRecorded')}</p>
					{:else}
						<p class="metres">{hero.metres}<span class="unit">m</span></p>
					{/if}
				</div>
			{/if}

			{#if difficulty !== undefined}
				<div class="block">
					<span class="legend">{t(locale, 'difficulty')}</span>
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
				</div>
			{/if}

			{#if pick.depth !== undefined}
				<div class="block">
					<span class="legend">{t(locale, 'surveyedDepth')}</span>
					<p class="prose">
						{t(locale, 'depthRange', { min: pick.depth.min, max: pick.depth.max })}
					</p>
				</div>
			{/if}

			<div class="block">
				<span class="legend">{t(locale, 'position')}</span>
				<p class="prose numeric">
					{pick.position.lat.toFixed(5)}, {pick.position.lng.toFixed(5)}
				</p>
			</div>

			{#each feature === undefined ? [] : detailRowsOf(feature, locale) as row (row.label)}
				<div class="block">
					<span class="legend">{t(locale, row.label)}</span>
					{#if row.label === 'description'}
						<p class="prose">{row.values.join(' ')}</p>
					{:else}
						<div class="chips">
							{#each row.values as value (value)}
								<span class="chip">{value}</span>
							{/each}
						</div>
					{/if}
				</div>
			{/each}

			{#if pick.seabed.length > 0}
				<div class="block">
					<span class="legend">{t(locale, 'seabed')}</span>
					<ul class="seabed">
						{#each pick.seabed as seabedClass (seabedClass)}
							<li>
								<span
									class="swatch"
									style:background-image="url({asset(texturePath(seabedClass.texture))})"
									aria-hidden="true"
								></span>
								<span class="seabed-name">{seabedClass[locale]}</span>
							</li>
						{/each}
					</ul>
					<p class="note">{t(locale, 'habitatEstimate')}</p>
				</div>
			{/if}
		</div>

		{#if feature !== undefined}
			<a class="osm" href={osmUrl(feature.ref)} target="_blank" rel="external noreferrer">
				<span>{t(locale, 'editInOsm')}</span>
				<Icon name="chevron" size={18} />
			</a>
		{/if}

		<p class="disclaimer">{t(locale, 'disclaimer')}</p>
	</section>
{/if}

<style>
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/*
	 * A phone gets a bottom sheet that stops short of the map centre, because the
	 * print crop overlay lives there. Anything wider, and a phone on its side, gets
	 * a column down the right instead: the settings panel already owns the left.
	 * Both scroll inside themselves, so the panel can never run off the screen.
	 */
	.sheet {
		position: fixed;
		z-index: 18;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		background: var(--color-table-800);
		border: 1px solid var(--ctrl-edge);
		border-radius: var(--radius-rail);
		box-shadow: var(--rail-shadow);
		inset: auto 0.75rem max(0.75rem, env(safe-area-inset-bottom)) 0.75rem;
		max-height: 46svh;
		padding: 0.9rem 1rem 0.75rem;
	}

	@media (min-width: 48rem), (max-height: 30rem) {
		.sheet {
			/* Below MapLibre's zoom stack, above its scale bar, never past the centre. */
			--sheet-top: calc(var(--ctrl-inset-top) + 3 * var(--ctrl-size) + var(--ctrl-gap));
			inset: var(--sheet-top) calc(env(safe-area-inset-right) + var(--ctrl-gap)) auto auto;
			width: min(21rem, calc(50vw - 2 * var(--ctrl-gap)));
			max-height: calc(100svh - var(--sheet-top) - 2.5rem - env(safe-area-inset-bottom));
		}
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	/* A place name set in caps is harder to read than one in its own case. */
	h2 {
		margin: 0;
		font-size: 1.15rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--color-brass-300);
	}

	.icon-btn {
		display: grid;
		place-items: center;
		width: var(--spacing-touch);
		height: var(--spacing-touch);
		border: 0;
		border-radius: 0.3rem;
		background: transparent;
		color: var(--color-paper-dim);
		cursor: pointer;
	}

	.icon-btn:hover {
		color: var(--color-paper);
		background: rgb(239 228 207 / 0.08);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 0.95rem;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding-block: 0.25rem;
	}

	.body.more {
		mask-image: linear-gradient(180deg, #000 calc(100% - 1.75rem), transparent);
	}

	.subtitle {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-paper-dim);
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.legend {
		font-size: 0.72rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--color-paper-dim);
	}

	/* The depth is what the eye lands on, so nothing else on the panel is bigger. */
	.metres {
		margin: 0;
		font-size: 3.2rem;
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: var(--color-paper);
	}

	.unit {
		margin-left: 0.3rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-brass-300);
	}

	.absent {
		margin: 0;
		font-size: 1.1rem;
		color: var(--color-paper-dim);
	}

	.level {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.numerals {
		font-size: 1.25rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-paper);
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

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		min-height: calc(var(--spacing-touch) - 0.65rem);
		padding: 0 0.7rem;
		border: 1px solid var(--color-table-500);
		border-radius: 999px;
		background: transparent;
		color: var(--color-paper-dim);
		font-size: 0.85rem;
	}

	.prose {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--color-paper);
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
		border-radius: 0.35rem;
		border: 1px solid var(--ctrl-edge);
	}

	.seabed-name {
		font-size: 0.85rem;
		color: var(--color-paper);
	}

	.note {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.45;
		color: var(--color-paper-dim);
	}

	.osm {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		min-height: var(--spacing-touch);
		padding: 0 0.6rem;
		border-radius: 0.35rem;
		color: var(--color-brass-300);
		font-size: 0.85rem;
		text-decoration: none;
	}

	.osm:hover {
		background: rgb(239 228 207 / 0.07);
	}

	.numeric {
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.01em;
	}

	.disclaimer {
		margin: 0;
		padding-top: 0.5rem;
		border-top: 1px solid rgb(184 137 63 / 0.18);
		font-size: 0.7rem;
		color: var(--color-paper-dim);
	}
</style>
