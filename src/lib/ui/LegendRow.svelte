<script lang="ts">
	import Chip from './controls/Chip.svelte';
	import Swatch from './controls/Swatch.svelte';
	import type { TextureSample } from './controls/types';
	import type { LegendRow } from './legend';
	import type { Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';

	/**
	 * One texture and every class the map paints with it. The classes in the frame
	 * come first; the rest follow dimmed under a caption, because a row that named
	 * only one of them would promise a distinction the pixels do not make.
	 */

	interface Props {
		readonly row: LegendRow;
		readonly locale: Locale;
		readonly sample: TextureSample | undefined;
		readonly missing: string;
	}

	const { row, locale, sample, missing }: Props = $props();

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
		<p class="name" data-dim={index >= row.inFrame.length}>
			<span>{entry.seabed[locale]}</span>
			{#if entry.hic !== undefined}
				<Chip label={t(locale, 'legendHic', { code: entry.hic })} />
			{/if}
		</p>
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
		margin: 0;
		font-size: var(--control-text);
		line-height: 1.35;
		color: var(--control-ink);
		overflow-wrap: anywhere;
	}

	.name[data-dim='true'] {
		color: var(--control-ink-dim);
	}

	.caption {
		margin: 0.15rem 0 0;
		font-size: var(--control-label);
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--control-ink-dim);
	}
</style>
