<script lang="ts">
	import Icon from './Icon.svelte';
	import Chip from './controls/Chip.svelte';
	import Swatch from './controls/Swatch.svelte';
	import type { TextureSample } from './controls/types';
	import type { LegendRow } from './legend';
	import type { SeabedClass } from '$lib/domain/habitat';
	import type { Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';

	/**
	 * One texture and every class the map paints with it. The classes in the frame
	 * come first; the rest follow dimmed under a caption, because a row that named
	 * only one of them would promise a distinction the pixels do not make.
	 *
	 * Each name is the way into choosing that class's texture, which is why it is a
	 * button at the touch floor rather than a line of text. The row is where the
	 * question "what is this pattern" is already being answered, so it is where
	 * "make it something else" belongs.
	 */

	interface Props {
		readonly row: LegendRow;
		readonly locale: Locale;
		readonly sample: TextureSample | undefined;
		readonly missing: string;
		readonly onpick: (seabed: SeabedClass) => void;
	}

	const { row, locale, sample, missing, onpick }: Props = $props();

	const lines = $derived([...row.inFrame, ...row.elsewhere]);

	/** Where the sharers outside the frame start, or -1 when there is nothing to caption. */
	const shared = $derived(
		row.inFrame.length > 0 && row.elsewhere.length > 0 ? row.inFrame.length : -1
	);
</script>

<li class="row">
	<Swatch {sample} {missing} />
	{#each lines as entry, index (entry.key)}
		{#if index === shared}
			<p class="caption">{t(locale, 'legendSameTexture')}</p>
		{/if}
		<button
			type="button"
			class="name"
			data-dim={index >= row.inFrame.length}
			title={t(locale, 'legendChangeTexture', { name: entry.seabed[locale] })}
			onclick={() => {
				onpick(entry.seabed);
			}}
		>
			<span class="text">{entry.seabed[locale]}</span>
			{#if entry.hic !== undefined}
				<Chip label={t(locale, 'legendHic', { code: entry.hic })} />
			{/if}
			{#if entry.chosen}
				<span class="mark">{t(locale, 'legendTextureMark')}</span>
			{/if}
			<span class="go"><Icon name="chevron" size={16} /></span>
		</button>
	{/each}
</li>

<style>
	.row {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}

	.name {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		min-height: var(--spacing-touch);
		min-width: 0;
		padding: 0.3rem 0.4rem;
		border: 0;
		border-radius: var(--control-radius);
		background: transparent;
		font: inherit;
		font-size: var(--control-text);
		line-height: 1.35;
		color: var(--control-ink);
		text-align: left;
		overflow-wrap: anywhere;
		cursor: pointer;
		transition: background var(--control-ease);
	}

	.name:hover {
		background: var(--control-hover);
	}

	.name[data-dim='true'] {
		color: var(--control-ink-dim);
	}

	.text {
		flex: 1 1 8rem;
		min-width: 0;
	}

	/*
	 * Pushed to the end of the last line, whether the name wrapped or not. In the
	 * dim ink the rest of the panel uses for a control that is there but not being
	 * asked for: `--control-ink-off` measured 1.6:1 against the panel and was
	 * invisible, which is worse than having no affordance at all.
	 */
	.go {
		display: flex;
		margin-left: auto;
		color: var(--control-ink-dim);
	}

	.name:hover .go {
		color: var(--color-brass-300);
	}

	.mark {
		font-size: var(--control-label);
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--color-brass-500);
	}

	.caption {
		margin: 0.15rem 0 0;
		font-size: var(--control-label);
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--control-ink-dim);
	}
</style>
