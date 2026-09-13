<script lang="ts">
	import Icon from './Icon.svelte';
	import Swatch from './controls/Swatch.svelte';
	import { textureName } from './texture-name';
	import { SEABED_TEXTURES, type SeabedClass, textureOf } from '$lib/domain/habitat';
	import type { TextureChoices } from '$lib/domain/habitat';
	import type { Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';

	/**
	 * Every texture the map can paint one class with, at the size the map paints
	 * it. The band is the answer and the name underneath is the tiebreak: four of
	 * the twenty-one are grey rock and they are genuinely hard to tell apart at a
	 * glance.
	 *
	 * It takes over the whole panel rather than opening inside the legend row that
	 * led here. Choosing a texture moves the class out of the row it shared and
	 * into the row it now belongs to, so an inline grid would be destroyed by the
	 * press that used it, and the list under the thumb would jump. Here nothing
	 * moves until the diver goes back and looks.
	 */

	interface Props {
		readonly seabed: SeabedClass;
		readonly chosen: TextureChoices;
		readonly locale: Locale;
		readonly sampleOf: (texture: string) => string | undefined;
		readonly missing: string;
		readonly onpick: (texture: string) => void;
		readonly onback: () => void;
	}

	const { seabed, chosen, locale, sampleOf, missing, onpick, onback }: Props = $props();

	const current = $derived(textureOf(seabed, chosen));
</script>

<button type="button" class="back" onclick={onback}>
	<Icon name="chevron" size={18} />
	<span>{t(locale, 'legendBack')}</span>
</button>

<p class="lead">{t(locale, 'legendTextureHint')}</p>

<ul class="grid">
	{#each SEABED_TEXTURES as texture (texture)}
		{@const isCurrent = texture === current}
		{@const isBuiltIn = texture === seabed.texture}
		<li>
			<button
				type="button"
				class="tile"
				aria-pressed={isCurrent}
				onclick={() => {
					onpick(texture);
				}}
			>
				<Swatch url={sampleOf(texture)} {missing} />
				<span class="label">{textureName(texture)}</span>
				{#if isBuiltIn}
					<span class="mark">{t(locale, 'legendBuiltIn')}</span>
				{/if}
			</button>
		</li>
	{/each}
</ul>

<style>
	.back {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		align-self: flex-start;
		min-height: var(--spacing-touch);
		padding: 0 0.7rem 0 0.4rem;
		border: 0;
		border-radius: var(--control-radius);
		background: transparent;
		color: var(--color-brass-300);
		font: inherit;
		font-size: var(--control-text);
		cursor: pointer;
		transition: background var(--control-ease);
	}

	.back:hover {
		background: var(--control-hover);
	}

	/* The set's one right-pointing chevron, turned round rather than drawn twice. */
	.back :global(svg) {
		rotate: 180deg;
	}

	.lead {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.45;
		color: var(--control-ink-dim);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		width: 100%;
		padding: 0.3rem;
		border: 1px solid transparent;
		border-radius: var(--control-radius);
		background: transparent;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			background var(--control-ease),
			border-color var(--control-ease);
	}

	.tile:hover {
		background: var(--control-hover);
	}

	/*
	 * The one in use is ringed in brass and its name goes to ink, so the pressed
	 * tile is legible in bright sun without relying on the band underneath, which
	 * on `ch_dungeonvoid` is very nearly black.
	 */
	.tile[aria-pressed='true'] {
		border-color: var(--control-on-rim);
		background: rgb(184 137 63 / 0.16);
	}

	.label {
		font-size: var(--control-label);
		line-height: 1.3;
		color: var(--control-ink-dim);
		overflow-wrap: anywhere;
	}

	.tile[aria-pressed='true'] .label {
		color: var(--control-ink);
		font-weight: 700;
	}

	.mark {
		font-size: var(--control-label);
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--color-brass-500);
	}
</style>
